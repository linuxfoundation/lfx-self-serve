---
name: develop
description: Guided development workflow — create components, services, backend endpoints, shared types, or full features following project patterns
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
---

# LFX One Development Guide

You are helping a contributor build within the LFX One codebase. This skill handles all development work: components, services, backend endpoints, shared types, and full end-to-end features.

**Important:** You are integrating features within existing architecture — not making architectural decisions. If the work requires changes to routing, auth, middleware, or infrastructure, flag it for a code owner.

## Step 1: Understand the Work

Ask the contributor what they're building. Based on their answer, determine which workflow(s) apply:

| Workflow               | When to Use                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| **Shared Types**       | New interfaces, enums, or constants needed                                |
| **Backend Endpoint**   | New API route with controller + service                                   |
| **Frontend Service**   | New Angular service or methods on an existing one                         |
| **Frontend Component** | New Angular component (page, module-specific, shared, or PrimeNG wrapper) |
| **Full Feature**       | End-to-end integration (combines multiple workflows above)                |

For a **full feature**, execute the workflows in this order: Shared Types → Backend Endpoint → Frontend Service → Frontend Component.

## Step 2: Required Reading

Read the relevant architecture docs **before generating code**. These are the source of truth.

### Always Read

- **`CLAUDE.md`** → "Component Organization Pattern" section — class structure ordering, signal patterns

### For Frontend Work

- **`docs/architecture/frontend/component-architecture.md`** — Component placement, module structure, PrimeNG wrapper strategy
- **`docs/architecture/frontend/angular-patterns.md`** — Signals, change detection, template syntax, inject() pattern
- **`docs/architecture/frontend/styling-system.md`** — CSS layers, Tailwind configuration
- **`docs/architecture/frontend/state-management.md`** — Service-based state, signal architecture
- **`docs/architecture/frontend/drawer-pattern.md`** — Drawer components with lazy loading and charts (if building a drawer)

### For Backend Work

- **`docs/architecture/backend/ssr-server.md`** — Server architecture, route registration
- **`docs/architecture/backend/logging-monitoring.md`** — Logger service usage, operation lifecycle, log levels
- **`docs/architecture/backend/error-handling-architecture.md`** — Error classification, response format
- **`docs/architecture/backend/server-helpers.md`** — Helper patterns, validation, pagination helpers
- **`docs/architecture/backend/pagination.md`** — Cursor-based pagination patterns (if endpoint returns lists)

### For Shared Package Work

- **`docs/architecture/shared/package-architecture.md`** — Package structure, exports, utilities, validators

## Step 3: Check What Exists

Before creating anything, check what already exists to avoid duplicates:

```bash
# Frontend
ls apps/lfx-one/src/app/modules/                    # Feature modules
ls apps/lfx-one/src/app/shared/components/           # Shared components
ls apps/lfx-one/src/app/shared/services/             # Frontend services

# Backend
ls apps/lfx-one/src/server/controllers/              # Controllers
ls apps/lfx-one/src/server/services/                 # Backend services
ls apps/lfx-one/src/server/routes/                   # Route files

# Shared package
ls packages/shared/src/interfaces/                   # Interfaces
ls packages/shared/src/enums/                        # Enums
ls packages/shared/src/constants/                    # Constants
```

If related code already exists, **read it first** and extend it rather than creating new files.

## Step 4: Read an Existing Example

Read a representative file in the target area to match the team's current patterns. Pick something in the same module or domain as the work being done.

## Step 5: Build

Follow the workflow(s) identified in Step 1. The sections below provide the key conventions for each.

---

### Shared Types

**Location:** `packages/shared/src/interfaces/`, `enums/`, or `constants/`

- License header on all new files
- Use TypeScript interfaces (not union types) for better maintainability
- File suffixes: `.interface.ts`, `.enum.ts`, `.constants.ts`
- Use `as const` for constant objects to get literal types
- Export from the barrel file (`index.ts`) in the same directory
- NEVER define interfaces locally in component or service files

---

### Backend Endpoint

Creates three files: **service** → **controller** → **route**.

#### Service (`src/server/services/<name>.service.ts`)

- Uses `MicroserviceProxyService` for ALL external API calls
- API reads: `/query/resources`, writes: `/itx/...`
- `logger.debug()` for step-by-step tracing, `logger.info()` for significant operations
- `logger.warning()` for recoverable errors (returning null/empty)
- NEVER use `serverLogger` directly — always use `logger` from `./services/logger.service`

#### Controller (`src/server/controllers/<name>.controller.ts`)

- `logger.startOperation()` → `try/catch` → `logger.success()` or `next(error)`
- Pass errors to `next(error)` — NEVER use `res.status(500).json()`
- Operation names in snake_case (e.g., `get_items`, `create_item`)
- Use `validateUidParameter` from helpers for parameter validation

#### Route (`src/server/routes/<name>.route.ts`)

- Express Router with controller method bindings
- Follow the pattern from an existing route file

#### Route Registration

**IMPORTANT:** The route must be registered in `server.ts`, which is a protected file.
Tell the contributor:

> "The route file is created, but it needs to be registered in `server.ts`. Since that's a protected infrastructure file, please ask a code owner to add the route registration."

---

### Frontend Service

**Location:** `apps/lfx-one/src/app/shared/services/<name>.service.ts`

- `@Injectable({ providedIn: 'root' })` — always tree-shakeable
- `inject(HttpClient)` — never constructor-based DI
- **GET requests:** `catchError(() => of(defaultValue))` for graceful error handling
- **POST/PUT/DELETE requests:** `take(1)` and let errors propagate to the component
- **Shared state:** Use `signal()` for data consumed by multiple components
- **Signals can't use rxjs pipes** — use `computed()` or `toSignal()` for reactive transforms
- **Interfaces:** Import from `@lfx-one/shared/interfaces`, never define locally
- **API paths:** Use relative paths (e.g., `/api/items`) — the proxy handles routing

---

### Frontend Component

#### Placement

Determine the component category and place it accordingly:

| Category                        | Location                                        |
| ------------------------------- | ----------------------------------------------- |
| Route/page component            | `modules/<module>/<component-name>/`            |
| Module-specific component       | `modules/<module>/components/<component-name>/` |
| Shared component (cross-module) | `shared/components/<component-name>/`           |
| PrimeNG wrapper component       | `shared/components/<component-name>/`           |

Check `docs/architecture/frontend/component-architecture.md` for detailed placement guidelines.

A new module can be created if the feature represents a distinct domain, but prefer existing modules when the feature fits.

#### Files

Generate three files (`.component.ts`, `.component.html`, `.component.scss`), each with the license header.

#### Class Structure (from CLAUDE.md)

1. Private injections (`inject()`, `readonly`)
2. Public fields from inputs/dialog data
3. Forms
4. Model signals (`model()`)
5. WritableSignals (`signal()`)
6. Computed/toSignal signals (via private init functions)
7. Constructor
8. Public methods
9. Protected methods
10. Private initializer functions
11. Private helper methods

#### Key Rules

- Standalone components with direct imports (no barrel exports)
- Signals: `signal()`, `input()`, `output()`, `computed()`, `model()` — never constructor DI
- Templates: `@if`/`@for` syntax, `data-testid` attributes, `flex + flex-col + gap-*` (never `space-y-*`)
- Do not nest ternary expressions
- For PrimeNG wrappers, follow the wrapper strategy in the component architecture doc

---

## Step 6: Validate

Run the full validation suite:

```bash
yarn lint          # Check for linting errors
yarn format        # Apply formatting
yarn build         # Verify build succeeds
```

Fix any issues before finishing.

## Step 7: Summary

Provide a clear summary:

- All files created or modified
- Any new shared types and their import paths
- Any actions needed from code owners (route registration, routing changes, etc.)
- How to use the new code (inject services, import components, etc.)
- Remind them to run `/preflight` before submitting a PR
