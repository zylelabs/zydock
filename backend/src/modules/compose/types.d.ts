interface ParsedComposePort {
  published?: number;
  target?: number;
  protocol: 'tcp' | 'udp';
}

interface PublishedPortMapping {
  published: number;
  target: number;
  protocol: 'tcp' | 'udp';
}

interface ParsedComposeService {
  name: string;
  image?: string;
  ports: ParsedComposePort[];
  hasMemoryLimit: boolean;
  raw: Record<string, unknown>;
}

interface ParsedCompose {
  services: ParsedComposeService[];
}
