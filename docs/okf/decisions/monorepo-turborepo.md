---
type: Decision
title: Monorepo with Turborepo
description: Adoption of Turborepo monorepo structure with shared package for code reuse and hot-reload development.
resource: turbo.json
tags: [architecture, build]
---

## Context and Rationale

The project uses **Turborepo** as the monorepo build orchestrator, organizing code into two primary workspaces:

- **`apps/lfx-one/`** — Angular 20 SSR application with Express.js server
- **`packages/shared/`** — Shared types, interfaces, constants, utilities, and validators consumed by both the app and server

This structure enables code reuse, independent package management, and hot-reload development without rebuild cycles.

### Why Turborepo

**Turborepo** is a high-performance build system for JavaScript/TypeScript monorepos. It:

- **Caches task results** across local machines and CI to avoid redundant work
- **Executes tasks in parallel** with dependency tracking
- **Handles complex task pipelines** with clear execution order
- **Provides task streaming output** for real-time visibility
- **Minimal configuration** — most behavior is convention-based

### Why This Workspace Structure

**Single App + Shared Package:**

- **Tightly coupled frontend and backend** — both Angular and Express share `@lfx-one/shared`
- **Type-safe contracts** — interfaces in shared are compiled once, used by both layers
- **Hot-reload development** — changes to `packages/shared/` are instantly available in the Angular app without a rebuild

Alternative structures (multiple apps, library-heavy) were rejected because:

1. The app is monolithic (one Angular SPA, one Express server)
2. Code sharing is high (auth types, API request/response shapes, validators)
3. Development velocity benefits from hot reload without intermediate builds

## Architecture

### Workspace Tree

```text
lfx-self-serve/
├── apps/
│   └── lfx-one/                  # Angular 20 SSR app + Express server
│       ├── src/app/              # Angular components, modules, services
│       ├── src/server/           # Express routes, controllers, middleware
│       ├── package.json          # lfx-one app dependencies
│       └── tsconfig.json         # lfx-one TypeScript config
├── packages/
│   └── shared/                   # Types, interfaces, constants, utilities
│       ├── src/
│       │   ├── interfaces/       # .ts files: User, AuthContext, Meeting, etc.
│       │   ├── constants/        # Design tokens, API config, domain constants
│       │   ├── enums/            # Shared enumerations
│       │   ├── utils/            # Utility functions (date, string, url, domain helpers)
│       │   └── validators/       # Form validators
│       ├── package.json          # Export paths pointing to src/
│       └── tsconfig.json         # Shared TypeScript config
├── turbo.json                    # Turborepo task pipeline
└── package.json                  # Root workspace config
```

### Path Alias Resolution

The shared package is imported via a TypeScript path alias that resolves directly to source during development:

```typescript
// In both apps/lfx-one/tsconfig.json and packages/shared/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@lfx-one/shared/*": ["../../packages/shared/src/*"]
    }
  }
}
```

**Development:** `@lfx-one/shared/utils/date` resolves directly to `packages/shared/src/utils/date.ts` — changes are instant, no rebuild.

**Production:** The build emits compiled JS in `packages/shared/dist/`, and the path alias is updated to `dist/` during build.

### Turborepo Task Pipeline

Key tasks in `turbo.json`:

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"], // Depends on upstream (shared) build
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": ["dist/**"]
    },
    "lint": {
      "dependsOn": ["^lint"] // Upstream lint must pass first
    },
    "start": {
      "cache": false, // Dev server never cached
      "persistent": true // Keeps running
    },
    "check-types": {
      "dependsOn": ["^build"] // Upstream build must succeed
    }
  }
}
```

**Task dependency graph:**

- `build` — builds shared first (via `^build`), then lfx-one
- `lint` — lints shared first, then lfx-one
- `start` — runs Angular dev server with hot reload (no caching)
- `check-types` — runs TypeScript type-check after builds

## Hot-Reload Development

When you modify `packages/shared/src/utils/date.ts`:

1. TypeScript compiler detects the change
2. Path alias routes imports to the live source (not `dist/`)
3. Angular dev server rebuilds with the new code
4. Browser hot-reloads — **no manual restart needed**

This is enabled by:

- The `@lfx-one/shared/*` path alias pointing to `src/`
- Angular dev server watching `packages/shared/src/`
- No intermediate build step for the shared package during development

## Trade-offs

### Convenience vs. Flexibility

**Benefit:** Single shared package keeps code DRY, types are sync'd, hot reload is fast.

**Trade-off:** Cannot independently version or release the shared package. If the shared package needs to be consumed by external services (e.g., mobile apps, other microservices), a separate, published package is needed.

**Mitigation:** The current architecture assumes shared code is internal to this monorepo. If external consumption becomes a requirement, the shared package can be extracted to a separate repository and published to npm.

### Monorepo Complexity

**Benefit:** Single dependency tree, unified CI/CD, one build artifact.

**Trade-off:** Monorepo tools (Turborepo, Node.js version pinning, workspace setup) add learning curve. Tooling errors affect the whole repo.

**Mitigation:** Documentation in `CLAUDE.md` and `.claude/rules/` covers common issues (inotify limits, cache clearing, etc.). The `/setup` skill automates first-time setup.

## Key Implications for Development

1. **Use `@lfx-one/shared/*` imports** in both Angular and Express code
2. **Never hardcode types or interfaces** in `apps/lfx-one/` — extract to `packages/shared/src/interfaces/`
3. **Test shared code independently** — shared package has its own `package.json` and can be tested in isolation
4. **Clear module boundaries** — shared exports are explicitly listed in `packages/shared/package.json` export paths
5. **Shared utils are grouped by domain** — `date`, `string`, `url` for generic; `meeting`, `poll`, `survey` for domain-specific

## Related Concepts

- [Angular Zoneless SSR](../decisions/angular-zoneless-ssr.md) — the Angular app running in this monorepo
- [Local Dev Setup](../runbooks/local-dev-setup.md) — how to initialize and run the monorepo

## Citations

- **Source:** `turbo.json`, task pipeline definitions (lines 1–50)
- **Source:** `CLAUDE.md`, Monorepo Structure section (lines 68–121)
- **Source:** `CLAUDE.md`, Shared Package section (lines 145–169)
