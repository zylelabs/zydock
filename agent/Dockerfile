FROM oven/bun:alpine

RUN apk add --no-cache docker-cli docker-cli-compose git

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . ./

EXPOSE 9000

CMD ["bun", "run", "start"]
