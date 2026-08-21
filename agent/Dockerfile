FROM oven/bun:alpine@sha256:07235578f79ef8c6f97d94aee7938e76f5cdba5f21ae5dbfdd3d3d38058437eb

RUN apk add --no-cache docker-cli docker-cli-compose git

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . ./

EXPOSE 9000

CMD ["bun", "run", "start"]
