# Copyright (C) 2025 OpenGlass contributors
# SPDX-License-Identifier: AGPL-3.0-only

# Backend server image — `docker compose up -d` yields a working instance.
FROM golang:1.27-alpine@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server \
 && CGO_ENABLED=0 go build -o /out/ogadmin ./cmd/ogadmin

FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
RUN adduser -D openglass
USER openglass
COPY --from=build /out/server /usr/local/bin/server
COPY --from=build /out/ogadmin /usr/local/bin/ogadmin
EXPOSE 8081
ENTRYPOINT ["server"]
