---
name: develop
description: >
  Guided development workflow for building, fixing, updating, or refactoring
  code — components, services, backend endpoints, shared types, or full features.
  Use whenever someone wants to add a feature, fix a bug, modify existing code,
  create something new, refactor, or implement any code change.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
---

# LFX One Development Guide

You are helping a contributor build within the LFX One codebase. This skill handles all development work: creating new features, fixing bugs, modifying existing code, refactoring, and full end-to-end feature builds.

**Important:** You are integrating features within existing architecture — not making architectural decisions. If the work requires changes to routing, auth, middleware, or infrastructure, flag it for a code owner.

## Step 1: Start from Latest Main & Track Work

Follow the "Starting New Work" rule in `development-rules.md` — checkout `main`, pull latest, and create a feature branch before writing any code.

### JIRA Ticket

Before writing code, ensure the work is tracked:

1. **Check for an existing JIRA ticket** in the `LFXV2` project
2. **Create one if needed** — assign to the current user and current sprint
3. **Branch name must include the ticket:** `feat/LFXV2-<number>`, `fix/LFXV2-<number>`, etc.
4. Reference `.claude/rules/commit-workflow.md` for naming conventions

## Step 2: Plan the Feature (Ideation)

Ask the contributor what they're building. Before writing any code, create a plan that answers:

1. **What is the feature?** — Describe the user-facing behavior
2. **What data does it need?** — Identify the API endpoints, request/response shapes, and data flow
3. **What upstream APIs are required?** — List which microservice endpoints the feature depends on
4. **Do the upstream microservices already support this?** — This is critical (see Step 3)
5. **What frontend components are needed?** — Pages, shared components, services

Based on the plan, determine which workflow(s) apply:

| Workflow               | When to Use                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| **Shared Types**       | New interfaces, enums, or constants needed                                |
| **Backend Endpoint**   | New API route with controller + service in this repo                      |
| **Frontend Service**   | New Angular service or methods on an existing one                         |
| **Frontend Component** | New Angular component (page, module-specific, shared, or PrimeNG wrapper) |
| **Full Feature**       | End-to-end integration (combines multiple workflows above)                |

**Build order is strict:** Shared Types → Backend → Frontend Service → Frontend Component. Never skip ahead.

### Modifying Existing Features

If the work is a bug fix, enhancement, or refactoring of existing code:

1. **Read existing code first** — understand what's there before changing it
2. **Trace the data flow end-to-end** — from API call through service to component template
3. **Identify the minimal change** with the smallest blast radius
4. **Follow the same build order** for any new files needed (types → backend → frontend)

## Step 3: Validate Backend Support (Backend First)

**Before writing any frontend code**, verify that the upstream microservice APIs needed for this feature actually exist and support the required operations.

### Check the Upstream API Contract

The LFX One backend is a thin proxy layer — it proxies requests to external Go microservices. The feature can only work if those microservices expose the endpoints you need.

| Domain            | External Repo                                                                                 | Key Areas to Check                                |
| ----------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Queries**       | [lfx-v2-query-service](https://github.com/linuxfoundation/lfx-v2-query-service)               | Resource types, query params, pagination, filters |
| **Projects**      | [lfx-v2-project-service](https://github.com/linuxfoundation/lfx-v2-project-service)           | Project CRUD, slugs, membership                   |
| **Meetings**      | [lfx-v2-meeting-service](https://github.com/linuxfoundation/lfx-v2-meeting-service)           | Meeting CRUD, RSVPs, recordings, calendar         |
| **Mailing Lists** | [lfx-v2-mailing-list-service](https://github.com/linuxfoundation/lfx-v2-mailing-list-service) | Groups.io integration, subscriptions              |
| **Committees**    | [lfx-v2-committee-service](https://github.com/linuxfoundation/lfx-v2-committee-service)       | Committee CRUD, membership, roles                 |
| **Voting**        | [lfx-v2-voting-service](https://github.com/linuxfoundation/lfx-v2-voting-service)             | Poll CRUD, casting votes, results                 |
| **Surveys**       | [lfx-v2-survey-service](https://github.com/linuxfoundation/lfx-v2-survey-service)             | Survey CRUD, responses, NPS analytics             |

```bash
# Read the OpenAPI spec for the full API contract
gh api repos/linuxfoundation/<repo-name>/contents/gen/http/openapi3.yaml \
  --jq '.content' | base64 -d

# Browse the Goa DSL design files
gh api repos/linuxfoundation/<repo-name>/contents/design --jq '.[].name'

# Read a specific Goa design file
gh api repos/linuxfoundation/<repo-name>/contents/design/<file>.go \
  --jq '.content' | base64 -d
```

### If the API Does NOT Exist

**STOP. Do not proceed to frontend work.** Instead:

1. **Switch to the upstream microservice repo** — clone it and check if it has its own Claude Code skills (`/develop`, etc.) that should be used for building there
2. **Build the required API endpoints** in the upstream repo first, following that repo's conventions and skills
3. **Get the upstream changes merged and deployed** (or at minimum, confirm the API contract is finalized)
4. **Then return to this repo** to build the proxy layer and frontend

### If the API Exists

Confirm:

- The endpoint paths and HTTP methods match what you need
- The request/response schemas have the fields your feature requires
- Query parameters support the filtering/pagination your UI needs

Then proceed to Step 4.

> **Critical rule: NO mock data, NO placeholder APIs, NO fake responses.** Every API call in the frontend must connect to a real, working backend endpoint. If the data doesn't flow end-to-end, the feature is not ready to be built. Do not stub services, hardcode responses, or create temporary mocks to "unblock" frontend work.

## Step 4: Required Reading

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

## Step 5: Check What Exists

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

## Step 6: Read an Existing Example

Read a representative file in the target area to match the team's current patterns. Pick something in the same module or domain as the work being done.

## Step 7: Build

Follow the workflow(s) identified in Step 2. The sections below provide key conventions for each — **read the linked reference file** for full details, examples, and checklists.

> **Reminder:** Build in strict order — Shared Types → Backend → Frontend Service → Frontend Component. Never build frontend code against APIs that don't exist yet. No mock data, no placeholder services, no hardcoded responses.

---

### Shared Types

**Location:** `packages/shared/src/interfaces/`, `enums/`, or `constants/`

Key rules: License headers, TypeScript interfaces (not union types), correct file suffixes, barrel exports, never define interfaces locally.

**Read `references/shared-types.md`** for full conventions and checklist.

---

### Backend Endpoint

Creates three files: **service** → **controller** → **route**.

Key rules: `MicroserviceProxyService` for API calls, `logger` service for logging, `next(error)` for errors, snake_case operation names, `server.ts` registration requires code owner.

**Read `references/backend-endpoint.md`** for full patterns, examples, and checklist.

---

### Frontend Service

**Location:** `apps/lfx-one/src/app/shared/services/<name>.service.ts`

Key rules: `providedIn: 'root'`, `inject(HttpClient)`, `catchError` for GETs, `take(1)` for writes, signals can't use rxjs pipes.

**Read `references/frontend-service.md`** for full patterns, examples, and checklist.

---

### Frontend Component

Key rules: Standalone with direct imports, correct placement per category, 11-section class structure, `@if`/`@for` templates, `data-testid` attributes, `flex + gap` not `space-y`.

**Read `references/frontend-component.md`** for full placement table, examples, and checklist.

---

## Step 8: Validate

Run the full validation suite:

```bash
yarn lint          # Check for linting errors
yarn format        # Apply formatting
yarn build         # Verify build succeeds
```

Fix any issues before finishing.

## Step 9: Summary & Next Steps

Provide a clear summary:

- All files created or modified
- Any new shared types and their import paths
- Any actions needed from code owners (route registration, routing changes, etc.)
- How to use the new code (inject services, import components, etc.)

**Next step:** Run `/preflight` to validate everything before submitting a PR.
