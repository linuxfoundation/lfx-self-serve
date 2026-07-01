---
type: DataModel
title: Shared Package (@lfx-one/shared)
description: Monorepo-internal package exporting TypeScript interfaces, enums, utility functions, and form validators shared by the Angular app and Express server.
resource: packages/shared/src/
tags: [shared, typescript, interfaces]
---

## Overview

The `@lfx-one/shared` package is the single source of truth for all shared contracts between the Angular frontend (`apps/lfx-one`) and the Express SSR backend. It centralizes TypeScript interfaces, enums, utility functions, and form validators so both sides of the application use identical types and logic. This eliminates duplication, ensures consistency, and makes the data model contract explicit and discoverable.

During development, the path alias `@lfx-one/shared/*` resolves directly to `packages/shared/src/*` via TypeScript path mappings, enabling hot-reloading without rebuilds. Production builds compile to JavaScript via `tsc`.

## Key Contents

### Interfaces (`interfaces/`)

TypeScript interfaces are the primary mechanism for defining data shapes across the platform. All interfaces live in this directory — including component-specific prop types — making them discoverable from a single location and reusable without refactoring.

**Key interface files** (by domain):

- `auth.interface.ts` — `User`, `AuthContext`, `M2MTokenResponse`
- `meeting.interface.ts` — Meeting request/response types, agenda structures
- `committee.interface.ts` — Committee data and member relationships
- `survey.interface.ts` — Survey questions, responses, analytics
- `project.interface.ts` — Project metadata and configurations
- `account.interface.ts` — Organization and account hierarchies
- `vote.interface.ts` — Poll/vote types and results
- `badge.interface.ts` — Credential badge metadata
- `analytics-data.interface.ts` — Metrics and aggregations
- ... and 25+ more domain-specific files

**Conventions**:

- File suffix: `.interface.ts`
- One domain per file (e.g., all meeting-related types in `meeting.interface.ts`)
- Prefer `interface` over union types for extensibility
- JSDoc comments for non-obvious fields, especially upstream API mirrors

### Enums (`enums/`)

Shared string enumerations used on both frontend and backend for type-safe status and category values.

**Files**:

- `committee.enum.ts` — Committee status, member roles
- `meeting.enum.ts` — Meeting types, visibility levels
- `survey.enum.ts` — Survey question types, response status
- `poll.enum.ts` — Poll vote status
- `project-stage.enum.ts` — Project lifecycle stages
- `project-funding.enum.ts` — Funding types and statuses
- `mailing-list.enum.ts` — List types and subscriptions
- `event.enum.ts` — Event categories
- `crowdfunding.enum.ts` — Campaign statuses
- `nats.enum.ts` — NATS event type constants
- `snowflake.enum.ts` — Snowflake status enums
- `search.enum.ts` — Search result types
- `error.enum.ts` — Standardized error codes
- `committee-member.enum.ts` — Member role and status

**Conventions**:

- File suffix: `.enum.ts`
- Use string enums (values readable in logs, JSON, upstream filters)
- One enum per file, grouped by domain

### Utilities (`utils/`)

Pure functions split into two categories:

**Generic Utilities** — Domain-free helpers:

- `date-time.utils.ts` — Timezone-aware date formatting and parsing (date-fns, date-fns-tz)
- `form.utils.ts` — Angular reactive form helpers
- `string.utils.ts` — String manipulation and sanitization
- `url.utils.ts` — URL parsing and validation
- `file.utils.ts` — File type detection and MIME validation
- `html-utils.ts` — HTML sanitization and entity handling
- `color.utils.ts` — Color math and palette generation
- `avatar.utils.ts` — Avatar URL building and fallback logic
- `email.utils.ts` — Email address validation and formatting
- `identity.utils.ts` — User identifier normalization

**Domain-specific Utilities**:

- `meeting.utils.ts` — RSVP calculations, meeting transformations
- `survey.utils.ts` — Response aggregation, NPS calculation
- `poll.utils.ts` — Vote status derivation, result tallying
- `committee.utils.ts` — Member role logic, hierarchy helpers
- `project.utils.ts` — Project context and ownership checks
- `badge.utils.ts` — Badge validation and tier logic
- `insights.utils.ts` — Dashboard metric builders
- `flywheel.utils.ts` — Contribution scoring and calculations
- `crowdfunding.utils.ts` — Campaign stage and progress logic
- `enrollment.utils.ts` — Learning path progression
- `invitation.utils.ts` — Invite token and expiration checks

**Conventions**:

- File suffix: `.utils.ts` (or `.util.ts` for older single-purpose files)
- Pure functions only — no side effects, no I/O
- Security-sensitive utilities (URL validation, file type checking) block dangerous inputs by default
- Minimal runtime dependencies (only `date-fns`, `date-fns-tz`)

### Validators (`validators/`)

Reusable Angular reactive form validators for common input patterns. Export as standalone `ValidatorFn` functions grouped by domain.

**Files**:

- `meeting.validators.ts` — Meeting date/time, title, attendee count validation
- `mailing-list.validators.ts` — Email format, subscription constraints
- `vote.validators.ts` — Option text, vote limit validation
- `survey.validators.ts` — Question validation, response constraints
- `committee.validators.ts` — Role and member constraints

**Conventions**:

- File suffix: `.validators.ts`
- Export as standalone `ValidatorFn` functions
- Import path: `@lfx-one/shared/validators`

### Constants (`constants/`)

Design tokens, API endpoint configuration, and static lookup data. Use `as const` for immutability.

**Content**:

- Design tokens — `lfxColors`, `lfxFontSizes`, spacing scales, typography
- API config — Base URLs, endpoint paths, API versions
- Domain constants — Countries, timezones, t-shirt sizes, currency codes
- Feature flags — Boolean constants for feature availability
- Static lookup tables — Status strings, role definitions, permission matrices

**Organization**:

- File suffix: `.constants.ts`
- Group by domain (e.g., `meeting.constants.ts` for meeting-related defaults)
- Subdirectories allowed for large groupings (e.g., `meeting-templates/`)

## Import Patterns

### Category Imports (Default Style)

```typescript
// Import from category path (uses index.ts barrel)
import { User, AuthContext, MeetingResponse } from '@lfx-one/shared/interfaces';
import { lfxColors, lfxFontSizes } from '@lfx-one/shared/constants';
import { MeetingType, VoteStatus } from '@lfx-one/shared/enums';
import { formatDate, stripHtml, isValidUrl } from '@lfx-one/shared/utils';
import { futureDateTimeValidator, editModeDateTimeValidator } from '@lfx-one/shared/validators';
```

Each subdirectory has its own `index.ts` barrel that re-exports all its contents, enabling these clean category imports.

### Deep Imports (When Needed)

```typescript
// Use only when the category barrel doesn't re-export the symbol
import { User } from '@lfx-one/shared/interfaces/auth.interface';
```

## Hot Reloading During Development

TypeScript path mappings in the root `tsconfig.json` resolve `@lfx-one/shared/*` directly to `packages/shared/src/*`:

```json
{
  "compilerOptions": {
    "paths": {
      "@lfx-one/shared/*": ["packages/shared/src/*"]
    }
  }
}
```

Both category and deep imports hot-reload without rebuilding the shared package. Production builds compile via `tsc` with proper module resolution.

## Adding New Items

1. **Identify the Domain** — Does the item belong to meetings, surveys, committees, etc.?
2. **Find or Create the File** — e.g., `interfaces/meeting.interface.ts` for a new meeting type
3. **Add the Export** — Type, constant, enum, function, or validator
4. **Update the Barrel** — Add export to `interfaces/index.ts`, `constants/index.ts`, etc.
5. **Import via Category Path** — Use `@lfx-one/shared/interfaces` from consuming code

No rebuild needed during development — path mappings resolve immediately.

## Build Process

The package is built with plain `tsc` (no bundler):

```bash
# From repo root
yarn build                           # Builds all packages including @lfx-one/shared
yarn workspace @lfx-one/shared build  # Scoped build
yarn check-types                    # Type-check only (no emit)
```

Outputs TypeScript declarations alongside JavaScript for downstream workspace consumers.

**TypeScript Configuration**:

- Target: ES2022
- Strict mode: enabled
- Module resolution: `bundler`
- See `packages/shared/tsconfig.json` for canonical config

## Dependencies

**Runtime** (within `packages/shared/`):

- `date-fns` — Date/time formatting and utilities
- `date-fns-tz` — Timezone support for date-fns

**Peer** (consumers control versions):

- `@angular/core` — Angular core framework
- `@angular/forms` — Reactive forms
- `rxjs` — Reactive programming
- `@fullcalendar/core` — Calendar integration
- `chart.js` — Charting library
- `snowflake-sdk` — Snowflake JDBC for Node.js

Keep runtime dependencies minimal. Prefer peer dependencies for framework-specific types.

## Dependencies / Consumers

- **Angular Application** (`apps/lfx-one`) — Imports all types, validators, utilities, constants
- **Express Server** (`apps/lfx-one/src/server`) — Imports interfaces and utilities for API types and logic
- **E2E Tests** — Import types for test fixture generation and response validation
- **All npm scripts** — Build, lint, type-check operations depend on @lfx-one/shared compilation

## Related Concepts

- [AuthContext Data Model](./auth-context.md) — User identity, persona, and token management
- [Authentication](../../architecture/backend/authentication.md) — Auth interfaces and token contracts
- [Package Architecture](../../architecture/shared/package-architecture.md) — Detailed package design

## Citations

- Architecture: `docs/architecture/shared/package-architecture.md`
- Source: `packages/shared/src/`
- Configuration: `packages/shared/tsconfig.json`, `packages/shared/package.json`
