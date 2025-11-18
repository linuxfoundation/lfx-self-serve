# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Build stage
FROM node:22-alpine AS builder

# Set build environment
ARG BUILD_ENV=production

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

# Build shared package first (doesn't need --define flag)
RUN yarn workspace @lfx-one/shared build:${BUILD_ENV}

# Build the Angular application with LaunchDarkly client ID from secret
RUN --mount=type=secret,id=LAUNCHDARKLY_CLIENT_ID \
    LAUNCHDARKLY_CLIENT_ID=$(cat /run/secrets/LAUNCHDARKLY_CLIENT_ID) && \
    yarn workspace lfx-one-ui build:${BUILD_ENV} --define LAUNCHDARKLY_CLIENT_ID="'${LAUNCHDARKLY_CLIENT_ID}'"

# Expose port 4000
EXPOSE 4000

# Start the SSR server directly from built artifacts
CMD ["yarn", "workspace", "lfx-one-ui", "start:server"]