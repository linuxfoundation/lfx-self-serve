---
name: setup
description: >
  Environment setup from zero — prerequisites, clone, install, env vars via
  1Password, and dev server. Use for getting started, first-time setup, broken
  environments, install failures, or missing env vars.
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

> **Docker is NOT required** for local development. All services point to the shared dev environment — no local databases, message brokers, or infrastructure to run.

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

3. **Validate critical env vars are populated:**

   ```bash
   missing=()
   for key in PCC_AUTH0_CLIENT_ID PCC_AUTH0_CLIENT_SECRET PCC_AUTH0_ISSUER_BASE_URL PCC_AUTH0_AUDIENCE PCC_AUTH0_SECRET PCC_BASE_URL LFX_V2_SERVICE; do
     grep -qE "^${key}=.+" apps/lfx-one/.env || missing+=("$key")
   done
   if [ ${#missing[@]} -gt 0 ]; then
     printf "Missing env vars: %s\n" "${missing[*]}"
   else
     echo "All critical env vars are populated."
   fi
   ```

   If any keys are missing, authentication will fail. Go back to 1Password and fill in the missing values. Note: `PCC_AUTH0_SECRET` can be any sufficiently long random string — it's used for session encryption, not fetched from 1Password.

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
- **Auth errors:** Verify `.env` values match 1Password — re-run the env var validation from Step 3
- **Build errors:** Run `yarn build` to see detailed error output
- **Missing dependencies:** Run `yarn install` again
- **Corepack issues:** Run `corepack enable && corepack prepare yarn@4.9.2 --activate`

## Done

Once the app loads successfully, the contributor is ready to start development.
Suggest they explore the codebase structure:

- `apps/lfx-one/src/app/modules/` — Feature modules
- `apps/lfx-one/src/app/shared/` — Shared components, services, pipes
- `packages/shared/src/` — Shared types, interfaces, utilities

**Next step:** Use `/develop` to build or modify a feature.
