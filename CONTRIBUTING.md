# Contributing to Zydock

Thanks for taking the time to contribute. This document describes how the repository is organized,
the architecture and conventions all packages share, how to run things locally, and the rules for
commits and pull requests.

> **The main rule: existing code is the reference.** Before creating any module, file, route, store
> or component, open the equivalent one that is already implemented and reproduce the same
> organization, the same file names and the same style. When this document and the code disagree,
> the code wins — and the document is fixed in the same task.

## Repository structure

The project is organized as a set of **completely separate** applications — they share no code, no
build and no dependencies:

```text
/
├── backend/    API, business rules, providers, deploy, SSH, WebSockets, queues
├── frontend/   Web interface (Nuxt SSR), consuming the API and the WebSockets
├── agent/      Agent installed on each server (Bun), local operations
└── scripts/    Self-hosted installer (scripts/install.sh) and support files (Caddyfile)
```

| Folder      | Responsibility                                                                    |
| ----------- | --------------------------------------------------------------------------------- |
| `backend/`  | API, business rules, providers, deploy orchestration, queues, WebSocket, database  |
| `frontend/` | Web interface (Nuxt SSR), consuming the API and the WebSockets                     |
| `agent/`    | Agent installed on each managed server; runs the local operations                  |

### Backend and agent layout

```text
backend/
├── index.ts                     # Entrypoint: { port, fetch, websocket }
├── package.json
├── tsconfig.json
├── .env.example
└── src/
    ├── app-server.ts            # createApp(): builds the Hono app, OpenAPI, Scalar and shutdown
    ├── config/
    │   ├── index.ts             # The only place that reads process.env
    │   └── mongodb.ts           # connectDatabase / disconnectDatabase
    ├── modules/
    │   ├── routes.ts            # Root router: route('/prefix', moduleRoute)
    │   └── <module>/            # one directory per module
    ├── providers/               # External integrations
    ├── seeds/
    ├── types/
    │   └── index.d.ts           # Ambient global types (BaseDocument, PaginateModel, ...)
    └── utils/
        ├── index.ts
        ├── openapi.ts           # jsonRes, errorRes, messageRes, paginatedSchema
        └── pagination.ts        # paginationQuery, paginateStatics
```

Do **not** create `core/`, `infrastructure/`, `bootstrap/`, `domain/` or `shared/` layers. The
structure is flat and predictable. The agent uses the same layout, minus MongoDB — it has no models.

### Frontend layout

```text
frontend/
├── nuxt.config.ts
├── eslint.config.ts
├── package.json
├── tsconfig.json
├── public/
├── server/
│   ├── types.d.ts
│   └── api/
│       ├── health_check.ts
│       └── proxy/[...path].ts     # Proxy to the backend (never expose the API URL)
└── app/
    ├── app.vue
    ├── app.config.ts
    ├── assets/css/main.css
    ├── components/                # pathPrefix: false
    ├── composables/
    ├── layouts/                   # default.vue, blank.vue
    ├── middlewares/               # note the plural, set in nuxt.config (dir.middleware)
    ├── pages/
    ├── stores/                    # <name>.store.ts
    └── utils/
```

## Architecture

The three applications share the same architecture: **functional style (no classes)**, modules as
**flat files with a layer suffix**, and every external integration **behind a provider**.

### Functional style, no classes

- Prefer **functions, modules and composition** over classes. Don't introduce a class without a clear
  architectural need.
- Contracts are **types** with functions, not interfaces implemented by classes. Implementations are
  factories — `createXProvider(options): XProvider` — returning an object of functions whose
  dependencies are captured by closure.
- Dependencies come in through **function parameters or closures**, never through constructors. No DI
  container, no decorators, no tokens.
- Avoid OO patterns (inheritance, stateful singletons, `this`, getters/setters, error hierarchies)
  when a functional solution works.
- Prefer pure functions; isolate side effects (I/O, database, network) at the edges. Never mutate
  function parameters.

| Instead of                                | Use                                                        |
| ----------------------------------------- | ---------------------------------------------------------- |
| `class UserService { ... }`                | exported functions in `user.service.ts`                     |
| `class AppServer` singleton                | `createApp()` / `startServer()` in `app-server.ts`          |
| `class DockerProvider implements X`        | `createDockerProvider(config): ContainerProvider`           |
| interface + class implementing it          | `type Provider = { op: (...) => Promise<...> }` + factory   |
| constructor injection                      | function parameter or factory closure                       |
| `extends BaseX`                            | composition: functions receiving/returning functions        |
| subclass hierarchy of `Error`              | explicit error return or `throw new Error('message')`       |

```ts
export type ContainerProvider = {
  createContainer: (spec: ContainerSpec) => Promise<ContainerInfo>;
  removeContainer: (id: string) => Promise<void>;
};

export const createDockerProvider = (options: DockerOptions): ContainerProvider => {
  const request = buildClient(options);

  return {
    createContainer: async spec => { ... },
    removeContainer: async id => { ... },
  };
};
```

Acceptable exceptions, no justification needed: classes required by third-party libraries (Mongoose
`Schema`, native `Error`) or generated by the framework.

### Module anatomy (backend and agent)

Each module lives in `src/modules/<module>/` as **flat files** — no `models/`, `routes/`, `services/`
subfolders:

| File                     | Responsibility                                              |
| ------------------------ | ------------------------------------------------------------ |
| `<entity>.model.ts`      | Mongoose schema and model                                    |
| `<module>.route.ts`      | Routes: path, docs, middlewares, validation, handler         |
| `<module>.schema.ts`     | Zod schemas + inferred DTOs                                  |
| `<module>.docs.ts`       | OpenAPI `DocOptions` objects                                 |
| `<module>.service.ts`    | Business rules and model access, reused across routes        |
| `<module>.middleware.ts` | Module middlewares (when there are any)                      |
| `types.d.ts`             | Module domain types, as ambient globals                      |

With more than one entity in a module, files are prefixed by entity (`server.model.ts`,
`heartbeat.route.ts`, `provisioning.service.ts`) and all of them stay in the same module.

There are **no** `controller`, `repository`, `dto`, `validator`, `serializer`, `tokens` or module
`index.ts` files. The route is the HTTP adapter, the service holds the business rules, and
serialization is a function exported by the service (`serializeUser`). Every router is mounted in
`src/modules/routes.ts`.

### Routes, validation and docs

- Signature: `method(path, docOptions, ...middlewares, handler)` from `hono-route-docs`.
- The documentation object always comes from `*.docs.ts` — **never inline**.
- Validation with `validator('json' | 'param' | 'query', zodSchema)`. **All external input is
  validated with Zod**: never trust body, query, params, headers or third-party API responses.
- Static routes before parameterized ones (`/me` before `/:id`).
- Pagination with `paginationQuery(c)` + `model.paginate(filter, { page, size, sort, order })`.
- The file ends with `export default router`.
- Handlers only validate input, read the auth context, run the direct query (for trivial CRUD) or
  call the service, and respond. Any business rule, orchestration or logic reused across routes goes
  to `*.service.ts`.

Response shapes:

| Case            | Body                                  |
| --------------- | ------------------------------------- |
| Resource        | serialized entity                     |
| Simple success  | `{ message: 'Message' }`              |
| Paginated list  | `{ items, total, page, size, pages }` |
| Error           | `{ error: 'Message' }` + HTTP status  |

### Models and data

- Collections in plural `snake_case`; default options `versionKey: false`, `timestamps: true`,
  `statics: paginateStatics`.
- Sensitive fields use `select: false` and are stripped again during serialization.
- **A model is only used inside its own module** (its routes and its service). Other modules go
  through the owning module's service.
- Domain types live in the module's `types.d.ts` as ambient globals (no `import`, no `export`), on
  top of the global `BaseDocument<T>` and `PaginateModel<T>` helpers.

### Providers

Every external integration sits behind a provider. The application depends only on the **contract
type**, never on an implementation:

```text
src/providers/<provider>/
├── <provider>.contract.ts   # type XProvider = { op: (...) => Promise<...> }
├── <impl>.provider.ts       # createXProvider(options): XProvider
└── index.ts                 # picks the implementation from the config
```

The concrete implementation is chosen from `config` in a **single place** (`index.ts`). Never couple
the application to a specific reverse proxy, container runtime or cloud provider — Caddy and Docker
are initial implementations, replaceable without touching business rules.

### Configuration and auth

- Every environment variable is read in `src/config` and consumed via `config.*`. No other file uses
  `process.env` or Hono's `env(c)`. Every variable is documented in `.env.example`.
- `authMiddleware` validates the JWT and populates `c.get('auth')`; `requirePermission('<module>.<resource>.<action>')`
  runs **after** it, always with concrete identifiers.
- Passwords with `Bun.password.hash(value, { algorithm: 'argon2id' })`. Secrets never leak: strip
  hashes and tokens in the serializer, never hardcode a credential.

### Frontend conventions

- Every backend call goes through the Nitro proxy (`server/api/proxy/[...path].ts`). The client never
  talks to the API URL directly and never leaks it in an error message.
- Stores in `app/stores/<name>.store.ts` with `defineStore` in options format
  (`state` / `actions` / `getters`) and explicit `persist` when needed.
- Thin pages: composition of components and calls to composables/stores. **Zero business logic in the
  frontend.**
- Components always with `<script setup lang="ts">` (Composition API). No `defineComponent` with
  Options API, no classes, no mixins — shared logic lives in composables.

### Code style

- TypeScript `strict` everywhere. Never `any` without an absolute need.
- `const` + arrow function for every new function; keep existing `function` declarations when editing.
- **No comments in the code**, unless explicitly requested.
- Prefer early returns; avoid nested conditionals and deeply nested code.
- Short, focused functions; one module, one responsibility.
- Explicit names, no non-universal abbreviations. Always use braces, never `if (condition) doSomething()`.

Naming — everything in English:

| Case                                | Convention          |
| ----------------------------------- | ------------------- |
| Variables and functions             | `camelCase`         |
| Types, interfaces and Vue components| `PascalCase`        |
| Constants, when it makes sense      | `UPPER_SNAKE_CASE`  |
| Files                               | `kebab-case`        |
| MongoDB collections                 | plural `snake_case` |

Module files carry a layer suffix: `.model.ts`, `.route.ts`, `.service.ts`, `.schema.ts`, `.docs.ts`,
`.middleware.ts`, `.store.ts`.

## Stack

| Layer      | Technologies                                        |
| ---------- | --------------------------------------------------- |
| Frontend   | Nuxt.js (SSR), TypeScript, Tailwind CSS, Pinia, Zod |
| Backend    | Hono, Bun, TypeScript, WebSocket, Zod               |
| Agent      | Bun, TypeScript                                     |
| Database   | MongoDB, Mongoose                                   |

Backend and agent: Bun runtime, Hono + `hono-route-docs` (routes + OpenAPI), MongoDB via Mongoose,
Zod validation, Scalar docs at `/docs` with the spec at `/openapi.json`, Prettier, TypeScript
`strict`.

Frontend: Nuxt 4 (SSR), TypeScript `strict`, Tailwind CSS 4 (via `@tailwindcss/vite`), Pinia
(+ `pinia-plugin-persistedstate`), Zod, Prettier + ESLint (`@nuxt/eslint`).

## Development

Full environment (MongoDB + backend + frontend) with Docker:

```bash
docker compose up --build
# frontend at http://localhost:3000 · API at http://localhost:8000 (docs at /docs)
```

Or per package (requires [Bun](https://bun.sh)):

```bash
cd backend && bun install && bun run dev     # API
cd frontend && bun install && bun run dev    # web interface
```

Or all three at once from the root — the root `package.json` is only a script shortcut, each package
keeps its own `bun.lock`:

```bash
bun install && bun run install:all   # installs the root (concurrently) and the three packages
bun run dev                          # backend + frontend + agent, output prefixed per package
```

Quality checks, in each package (or from the root, running all three at once):

```bash
bun run lint    # Prettier (+ ESLint on the frontend) + typecheck
bun test        # unit and integration tests
bun run build
```

The agent (`agent/`) is installed on each server over SSH by the platform itself — it is not part of
the Compose stack. CI runs lint, tests and build per package on every push and pull request.

### Before opening a pull request

1. Does something similar already exist in `backend/`, `frontend/` or `agent/`? Did I reuse or extend
   it?
2. Did I open the equivalent module and follow the same shape?
3. Is the file named after the `<entity>.<layer>.ts` pattern?
4. Is it in the right module, as flat files, without new subfolders?
5. Is the code functional — exported functions, no classes, no `this`?
6. Is every external input validated with Zod?
7. Does the route have its documentation in `*.docs.ts`?
8. Does the external integration go through a provider (contract as a `type` + factory)?
9. Do `bun run lint` and `bun test` pass?
10. No dead code, no unused imports, no duplication?

## Commits

The project follows [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<optional scope>): <short description>

<optional body>
```

- **Type** — one of:

  | Type       | When to use                                                        |
  | ---------- | ------------------------------------------------------------------ |
  | `feat`     | new feature                                                        |
  | `fix`      | bug fix                                                            |
  | `refactor` | code change that neither fixes a bug nor adds a feature            |
  | `docs`     | documentation only                                                 |
  | `test`     | adding or fixing tests                                             |
  | `chore`    | tooling, config, dependencies, maintenance                         |
  | `perf`     | performance improvement                                            |
  | `ci`       | CI/CD pipeline changes                                             |

- **Scope** is optional and names the affected area: the package (`backend`, `frontend`, `agent`) or
  the module (`servers`, `queue`, `webhook`, `proxy`).
- **Description** in English, imperative mood, lowercase, no trailing period:
  `feat(servers): add server management page`, not `Added the server management page.`
- Keep the subject under ~72 characters; use the body to explain the *why* when it isn't obvious.
- One logical change per commit. Don't mix a refactor with a feature, and don't commit unrelated
  formatting.
- Breaking changes: add `!` after the type/scope (`feat(api)!: ...`) and describe the impact in the
  body.

Examples taken from the history:

```text
feat(webhook): add webhook configuration and management for applications and servers
feat: implement rollback functionality for deployments with associated API and UI updates
refactor: remove commented-out code and improve code clarity across multiple files
chore: update .gitignore
```

## Pull requests

1. **Branch from `dev`** and target `dev` in the pull request (`main` holds released code). Name the
   branch after the change: `feat/server-metrics`, `fix/deploy-queue-retry`.
2. **Title** follows the same Conventional Commits format as a commit subject.
3. **Description** should cover:
   - what changed and why;
   - the linked issue, if any (`Closes #123`);
   - how it was tested (commands, scenarios), and screenshots or a short recording for UI changes;
   - any breaking change, migration or new environment variable (which must also be in the matching
     `.env.example`).
4. **CI must be green.** The pipeline runs `bun run lint`, `bun test` and `bun run build` for
   `backend`, `agent` and `frontend`; run them locally before pushing.
5. **Keep the project working.** Every pull request must leave the three applications compiling and
   functional — never ship a temporary workaround.

If a change needs a decision that isn't yours to make — an architectural trade-off, a new dependency,
a behavior change — open an issue or ask in the pull request before implementing it.
