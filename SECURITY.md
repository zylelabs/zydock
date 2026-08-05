# Security Policy

## Supported versions

Zydock is under active development and has not yet had a stable release. Security fixes are
applied to the `main` branch only; there is no support for older tags or forks.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.** Public issues are indexed and
searchable immediately, which exposes the vulnerability before a fix exists.

Report privately instead, through either channel:

- [GitHub Private Vulnerability Reporting](https://github.com/zylelabs/zydock/security/advisories/new)
  (Security tab → Report a vulnerability)
- E-mail: security@zydock.io

Include the affected component (`backend`, `frontend` or `agent`), the version/commit, steps to
reproduce, and the potential impact.

We aim to acknowledge every report within **5 business days** and to share a remediation plan or
timeline within **15 business days** of confirming the issue.

## Threat model

Zydock manages infrastructure on behalf of the user, which makes a few trust boundaries worth
stating explicitly:

- **The agent has access to the managed server's Docker socket** (`/var/run/docker.sock`). This is
  equivalent to root on that machine — the agent can start, stop and inspect any container, not
  just the ones Zydock created.
- **`AGENT_TOKEN` is the only barrier** between the backend and that Docker socket access. Anyone
  who obtains a valid agent token can act as the backend against that server's agent.
- **Git and SSH credentials are encrypted at rest with `ENCRYPTION_KEY`.** Losing this key makes
  the encrypted data unrecoverable; leaking it exposes every credential encrypted with it. Treat
  `ENCRYPTION_KEY` and `AGENT_TOKEN` with the same care as a root password.
