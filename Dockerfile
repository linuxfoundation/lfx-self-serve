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
COPY apps/lfx-pcc/package.json ./apps/lfx-pcc/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies (this layer is cached when deps don't change)
RUN yarn install --immutable

# NOW copy source code (changes here won't invalidate the dependency layer)
COPY . .

# Build the application
RUN yarn build

# Expose port 4200
EXPOSE 4200

# Start the SSR server directly from built artifacts
CMD ["yarn", "workspace", "lfx-pcc", "start:server"]