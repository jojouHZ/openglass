# Copyright (C) 2025 OpenGlass contributors
# SPDX-License-Identifier: AGPL-3.0-only

# Backend server image — `docker compose up -d` yields a working instance.
FROM golang:1.27-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server \
 && CGO_ENABLED=0 go build -o /out/ogadmin ./cmd/ogadmin

FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN adduser -D openglass
USER openglass
COPY --from=build /out/server /usr/local/bin/server
COPY --from=build /out/ogadmin /usr/local/bin/ogadmin
EXPOSE 8081
ENTRYPOINT ["server"]
