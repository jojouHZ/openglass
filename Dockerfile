# Copyright (C) 2025 OpenGlass contributors
# SPDX-License-Identifier: AGPL-3.0-only

# Backend server image — `docker compose up -d` yields a working instance.
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server

FROM alpine:3.21
RUN adduser -D openglass
USER openglass
COPY --from=build /out/server /usr/local/bin/server
EXPOSE 8081
ENTRYPOINT ["server"]
