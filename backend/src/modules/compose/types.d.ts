interface ParsedComposePort {
  published?: number;
  target?: number;
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
