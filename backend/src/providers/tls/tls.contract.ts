export const TLS_IMPLEMENTATIONS = ['openssl'] as const;

export type TlsImplementation = (typeof TLS_IMPLEMENTATIONS)[number];

export type CertificateAuthority = {
  certPem: string;
  keyPem: string;
};

export type IssuedCertificate = {
  certPem: string;
  keyPem: string;
};

export type TlsProvider = {
  createCertificateAuthority: (commonName: string) => Promise<CertificateAuthority>;
  issueCertificate: (
    commonName: string,
    authority: CertificateAuthority,
  ) => Promise<IssuedCertificate>;
};

export type TlsProviderFactory = () => TlsProvider;
