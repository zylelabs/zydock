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
  memoryLimit?: string;
  raw: Record<string, unknown>;
}

interface ParsedCompose {
  services: ParsedComposeService[];
}
