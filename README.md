# Zydock

A modern, modular and scalable self-hosted deployment platform.

Zydock lets you connect your own servers, organize applications into projects and environments,
deploy straight from Git repositories, manage databases and domains, follow build and runtime logs
in real time, open a console on a running container and monitor resources — all from a single web
interface.

> [!IMPORTANT]
> Zydock is under active development. The features listed below describe what the platform is being
> built to do — some of them are still in progress, partially implemented or disabled in the current
> build, and any of them may change without notice. Expect rough edges, and don't treat this as a
> stable release yet.

### Features

- **Servers** — connect machines over SSH (or use the local one); a lightweight agent is installed
  on each server and runs every local operation.
- **Projects, environments and applications** — a flat hierarchy to organize what you deploy.
- **Git deploys** — clone, build and replace containers, with a persisted job queue and rollback.
- **Databases** — provision and manage database containers.
- **Domains and HTTPS** — reverse proxy configuration with automatic certificates.
- **Real-time logs, console and metrics** — streamed over WebSocket.
- **Notifications** — SMTP and signed webhooks on deployment events.
- **Organizations, roles and API keys** — authentication with short-lived JWT plus rotating refresh
  tokens.

## Getting Started

### Install on a server (self-hosted)

On a clean Ubuntu/Debian server (Docker is installed automatically when missing):

```bash
curl -fsSL https://raw.githubusercontent.com/zylelabs/zydock/main/scripts/install.sh | sudo bash
```

The installer clones the repository into `/data/zydock`, generates the secrets (`JWT_SECRET`,
`ENCRYPTION_KEY`, MongoDB credentials), brings the stack up with `docker-compose.prod.yml` and
creates the first superadmin user. The generated temporary password is printed **once**, at the end
of the installation. Running the script again updates an existing installation (git pull + rebuild)
without regenerating the secrets.

Without `ZYDOCK_DOMAIN`, the panel is reachable at the server IP on ports `3000`/`8000`. With
`ZYDOCK_DOMAIN`, a Caddy container is started in front of the stack (`docker-compose.prod.yml`,
profile `domain`) with automatic HTTPS via Let's Encrypt — and `3000`/`8000` are then published on
the loopback only, so no plain-HTTP API is exposed.

Optional environment variables (`ZYDOCK_DOMAIN`, `ZYDOCK_HOST`, `ZYDOCK_SUPERUSER_EMAIL`,
`ZYDOCK_INSTALL_DIR`, `ZYDOCK_REPO`, `ZYDOCK_BRANCH`) are documented in the header of
[`scripts/install.sh`](scripts/install.sh). To remove an installation, use
[`scripts/uninstall.sh`](scripts/uninstall.sh).

### Run it locally

The full environment (MongoDB + backend + frontend) with Docker:

```bash
git clone https://github.com/zylelabs/zydock.git
cd zydock
docker compose up --build
# frontend at http://localhost:3000 · API at http://localhost:8000 (docs at /docs)
```

Or per package, with [Bun](https://bun.sh):

```bash
cd backend && bun install && bun run dev     # API
cd frontend && bun install && bun run dev    # web interface
```

Or all three at once from the repository root — the root `package.json` is only a script shortcut,
each package keeps its own `bun.lock`:

```bash
bun install && bun run install:all   # installs the root (concurrently) and the three packages
bun run dev                          # backend + frontend + agent, output prefixed per package
```

Each package ships an `.env.example` with every variable it reads; copy it to `.env` before running
outside Docker.

The agent (`agent/`) is not part of the Compose stack: it is installed on each managed server by the
platform itself.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first — it covers the repository
structure, the architecture and conventions every package follows, the development commands, and the
commit and pull request rules.

The short version:

1. Branch off `dev`.
2. Follow the existing code: the implemented modules are the reference.
3. Make sure `bun run lint` and `bun test` pass in every package you touched.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) and open the pull request against
   `dev`.
