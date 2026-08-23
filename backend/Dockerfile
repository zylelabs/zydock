FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS agent-bundle

WORKDIR /agent

COPY agent/package.json agent/bun.lock ./

RUN bun install --frozen-lockfile

COPY agent/ ./

RUN bun run build

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0

RUN apk add --no-cache git openssl \
  && addgroup -S zydock && adduser -S zydock -G zydock

WORKDIR /app

COPY backend/package.json backend/bun.lock ./

RUN bun install --frozen-lockfile --production

COPY backend/ ./

COPY --from=agent-bundle /agent/dist/agent.js /agent/dist/agent.js

COPY templates/ /templates

RUN chown -R zydock:zydock /app /agent /templates

USER zydock

EXPOSE 8000

CMD ["bun", "run", "start"]
