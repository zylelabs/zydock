import { errorMessage } from '../../utils';

export type ReachabilityResult = {
  reachable: boolean;
  latencyMs?: number;
  error?: string;
};

const PROBE_TIMEOUT_MS = 2000;

const probeTcp = (port: number): Promise<ReachabilityResult> =>
  new Promise(resolve => {
    const start = performance.now();
    let settled = false;

    const finish = (result: ReachabilityResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ reachable: false, error: 'Timed out' }),
      PROBE_TIMEOUT_MS,
    );

    Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        open: socket => {
          finish({ reachable: true, latencyMs: Math.round(performance.now() - start) });
          socket.end();
        },
        error: (_socket, error) => finish({ reachable: false, error: errorMessage(error) }),
        data: () => {},
        close: () => finish({ reachable: false, error: 'Nothing listening' }),
      },
    }).catch(error => finish({ reachable: false, error: errorMessage(error) }));
  });

// UDP is connectionless: a refusal only surfaces if the kernel relays an ICMP port-unreachable
// back to us before the timeout, so silence at the timeout is read as reachable, not as proof.
const probeUdp = (port: number): Promise<ReachabilityResult> =>
  new Promise(resolve => {
    const start = performance.now();
    let settled = false;
    let socket: { close: () => void } | undefined;

    const finish = (result: ReachabilityResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket?.close();
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ reachable: true, latencyMs: Math.round(performance.now() - start) }),
      PROBE_TIMEOUT_MS,
    );

    Bun.udpSocket({
      connect: { hostname: '127.0.0.1', port },
      socket: {
        error: (_socket, error) => finish({ reachable: false, error: errorMessage(error) }),
      },
    })
      .then(created => {
        socket = created;

        if (settled) {
          created.close();
          return;
        }

        created.send(new Uint8Array(0));
      })
      .catch(error => finish({ reachable: false, error: errorMessage(error) }));
  });

export const checkReachability = (
  port: number,
  protocol: 'tcp' | 'udp',
): Promise<ReachabilityResult> => (protocol === 'udp' ? probeUdp(port) : probeTcp(port));
