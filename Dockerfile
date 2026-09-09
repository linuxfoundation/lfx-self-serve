# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Build stage
FROM node:22-alpine AS builder

# Set build environment
ARG BUILD_ENV=production
ARG APP_VERSION=development
ENV APP_VERSION=${APP_VERSION}

# Enable Corepack for Yarn
RUN corepack enable

WORKDIR /app

# Copy package files ONLY for dependency installation (for better layer caching)
COPY package.json yarn.lock turbo.json .yarnrc.yml ./
COPY .yarn .yarn
COPY apps/lfx-one/package.json ./apps/lfx-one/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies (this layer is cached when deps don't change)
RUN yarn install --immutable

# NOW copy source code (changes here won't invalidate the dependency layer)
COPY . .

# Build shared package first
RUN yarn workspace @lfx-one/shared build:${BUILD_ENV}

# Build the Angular application
# Note: Client IDs (LaunchDarkly, DataDog RUM) are now injected at runtime
# via environment variables (LD_CLIENT_ID, DD_RUM_CLIENT_ID, DD_RUM_APPLICATION_ID)
RUN yarn workspace lfx-one-ui build:${BUILD_ENV}

# Install production-only dependencies in a clean layer, so the runtime
# stage below never inherits devDependencies (playwright, angular/cli,
# typescript, etc.) that made the single-stage image slower to pull.
RUN yarn workspaces focus lfx-one-ui --production

# Runtime stage — copies only what's needed to run the built server, not
# the source tree, devDependencies, or the yarn/npm caches used to build it.
# See docs/architecture/backend/ssr-startup.md for the measurement (image
# pull was the dominant phase of a cold-pull cold start) that justified this.
FROM node:22-alpine AS runtime

ARG APP_VERSION=development
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV=production

WORKDIR /app

# Workspace package.json files, so `yarn workspace lfx-one-ui start:server`
# below can still resolve the monorepo layout.
COPY --from=builder /app/package.json /app/yarn.lock /app/turbo.json /app/.yarnrc.yml ./
COPY --from=builder /app/.yarn .yarn
COPY --from=builder /app/apps/lfx-one/package.json ./apps/lfx-one/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/

# Production-only node_modules from the builder's focused install.
# nodeLinker: node-modules hoists everything to the root; neither workspace
# gets its own node_modules directory, so only one COPY is needed here.
COPY --from=builder /app/node_modules ./node_modules

# Built artifacts. packages/shared/dist is required because
# node_modules/@lfx-one/shared resolves to it (nodeLinker: node-modules
# symlinks the workspace package, it doesn't copy the built output).
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/lfx-one/dist ./apps/lfx-one/dist
COPY --from=builder /app/apps/lfx-one/ecosystem.config.js ./apps/lfx-one/
COPY --from=builder /app/apps/lfx-one/otel.mjs ./apps/lfx-one/

# Enable Corepack for Yarn, needed at runtime because CMD still goes
# through `yarn workspace ... start:server` (see docs/architecture/backend/
# ssr-startup.md — the corepack/yarn/pm2 launch residual measured ~2-3s
# and wasn't the bottleneck, so this indirection was left as-is here).
# Corepack's own cache is copied from the builder rather than re-fetched:
# without it, `corepack enable` alone doesn't download the pinned Yarn
# release, and the first `yarn` invocation in a fresh container fetches it
# from the network — a correctness bug (fails with no registry egress) and
# a boot-time regression, both defeating the point of this stage split.
RUN corepack enable
COPY --from=builder /root/.cache/node/corepack /root/.cache/node/corepack

# Expose port 4000
EXPOSE 4000

# Start the SSR server directly from built artifacts
CMD ["yarn", "workspace", "lfx-one-ui", "start:server"]
