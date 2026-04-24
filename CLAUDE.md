# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LFX One is a Turborepo monorepo containing an Angular 20 SSR application with stable zoneless change detection and Express.js server.

## Monorepo Structure

```text
lfx-v2-ui/
├── apps/
│   └── lfx-one/              # Angular 20 SSR application with stable zoneless change detection
│       ├── src/app/
│       │   ├── layouts/      # Layout components (main-layout, profile-layout)
│       │   ├── modules/      # Feature modules (see Feature Modules section)
│       │   └── shared/       # Shared application code
│       │       ├── components/   # UI components (PrimeNG wrappers + LFX primitives)
│       │       ├── directives/   # Custom directives (on-render, scroll-shadow)
│       │       ├── guards/       # Route guards (auth, writer, executive-director)
│       │       ├── interceptors/ # HTTP interceptors (authentication)
│       │       ├── pipes/        # Custom pipes
│       │       ├── providers/    # App providers (datadog-rum, feature-flag, runtime-config)
│       │       ├── services/     # Frontend services
│       │       ├── strategies/   # Routing strategies (custom-preloading)
│       │       └── utils/        # App utilities (console-override, download-card, http-error, etc.)
│       ├── src/server/       # Express.js SSR server
│       │   ├── constants/    # Server-only constants
│       │   ├── controllers/  # Route controllers
│       │   ├── errors/       # Custom error classes (base, authentication, microservice, service-validation)
│       │   ├── helpers/      # Server helpers (api-gateway, error-serializer, http-status, ics, meeting, poll-endpoint, query-service, url-validation, validation)
│       │   ├── middleware/   # Express middleware (auth, error-handler, rate-limit)
│       │   ├── pdf-templates/ # PDF generation templates (e.g., visa-letter-manual)
│       │   ├── routes/       # API route definitions
│       │   ├── services/     # Backend services (api-client, microservice-proxy, nats, snowflake, etc.)
│       │   ├── utils/        # Server utilities (auth-helper, lock-manager, m2m-token, persona-helper, security)
│       │   ├── server.ts     # Express server entry point
│       │   ├── server-logger.ts # Pino logger configuration
│       │   └── server-tracer.ts # OpenTelemetry tracer configuration
│       ├── e2e/              # Playwright E2E tests (dual architecture: content + structural)
│       ├── playwright/       # Playwright helpers and fixtures
│       ├── eslint.config.js  # Angular-specific ESLint rules
│       ├── .prettierrc.js    # Prettier configuration with Tailwind integration
│       ├── ecosystem.config.js # PM2 production configuration
│       ├── otel.mjs          # OpenTelemetry instrumentation bootstrap
│       ├── postcss.config.js # PostCSS configuration (Tailwind + autoprefixer)
│       └── tailwind.config.js # Tailwind with PrimeUI plugin and LFX colors
├── packages/
│   └── shared/               # Shared types, interfaces, constants, utilities, and validators
│       ├── src/
│       │   ├── interfaces/   # TypeScript interface files (meetings, committees, auth, projects, etc.)
│       │   ├── constants/    # Constant files (design tokens, API config, domain constants)
│       │   ├── enums/        # Shared enumerations (committee, meeting, poll, survey, etc.)
│       │   ├── utils/        # Utility modules (date, string, url, meeting, poll, survey, project, etc.)
│       │   └── validators/   # Form validators (meeting, mailing-list, vote)
│       ├── package.json      # Package configuration with proper exports
│       └── tsconfig.json     # TypeScript configuration
├── docs/                     # Architecture and deployment documentation
├── turbo.json               # Turborepo pipeline configuration
└── package.json             # Root workspace configuration
```

## Feature Modules

The application is organized into feature modules under `apps/lfx-one/src/app/modules/`:

| Module            | Description                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| **badges**        | LFX badges — view and manage credentialing badges earned across projects         |
| **committees**    | Committee management — view, create, and manage project committees               |
| **dashboards**    | Lens-based dashboards (Me, Foundation, Project, Org) and supporting drawers      |
| **documents**     | Document management — browse and manage project documents                        |
| **events**        | Events — browse LFX events and manage attendance                                 |
| **mailing-lists** | Mailing list management — subscribe, unsubscribe, and manage lists               |
| **meetings**      | Meeting scheduling — create, manage, and join meetings with calendar integration |
| **profile**       | User profile — profile management and account settings                           |
| **settings**      | Application settings — preferences and configuration                             |
| **surveys**       | Survey management — create surveys, collect responses, view NPS analytics        |
| **trainings**     | Training enrollments — view and manage training programs                         |
| **transactions**  | Transactions — view billing / purchase history                                   |
| **votes**         | Voting system — create polls, cast votes, and view results                       |

## Shared Package

The shared package (`@lfx-one/shared`) provides utility modules in `packages/shared/src/utils/`:

**Generic Utilities:**

- `date-time.utils.ts` - Date formatting, timezone handling (`formatDate`, `formatTime`, `getRelativeDate`)
- `string.utils.ts` - String manipulation (`parseToInt`, `truncate`)
- `url.utils.ts` - URL parsing and construction (`buildUrl`, `parseQueryParams`)
- `file.utils.ts` - File type detection (`getFileType`, `getFileExtension`)
- `form.utils.ts` - Form helpers (`markFormControlsAsTouched`)
- `html-utils.ts` - HTML sanitization (`stripHtml`)
- `color.utils.ts` - Color manipulation utilities

**Domain-Specific Utilities:**

- `meeting.utils.ts` - Meeting data helpers
- `poll.utils.ts` - Poll/voting calculation utilities
- `survey.utils.ts` - Survey data processing
- `vote.utils.ts` - Vote data utilities
- `rsvp-calculator.util.ts` - RSVP statistics calculation

**Usage:**

```typescript
import { formatDate, getRelativeDate } from '@lfx-one/shared/utils';
import { buildUrl, parseQueryParams } from '@lfx-one/shared/utils';
```

> **Note**: Domain-specific utilities (meetings, surveys, polls, etc.) are also available. See [Package Architecture docs](docs/architecture/shared/package-architecture.md) for complete documentation including validators.

## Shared Package Validators

The shared package provides form validators in `packages/shared/src/validators/`. Import and use them in Angular reactive forms as needed.

> **Note**: See [Package Architecture docs](docs/architecture/shared/package-architecture.md) for validator details and usage examples.

## Development Memories

- Always reference PrimeNG's component interface when trying to define types
- All PrimeNG components are wrapped in LFX components for UI library independence
- Always use direct imports for standalone components - no barrel exports
- **Authentication uses selective pattern** - public routes bypass auth, protected routes require authentication
- **Public routes include** `/meeting` and `/public/api` endpoints
- **M2M tokens are used** for server-side API calls from public endpoints
- **Custom login handler** at `/login` with URL validation and secure redirects
- Authentication is handled by Auth0/Authelia with express-openid-connect middleware

## Rule Files

Detailed patterns are in `.claude/rules/` and loaded contextually based on file globs:

| Rule File                   | Glob                | Topics                                                                      |
| --------------------------- | ------------------- | --------------------------------------------------------------------------- |
| `component-organization.md` | `**/*.component.ts` | Signal initialization, component structure order, model signals, interfaces |
| `logging-patterns.md`       | `**/server/**`      | Logger service API, layer responsibilities, log levels, code examples       |
| `development-rules.md`      | `*`                 | Shared package, license headers, testing, formatting, doc maintenance       |
| `commit-workflow.md`        | `*`                 | Commit conventions, branch naming, PR format, PR sizing, JIRA tracking      |
| `skill-guidance.md`         | `*`                 | Guides Claude to suggest `/setup`, `/develop`, `/preflight` skills          |

## Architecture Documentation

| Document                                                                       | Topics                                                           |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [Angular Patterns](docs/architecture/frontend/angular-patterns.md)             | Zoneless change detection, signals, components                   |
| [Component Architecture](docs/architecture/frontend/component-architecture.md) | PrimeNG wrapper patterns                                         |
| [Lens & Persona System](docs/architecture/frontend/lens-system.md)             | `LensService`, persona detection, `ProjectContextService`        |
| [Styling System](docs/architecture/frontend/styling-system.md)                 | Tailwind, fonts, theming                                         |
| [Drawer Pattern](docs/architecture/frontend/drawer-pattern.md)                 | Drawer components, lazy loading, chart integration               |
| [Backend Architecture](docs/architecture/backend/README.md)                    | Controller-Service pattern, Express.js server                    |
| [Authentication](docs/architecture/backend/authentication.md)                  | Auth0 setup, selective auth middleware                           |
| [Impersonation](docs/architecture/backend/impersonation.md)                    | User impersonation via Auth0 CTE                                 |
| [Rate Limiting](docs/architecture/backend/rate-limiting.md)                    | `express-rate-limit` budgets for `/api`, `/public/api`, `/login` |
| [Observability](docs/architecture/backend/observability.md)                    | OpenTelemetry auto-instrumentation, custom spans                 |
| [SSR Server](docs/architecture/backend/ssr-server.md)                          | Server-side rendering                                            |
| [Logging & Monitoring](docs/architecture/backend/logging-monitoring.md)        | Structured logging with Pino                                     |
| [Error Handling](docs/architecture/backend/error-handling-architecture.md)     | Error classification, middleware                                 |
| [Server Helpers](docs/architecture/backend/server-helpers.md)                  | Validation, pagination, URL utilities                            |
| [Pagination](docs/architecture/backend/pagination.md)                          | Cursor-based pagination, infinite scroll                         |
| [AI Service](docs/architecture/backend/ai-service.md)                          | LiteLLM proxy, agenda generation                                 |
| [NATS Integration](docs/architecture/backend/nats-integration.md)              | Inter-service messaging                                          |
| [Snowflake Integration](docs/architecture/backend/snowflake-integration.md)    | Analytics queries, connection pooling                            |
| [Public Meetings](docs/architecture/backend/public-meetings.md)                | Unauthenticated access, M2M tokens                               |
| [Shared Package](docs/architecture/shared/package-architecture.md)             | Types, interfaces, utilities, validators                         |
| [E2E Testing](docs/architecture/testing/e2e-testing.md)                        | Dual architecture testing                                        |
| [Testing Best Practices](docs/architecture/testing/testing-best-practices.md)  | Testing patterns and guide                                       |
