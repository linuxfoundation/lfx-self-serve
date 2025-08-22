# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Build stage
FROM node:22-alpine AS builder

# Set build environment
ARG BUILD_ENV=production

# Enable Corepack for Yarn
RUN corepack enable

WORKDIR /app

# Copy source code
COPY . .

# Install dependencies
RUN yarn install --immutable

# Build the application
RUN yarn build

# Expose port 4200
EXPOSE 4200

# Start the SSR server directly from built artifacts
CMD ["yarn", "workspace", "lfx-pcc", "start:server"]