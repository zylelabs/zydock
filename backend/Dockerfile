FROM oven/bun:alpine

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . .

# Bun runs TypeScript directly; no build step needed for the server.
EXPOSE 8000

CMD ["bun", "run", "start"]
