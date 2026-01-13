# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📋 Table of Contents

### 🏗 Architecture & Setup

- [Project Overview](#project-overview) - Turborepo monorepo with Angular 19 SSR
- [Monorepo Structure](#monorepo-structure) - Apps, packages, and organization
- [Application Architecture](#application-architecture) - Directory structure and patterns
- [Common Commands](#common-commands) - Development and production commands

### 🚀 Development Patterns

- [Angular 19 Development Patterns](#angular-19-development-patterns) - Zoneless change detection, signals, components
- [Component Organization Pattern](#component-organization-pattern) - Standardized component structure
- [Shared Package (@lfx-one/shared)](#shared-package-lfx-oneshared) - Types, interfaces, constants
- [PrimeNG Component Wrappers](#primeng-component-wrappers) - UI library abstraction
- [Path Mappings](#path-mappings) - Import aliases and conventions

### 🎨 UI & Layout

- [CSS Architecture & Styling](#css-architecture--styling) - Tailwind, fonts, theming

### 🔧 Technical Stack

- [Frontend Technologies](#frontend-technologies) - Angular 19, PrimeNG, Tailwind
- [Backend Stack](#backend-stack) - Express.js server with SSR
- [Development Tools](#development-tools) - ESLint, Prettier, Turborepo
- [Code Quality](#code-quality) - Linting and formatting standards

### 🚀 Operations

- [Authentication & Authorization](#authentication--authorization) - Auth0 integration
- [Logging](#logging) - Pino structured logging
- [Server-Side Rendering (SSR)](#server-side-rendering-ssr) - Angular 19 built-in SSR
- [Production Deployment](#production-deployment) - PM2, health checks
- [Testing](#testing) - Test framework and commands
- [Environment Configuration](#environment-configuration) - Dev/prod setup

### 📚 Documentation Links

- [Component Architecture](docs/architecture/frontend/component-architecture.md) - Detailed wrapper patterns
- [Angular Patterns](docs/architecture/frontend/angular-patterns.md) - Angular 19 development
- [Styling System](docs/architecture/frontend/styling-system.md) - CSS and theming
- [Authentication](docs/architecture/backend/authentication.md) - Auth0 setup
- [SSR Server](docs/architecture/backend/ssr-server.md) - Server-side rendering
- [Logging & Monitoring](docs/architecture/backend/logging-monitoring.md) - Structured logging
- [E2E Testing](docs/architecture/testing/e2e-testing.md) - Comprehensive end-to-end testing with dual architecture
- [Testing Best Practices](docs/architecture/testing/testing-best-practices.md) - Testing patterns and implementation guide

### 💡 Quick Reference

- [Application Flow](#application-flow) - User journey and navigation
- [Current State & Development Roadmap](#current-state--development-roadmap) - Implementation status
- [Development Memories](#development-memories) - Important reminders and patterns

## Project Overview

LFX One is a Turborepo monorepo containing an Angular 19 SSR application with experimental zoneless change detection and Express.js server.

## Monorepo Structure

```text
lfx-v2-ui/
├── apps/
│   └── lfx-one/              # Angular 19 SSR application with zoneless change detection
│       ├── eslint.config.mjs # Angular-specific ESLint rules
│       ├── .prettierrc       # Prettier configuration with Tailwind integration
│       └── tailwind.config.js # Tailwind with PrimeUI plugin and LFX colors
├── packages/
│   └── shared/               # Shared types, interfaces, constants, and enums
│       ├── src/
│       │   ├── interfaces/   # TypeScript interfaces for components, auth, projects
│       │   ├── constants/    # Design tokens (colors, font-sizes)
│       │   └── enums/        # Shared enumerations
│       ├── package.json      # Package configuration with proper exports
│       └── tsconfig.json     # TypeScript configuration
├── docs/                     # Architecture and deployment documentation
├── turbo.json               # Turborepo pipeline configuration
├── ecosystem.config.js      # PM2 production configuration
└── package.json             # Root workspace configuration
```

[... rest of the existing content remains unchanged ...]

## Component Organization Pattern

When creating Angular components with signals and computed values, follow this structure:

### 1. WritableSignals - Initialize directly for simple values

Simple WritableSignals with basic initial values should be initialized inline:

```typescript
export class MyComponent {
  // Simple WritableSignals - initialize directly
  public loading = signal(false);
  public count = signal(0);
  public name = signal('');
  public items = signal<string[]>([]);
}
```

### 2. Model Signals - Use for two-way binding

For properties that require two-way binding (e.g., dialog visibility, form values), use `model()` instead of `signal()`:

```typescript
import { model } from '@angular/core';

export class MyComponent {
  // Two-way binding properties - use model()
  public visible = model(false);
  public selectedValue = model<string>('');
}
```

In templates, model signals can use the `[(ngModel)]`-style two-way binding syntax:

```html
<!-- Two-way binding with model() - cleaner syntax -->
<p-dialog [(visible)]="visible">...</p-dialog>

<!-- Regular signals would require split binding -->
<p-dialog [visible]="visible()" (visibleChange)="visible.set($event)">...</p-dialog>
```

### 3. Computed/toSignal - Use private init functions for complex logic

Computed signals and toSignal conversions with complex logic should use private initializer functions:

```typescript
export class MyComponent {
  // Simple WritableSignals - direct initialization
  public loading = signal(false);
  public searchTerm = signal('');

  // Complex computed/toSignal - use private init functions
  public filteredItems: Signal<Item[]> = this.initFilteredItems();
  public dataFromServer: Signal<Data[]> = this.initDataFromServer();

  // Private initializer functions at the bottom of the class
  private initFilteredItems(): Signal<Item[]> {
    return computed(() => {
      const term = this.searchTerm().toLowerCase();
      return this.items().filter((item) => item.name.toLowerCase().includes(term));
    });
  }

  private initDataFromServer(): Signal<Data[]> {
    return toSignal(
      toObservable(this.event).pipe(
        filter((event) => !!event?.id),
        switchMap((event) => this.service.getData(event.id)),
        catchError(() => of([] as Data[]))
      ),
      { initialValue: [] as Data[] }
    );
  }
}
```

### 4. Component structure order

1. Private injections (with `readonly`)
2. Public fields from inputs/dialog data (with `readonly`)
3. Forms
4. Model signals for two-way binding (`model()`)
5. Simple WritableSignals (direct initialization)
6. Complex computed/toSignal signals (via private init functions)
7. Constructor
8. Public methods
9. Protected methods
10. Private initializer functions (grouped together)
11. Other private helper methods

### 5. Interfaces belong in the shared package

All interfaces, even component-specific ones, should be defined in `@lfx-one/shared/interfaces`. This ensures:

- Consistent type definitions across the codebase
- Reusability if the interface is needed elsewhere later
- Clear separation of type definitions from implementation

```typescript
// ❌ Don't define interfaces locally in components
interface RelativeDateInfo {
  text: string;
  color: string;
}

// ✅ Import from shared package
import { RelativeDateInfo } from '@lfx-one/shared/interfaces';
```

## Development Memories

- Always reference PrimeNG's component interface when trying to define types
- The project logo display is currently hardcoded but will be dynamic once API is integrated
- Metrics data is hardcoded but structured to match future API responses
- All PrimeNG components are wrapped in LFX components for UI library independence
- Always use direct imports for standalone components - no barrel exports
- **Authentication uses selective pattern** - public routes bypass auth, protected routes require authentication
- **Public routes include** `/meeting` and `/public/api` endpoints
- **M2M tokens are used** for server-side API calls from public endpoints
- **Protected routes middleware** handles selective authentication logic
- **Custom login handler** at `/login` with URL validation and secure redirects
- Authentication is handled by Auth0/Authelia with express-openid-connect middleware

## Logging System

### Architecture Overview

- **Base Logger**: `serverLogger` created in `server.ts` - base Pino instance with all configuration
- **HTTP Logger**: `pinoHttp` middleware uses `serverLogger` as base, creates `req.log` for each request
- **Logger Service**: Singleton service (`logger.service.ts`) - unified interface for all application logging
- **Format**: Structured JSON logs with Pino for AWS CloudWatch compatibility

### Logger Service Pattern (Primary Interface)

**Import and Usage:**

```typescript
import { logger } from './logger.service';

// In controllers/routes with request context:
const startTime = logger.startOperation(req, 'operation_name', metadata);
logger.success(req, 'operation_name', startTime, metadata);

// In services/utilities without request context:
const startTime = logger.startOperation(undefined, 'nats_connect', metadata);
logger.success(undefined, 'nats_connect', startTime, metadata);
```

**Available Methods:**

- `logger.startOperation(req|undefined, 'operation', metadata, options?)` → Returns startTime, logs at INFO (silent option available)
- `logger.success(req|undefined, 'operation', startTime, metadata)` → Logs at INFO with duration
- `logger.error(req|undefined, 'operation', startTime, error, metadata, options?)` → Logs at ERROR with 'err' field
- `logger.info(req|undefined, 'operation', message, metadata)` → Logs at INFO for significant operations
- `logger.warning(req|undefined, 'operation', message, metadata)` → Logs at WARN
- `logger.validation(req|undefined, 'operation', errors[], metadata)` → Logs at ERROR with validation details
- `logger.debug(req|undefined, 'operation', message, metadata)` → Logs at DEBUG
- `logger.etag(req|undefined, 'operation', resourceType, resourceId, etag?, metadata)` → Logs ETag operations

**When to Use Each Pattern:**

- **Request-scoped** (pass `req`): Controllers, route handlers, service methods called from routes
- **Infrastructure** (pass `undefined`): NATS connections, Snowflake pool, server startup/shutdown, scheduled jobs

### Logging Layer Responsibility

**Controllers (HTTP Boundary):**

- ✅ **Always** use `logger.startOperation()` / `logger.success()` / `logger.error()` for HTTP operations
- Operation names should match HTTP semantics (e.g., `get_meeting_rsvps`, `create_meeting`)
- Duration represents full HTTP request → response cycle
- One startOperation per HTTP endpoint

**Services (Business Logic):**

- ✅ **Always** use `logger.debug()` for step-by-step tracing
- ✅ Use `logger.info()` for significant business operations visible in production:
  - Data transformations (V1→V2 conversions)
  - Data enrichment (adding project names, committee data)
  - Complex multi-step orchestrations
  - Operations with notable business impact
- ✅ Use `logger.warning()` for recoverable errors when returning null/empty arrays
- ❌ **Never** use `logger.startOperation()` with the same operation name as the calling controller
- ❌ **Never** call `serverLogger` directly

**Why This Pattern:**

- Prevents duplicate logging (no double startOperation calls)
- Clear separation: Controllers log HTTP, Services log business logic
- Production visibility: INFO logs for significant operations, DEBUG for detailed tracing
- Consistent duration semantics: HTTP duration in controllers, not inflated by double-counting

### Error Logging Standard

**Always use `err` field** for proper error serialization:

```typescript
// ✅ CORRECT
logger.error(req, 'operation', startTime, error, metadata);
logger.error(undefined, 'operation', startTime, error, metadata);

// ❌ INCORRECT
serverLogger.error({ error: error.message }, 'message'); // Don't use serverLogger directly
req.log.error({ error: error }, 'message'); // Should use logger service
{
  error: error.message;
} // Loses stack trace
```

**Benefits:**

- Complete stack traces in production/debug
- Clean single-line errors in development
- Proper AWS CloudWatch format
- Custom serializer: `/server/helpers/error-serializer.ts`

### Log Level Guidelines

**INFO** - Business operation completions and significant operations:

- **In Controllers**: HTTP operation success with duration (via `startOperation` / `success`)
- **In Services**: Significant business operations visible in production (via `logger.info()`):
  - Data transformations (V1→V2 conversions)
  - Data enrichment (project names, committee data)
  - Complex orchestrations
  - Operations with notable business impact

**WARN** - Recoverable issues:

- Error conditions with graceful degradation (returning null/empty arrays)
- Data quality issues, user not found
- Fallback behaviors, NATS failures with graceful handling
- Service errors that don't propagate to controller

**DEBUG** - Internal operations and tracing:

- **In Services**: Step-by-step operation tracing
- Method entry/exit with key parameters
- Preparation steps (sanitizing, creating payload)
- Internal lookups (NATS, database queries)
- Simple data fetches
- Infrastructure operations (connections, pool state)

**ERROR** - Critical failures:

- **In Controllers**: HTTP operation failures (via `logger.error()` with startTime)
- System failures, unhandled exceptions
- Critical errors requiring immediate attention
- Operations that cannot continue

### Features

- **Deduplication**: Prevents duplicate logs for same operation (request-scoped only)
- **Duration Tracking**: Automatic calculation from startTime to completion
- **Request Correlation**: `request_id` field for tracing (when req provided)
- **Sensitive Data Redaction**: Automatic redaction of tokens, auth headers, cookies
- **AWS Trace ID**: Automatic capture from Lambda environment
- **Filtered URLs**: Health checks (`/health`, `/api/health`) and `/.well-known` not logged

### Logging Architecture

```text
server-logger.ts (breaks circular dependency)
  └─ Creates and exports serverLogger (base Pino instance)
      └─ Configuration: levels, serializers, formatters, redaction

server.ts
  ├─ Imports serverLogger from server-logger.ts
  └─ Creates httpLogger (pinoHttp middleware)
      └─ Uses serverLogger as base
      └─ Attaches req.log to each request

logger.service.ts
  ├─ Imports serverLogger from server-logger.ts
  └─ Singleton logger service
      ├─ Request-scoped: uses req.log when req provided
      ├─ Infrastructure: uses serverLogger when req = undefined
      └─ Provides unified API for all logging
```

**Direct serverLogger Usage:**

- ❌ **Never** call `serverLogger` directly from services/routes/controllers
- ✅ **Always** use `logger` service methods
- ℹ️ `serverLogger` only exists in `server-logger.ts` (created), `server.ts` (imported), and `logger.service.ts` (imported)

### Common Logging Patterns

**Controller/Route Handler Pattern:**

```typescript
export const getUser = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = logger.startOperation(req, 'get_user', { userId: req.params.id });

  try {
    const user = await userService.getUserById(req, req.params.id);

    logger.success(req, 'get_user', startTime, { userId: user.id });
    return res.json(user);
  } catch (error) {
    logger.error(req, 'get_user', startTime, error, { userId: req.params.id });
    return next(error);
  }
};
```

**Service Method - Simple (DEBUG only):**

```typescript
public async getUserById(req: Request, userId: string): Promise<User> {
  logger.debug(req, 'get_user_by_id', 'Fetching user from database', { userId });

  const user = await this.database.findUser(userId);

  return user;
}
```

**Service Method - Complex (INFO + DEBUG):**

```typescript
public async getMeetings(req: Request, query: QueryParams): Promise<Meeting[]> {
  logger.debug(req, 'get_meetings', 'Starting meeting fetch', { query });

  const { resources } = await this.microserviceProxy.proxyRequest(...);

  logger.debug(req, 'get_meetings', 'Fetched resources', { count: resources.length });

  // Significant transformation - use INFO level for production visibility
  if (isV1) {
    logger.info(req, 'transform_v1_meetings', 'Transforming V1 meetings to V2 format', {
      count: resources.length,
    });
    meetings = meetings.map(transformV1MeetingToV2);
  }

  // Enrichment step - DEBUG for tracing
  logger.debug(req, 'get_meetings', 'Enriching with project names', { count: meetings.length });
  meetings = await this.enrichWithProjects(req, meetings);

  // Significant enrichment - use INFO level
  if (meetings.some((m) => m.committees?.length > 0)) {
    logger.info(req, 'enrich_committees', 'Enriching meetings with committee data', {
      total_meetings: meetings.length,
    });
    meetings = await this.getMeetingCommittees(req, meetings);
  }

  logger.debug(req, 'get_meetings', 'Completed meeting fetch', { final_count: meetings.length });

  return meetings;
}
```

**Service Method - Graceful Error Handling:**

```typescript
public async getPastMeetingRecording(req: Request, meetingUid: string): Promise<Recording | null> {
  logger.debug(req, 'get_past_meeting_recording', 'Fetching recording', { meeting_uid: meetingUid });

  try {
    const { resources } = await this.microserviceProxy.proxyRequest(...);

    if (!resources || resources.length === 0) {
      logger.warning(req, 'get_past_meeting_recording', 'No recording found', {
        meeting_uid: meetingUid,
      });
      return null;
    }

    return resources[0].data;
  } catch (error) {
    logger.warning(req, 'get_past_meeting_recording', 'Failed to fetch recording, returning null', {
      meeting_uid: meetingUid,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}
```

**Infrastructure Operation (No Request Context):**

```typescript
public async connect(): Promise<void> {
  const startTime = logger.startOperation(undefined, 'db_connect', { host: this.config.host });

  try {
    await this.pool.connect();
    logger.success(undefined, 'db_connect', startTime, { poolSize: this.pool.size });
  } catch (error) {
    logger.error(undefined, 'db_connect', startTime, error, { host: this.config.host });
    throw error;
  }
}
```

**Internal Service Operation (Called from method with req):**

```typescript
// Parent method has req
public async getProjectBySlug(req: Request, slug: string): Promise<Project> {
  return this.fetchFromNats(req, slug); // Pass req down
}

// Internal method receives req for logging correlation
private async fetchFromNats(req: Request, slug: string): Promise<Project> {
  logger.debug(req, 'fetch_from_nats', 'Fetching project from NATS', { slug });
  // ... implementation
}
```

### Logging Checklist

**Before logging:**

- [ ] Using `logger` service, not `serverLogger` directly?
- [ ] Passing `req` if available, `undefined` if infrastructure?
- [ ] Using `err` field for errors (not `error`)?
- [ ] Appropriate log level (INFO/WARN/DEBUG/ERROR)?
- [ ] Operation name in snake_case?
- [ ] Sensitive data sanitized?

**For Controllers:**

- [ ] Using `logger.startOperation()` for HTTP operations?
- [ ] Calling `logger.success()` or `logger.error()` with `startTime`?
- [ ] Not duplicating service-level logging?

**For Services:**

- [ ] Using `logger.debug()` for step-by-step tracing?
- [ ] Using `logger.info()` for significant operations (transformations, enrichments)?
- [ ] Using `logger.warning()` for graceful error handling (returning null/empty)?
- [ ] NOT using `logger.startOperation()` if controller already logs the same operation?
- [ ] Passing relevant metadata for debugging?
- All shared types, interfaces, and constants are centralized in @lfx-one/shared package
- **AI Service Integration**: Claude Sonnet 4 model via LiteLLM proxy for meeting agenda generation
- **AI Environment Variables**: AI_PROXY_URL and AI_API_KEY required for AI functionality
- **M2M Environment Variables**: M2M_AUTH_CLIENT_ID, M2M_AUTH_CLIENT_SECRET for machine-to-machine auth
- Use TypeScript interfaces instead of union types for better maintainability
- Shared package uses direct source imports during development for hot reloading
- **Interfaces go into the shared packages**
- **License headers are required on all source files** - run `./check-headers.sh` to verify
- **Pre-commit hooks enforce license headers** - commits will fail without proper headers
- Always run yarn format from the root of the project to ensure formatting is done after you have made all your changes
- Always prepend "Generated with [Claude Code](https://claude.ai/code)" if you assisted with the code
- Do not nest ternary expressions
- Always run yarn lint before yarn build to validate your linting
- The JIRA project key for this is LFXV2. All tickets associated to this repo should generally be in there.
- **E2E tests use dual architecture** - both content-based (_.spec.ts) and structural (_-robust.spec.ts) tests
- **Always add data-testid attributes** when creating new components for reliable test targeting
- **Run yarn e2e before major changes** to ensure all 85+ tests pass consistently
- **Use data-testid naming convention** - `[section]-[component]-[element]` for hierarchical structure
- **Test responsive behavior** - validate mobile, tablet, and desktop viewports appropriately
- When running tests to validate UI tests, use reporter=list
- Follow Angular commit conventions: `type(scope): description`
- Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Scope should be lowercase and describe the affected area (e.g., auth, ui, api, docs) and follow the angular scope conventions
- Use present tense, imperative mood: "add feature" not "added feature"
- Examples:
  - `feat(auth): add OAuth2 integration`
  - `fix(ui): resolve mobile button alignment`
- All commits and pull requests need to be associated to a JIRA ticket. If there isn't one, we need to create it and reference it moving forward.
- Branch names should be following the commit types (feat,fix,docs, etc) followed by the JIRA ticket number. i.e; feat/LFXV2-123 or ci/LFXV2-456
- PR titles must also follow a similar format as conventional commits - `type(scope): description`. The scope has to follow the angular config for conventional commit and not include the JIRA ticket in the title, and everything should be in lowercase.
- All interfaces, reusable constants, and enums should live in the shared package.

## Commit Workflow with JIRA Tracking

Before starting any work or commits:

1. **Check if there is a JIRA ticket** we always want to track our work. Do not use discarded or resolved tickets
2. **Create JIRA ticket if needed** for untracked work
3. **Include JIRA ticket in commit message** (e.g., LFXV2-XXX)
4. **Link PR to JIRA ticket** when creating pull requests

- Always use sequential thinking mcp for planning before doing any changes
- Always run yarn build to validate that your changes are building too for validation
- Always remember that our JIRA sprint field is customfield_10020. When we create tickets, we need to assign them to the current user and set it to the current sprint.
- Always use `flex + flex-col + gap-*` instead of `space-y-*`
