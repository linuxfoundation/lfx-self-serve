---
type: Runbook
title: Local Dev Setup
description: Prerequisites, environment sourcing, and dev-server startup for first-time contributors.
resource: CLAUDE.md
tags: [devex, setup]
---

## Overview

This runbook covers the prerequisites and initialization steps for setting up a local development environment for the LFX One application. Following these steps will prepare your machine to run the Angular dev server with hot reload.

## Prerequisites

Before starting, ensure your system has:

- **Node.js ≥ 22** — required for the Angular 20 + Turborepo build system
- **Yarn 4.x** — managed via Corepack; do not install manually
- **Git** — for cloning and version control
- **Docker or OrbStack** (optional) — only needed if running the optional local microservice stack; normal app development uses the shared dev environment

The application uses Corepack (shipped with Node.js) to pin and enforce Yarn 4.x. This ensures all contributors work with the same package manager version.

## Steps

### 1. Clone and Install

```bash
git clone https://github.com/linuxfoundation/lfx-self-serve.git
cd lfx-self-serve
yarn install
```

If Yarn 4.x is not yet enabled in Corepack:

```bash
corepack enable
corepack prepare yarn@4 --activate
```

### 2. Environment Setup (First Time Only)

For first-time setup with 1Password integration and microservice stack configuration, invoke the `/setup` skill from Claude Code:

```bash
/setup
```

The skill handles:

- Fetching environment variables from 1Password
- Configuring OAuth / Auth0 credentials
- Setting up the optional microservice stack
- Validating prerequisites
- Starting the dev server

### 3. Start the Dev Server

To start the Angular dev server with hot reload:

```bash
yarn start
```

The command starts:

- Angular development server (default port: 4200)
- Express SSR server (running alongside)
- Turborepo build pipeline (tracking dependencies)

The Angular CLI watches source files for changes and triggers hot reload automatically — **do not restart the server manually** when files change.

### 4. Verify Hot Reload

After making a code change in `apps/lfx-one/src/app/`:

1. Save the file
2. Check the terminal for build output — you should see `✔ Build successful` and a file list
3. The browser automatically reloads with the new code

If hot reload is silent (no build output), check the console logs and verify the inotify watcher limit:

```bash
# Check current limit (macOS/Linux)
sysctl fs.inotify.max_user_watches

# Increase if too low (Linux only)
sudo sysctl fs.inotify.max_user_watches=524288
```

## Reset and Cleanup

If the dev server becomes unresponsive or dependencies are corrupted:

```bash
# Clear Angular CLI cache
yarn ng cache clean

# Clear Turborepo cache
yarn turbo clean

# Full reinstall (nuclear option)
rm -rf node_modules && yarn install
```

## Related Concepts

- [Commit Workflow](../runbooks/commit-workflow.md) — how to stage and commit changes
- [Post-Commit Review](../runbooks/post-commit-review.md) — pre-PR review process
- [Angular Zoneless SSR](../decisions/angular-zoneless-ssr.md) — SSR architecture and implications
- [Monorepo Turborepo](../decisions/monorepo-turborepo.md) — workspace structure and shared package hot reload

## Citations

- **Source:** `CLAUDE.md`, Quick Start section
- **Source:** `CLAUDE.md`, Commands table (lines 40–54)
- **Source:** `CLAUDE.md`, Reset / cleanup section (lines 58–66)
