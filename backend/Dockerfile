FROM oven/bun:alpine AS agent-bundle

WORKDIR /agent

COPY agent/package.json agent/bun.lock ./

RUN bun install --frozen-lockfile

COPY agent/ ./

RUN bun run build

FROM oven/bun:alpine

WORKDIR /app

COPY backend/package.json backend/bun.lock ./

RUN bun install --frozen-lockfile

COPY backend/ ./

COPY --from=agent-bundle /agent/dist/agent.js /agent/dist/agent.js

EXPOSE 8000

CMD ["bun", "run", "start"]
