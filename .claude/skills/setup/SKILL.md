---
name: setup
description: Walk through environment setup from zero — clone, install, env vars via 1Password, run dev server
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
---

# Environment Setup Guide

You are helping a contributor set up the LFX One development environment from scratch.
Walk through each step interactively, verifying success before moving on.

## Step 1: Prerequisites

Check that the following are installed:

1. **Node.js v22+** — Run `node --version` to verify. If missing, instruct them to install via [nvm](https://github.com/nvm-sh/nvm) or [nodejs.org](https://nodejs.org/).
2. **Yarn v4.9.2+** — Run `yarn --version` to verify. This project uses Yarn Berry (Corepack). If missing: `corepack enable && corepack prepare yarn@4.9.2 --activate`.
3. **Git** — Run `git --version` to verify.

## Step 2: Clone the Repository

If not already cloned:

```bash
git clone <repository-url>
cd lfx-v2-ui
```

If already in the repo, confirm the working directory:

```bash
pwd
git remote -v
```

## Step 3: Environment Variables

The project requires environment variables to connect to backend services. All values are available through **1Password**.

1. **Copy the env template:**

   ```bash
   cp apps/lfx-one/.env.example apps/lfx-one/.env
   ```

2. **Get credentials from 1Password:**
   - Access the **LFX One Dev Environment** vault in 1Password
   - Copy all required values into `apps/lfx-one/.env`
   - The `.env.example` file documents every variable and its purpose — use it as your reference
   - If you don't have 1Password access, contact a code owner on Slack for help

**Important:** All services point to the shared dev environment. No local infrastructure setup is needed.

## Step 4: Install Dependencies

```bash
yarn install
```

Verify the install completed without errors. If there are issues:

- Ensure Node.js v22+ is active
- Try `corepack enable` if Yarn isn't recognized
- Delete `node_modules` and `.yarn/cache` then retry

## Step 5: Start Development Server

```bash
yarn start
```

This starts the Angular dev server with hot reload. The app should be available at `http://localhost:4200`.

## Step 6: Verify

1. Open `http://localhost:4200` in your browser
2. The app should load and show the login page
3. If you see errors in the terminal, check the `.env` file values

## Troubleshooting

If the contributor encounters issues, help them debug:

- **Port in use:** Check if another process is using port 4200
- **Auth errors:** Verify `.env` values match 1Password
- **Build errors:** Run `yarn build` to see detailed error output
- **Missing dependencies:** Run `yarn install` again

## Done

Once the app loads successfully, the contributor is ready to start development.
Suggest they explore the codebase structure:

- `apps/lfx-one/src/app/modules/` — Feature modules
- `apps/lfx-one/src/app/shared/` — Shared components, services, pipes
- `packages/shared/src/` — Shared types, interfaces, utilities
