# syntax=docker/dockerfile:1
FROM docker:28-cli AS docker-client
FROM --platform=$BUILDPLATFORM node:24.14.0-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN npm --prefix dashboard ci
COPY . .
ARG RELEASE_VERSION=development
ARG RELEASE_COMMIT=unknown
RUN node tools/caracal/setup.mts && cd .caracal && npm ci
RUN node tools/build-shared.mts --publish && node tools/build-runtime.mts --publish && node tools/game/build.mts --publish
RUN AL_DASHBOARD_OUT_DIR=.build/container node tools/dashboard/build.mts
RUN node tools/release/image-metadata.mts "$RELEASE_VERSION" "$RELEASE_COMMIT"
RUN rm -rf /app/.caracal/localStorage /app/.caracal/game_files /app/.caracal/logs /app/.caracal/.git && \
    ln -s /data/localStorage /app/.caracal/localStorage && ln -s /data/game_files /app/.caracal/game_files && ln -s /data/logs /app/.caracal/logs
RUN rm -rf /app/node_modules /app/dashboard/node_modules /app/.caracal/node_modules

FROM node:24.14.0-bookworm-slim AS development
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates tini gosu && rm -rf /var/lib/apt/lists/*
COPY --from=docker-client /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-client /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
WORKDIR /opt/party-seed
COPY package.json package-lock.json ./
RUN npm ci
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN npm --prefix dashboard ci
COPY . .
RUN node tools/caracal/setup.mts && npm --prefix .caracal ci && node tools/hosting/install-caddy.mts
RUN node -e "require('fs').writeFileSync('/opt/party-seed/seed-id',require('crypto').randomUUID())"
WORKDIR /app
ENV NODE_ENV=development AL_DOCKER_DEV=1 AL_DATA_DIR=/data AL_HOST=0.0.0.0 AL_PORT=3010
EXPOSE 3010 3443
HEALTHCHECK --interval=10s --start-period=240s CMD node -e "fetch('http://127.0.0.1:'+process.env.AL_PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/party-seed/tools/hosting/docker-dev.mts"]

FROM node:24.14.0-bookworm-slim AS production
ARG RELEASE_VERSION=development
ARG RELEASE_REPOSITORY=thefonze74065/adventureland-party-console
LABEL org.opencontainers.image.title="Adventureland Party Console" org.opencontainers.image.version=$RELEASE_VERSION org.opencontainers.image.source="https://github.com/$RELEASE_REPOSITORY"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini gosu && rm -rf /var/lib/apt/lists/*
COPY --from=docker-client /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-client /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/dashboard/package.json /app/dashboard/package-lock.json ./dashboard/
COPY --from=build /app/.caracal/package.json /app/.caracal/package-lock.json ./.caracal/
RUN npm ci && npm --prefix dashboard ci && npm --prefix .caracal ci
COPY --from=build --chown=node:node /app /app
RUN node tools/hosting/install-caddy.mts
RUN mkdir /data && mkdir -p /app/dashboard/node_modules/.mf && chown node:node /data /app /app/dashboard/node_modules/.mf
ENV NODE_ENV=production AL_DATA_DIR=/data AL_HOST=0.0.0.0 AL_PORT=3010
EXPOSE 3010
EXPOSE 3443
VOLUME ["/data"]
HEALTHCHECK --interval=30s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+process.env.AL_PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "tools/hosting/docker-production.mts"]

FROM node:24.14.0-bookworm-slim AS debug-browser
RUN npm install --prefix /opt/browser @playwright/test@1.63.0 && /opt/browser/node_modules/.bin/playwright install --with-deps chromium
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify && rm -rf /var/lib/apt/lists/*

FROM debug-browser AS debug
WORKDIR /app
COPY --from=production /app /app
ENV NODE_ENV=production AL_DEBUG_INSTANCE=1 AL_DATA_DIR=/data AL_HOST=0.0.0.0 AL_PORT=3010
HEALTHCHECK --interval=3s --timeout=3s --start-period=300s CMD node -e "fetch('http://127.0.0.1:3010/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "tools/debug/instance.mts"]

# Preserve the ordinary image as the default docker build target.
FROM production AS release
