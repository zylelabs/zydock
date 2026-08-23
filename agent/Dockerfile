FROM --platform=$BUILDPLATFORM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS builder

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0

RUN apk add --no-cache docker-cli docker-cli-compose git

WORKDIR /app

COPY --from=builder /app/dist/agent.js ./dist/agent.js

EXPOSE 9000

HEALTHCHECK --interval=5s --timeout=5s --retries=20 \
  CMD wget -qO- http://127.0.0.1:9000/api/health || exit 1

CMD ["bun", "dist/agent.js"]
