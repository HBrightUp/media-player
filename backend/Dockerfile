FROM golang:1.26-alpine AS build

WORKDIR /src
ENV GOPROXY=https://mirrors.aliyun.com/goproxy/,https://goproxy.cn,direct

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/media-player-server ./cmd/server

FROM alpine:3.22

RUN apk add --no-cache ffmpeg \
	&& adduser -D -H app \
	&& mkdir -p /music /config \
	&& chown -R app:app /music /config

WORKDIR /app

COPY --from=build /out/media-player-server /usr/local/bin/media-player-server

EXPOSE 8080

USER app

CMD ["media-player-server"]
