FROM oven/bun:alpine@sha256:07235578f79ef8c6f97d94aee7938e76f5cdba5f21ae5dbfdd3d3d38058437eb AS agent-bundle

WORKDIR /agent

COPY agent/package.json agent/bun.lock ./

RUN bun install --frozen-lockfile

COPY agent/ ./

RUN bun run build

FROM oven/bun:alpine@sha256:07235578f79ef8c6f97d94aee7938e76f5cdba5f21ae5dbfdd3d3d38058437eb

RUN apk add --no-cache git openssl

WORKDIR /app

COPY backend/package.json backend/bun.lock ./

RUN bun install --frozen-lockfile

COPY backend/ ./

COPY --from=agent-bundle /agent/dist/agent.js /agent/dist/agent.js

COPY templates/ /templates

EXPOSE 8000

CMD ["bun", "run", "start"]
