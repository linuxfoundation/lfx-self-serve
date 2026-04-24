# Architecture Overview

High-level map of LFX One's architecture. For any given topic, follow the link below to the canonical deep-dive — duplicating content here just makes it drift, so this page stays intentionally thin.

## Stack at a Glance

**Frontend (`apps/lfx-one`):**

- **Angular 20** with stable zoneless change detection (`provideZonelessChangeDetection()`) and Angular Signals as the primary state primitive.
- **PrimeNG 20** component library, wrapped by thin `lfx-*` components under `apps/lfx-one/src/app/shared/components/` for UI-library independence.
- **Tailwind CSS v3** with the `tailwindcss-primeui` plugin; CSS layers (`@layer tailwind-base, primeng, tailwind-utilities`) keep the PrimeNG / Tailwind cascade predictable.
- **LFX UI Core** design-system integration (colors, fonts, tokens) via the `@lfx-one/shared` package.
- **Font Awesome Pro** via kits; **Google Fonts** — Inter (primary) and Roboto Slab (display).

**Backend (`apps/lfx-one/src/server`):**

- **Express.js** with Angular 20 built-in SSR.
- **Auth0 / Authelia** via `express-openid-connect` with selective route protection (public / optional / required); unified `auth.middleware.ts`.
- **Pino** structured JSON logging routed through the singleton `logger.service.ts` (never call `serverLogger` directly).
- **OpenTelemetry** tracing bootstrapped by `otel.mjs` (exporter activates when `OTEL_EXPORTER_OTLP_ENDPOINT` is set).
- **PM2** process management for production (`apps/lfx-one/ecosystem.config.js`).
- **NATS**, **Snowflake**, **LiteLLM → Claude Sonnet 4**, **Supabase** for inter-service messaging, analytics, AI features, and profile email management.

**Shared (`packages/shared`):**

- `@lfx-one/shared` exposes interfaces, constants, enums, utilities, and Angular form validators consumed by both the Angular app and the Express server. Path alias resolves directly to source during development.

## Canonical Architecture Docs

Each subtopic owns one file under `docs/architecture/`. Start there for patterns, examples, and "how to add X" guidance.

### Frontend

| Topic                                                                                  | What's covered                                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Angular Patterns](architecture/frontend/angular-patterns.md)                          | Zoneless change detection, signals, control-flow syntax, inputs/outputs |
| [Component Architecture](architecture/frontend/component-architecture.md)              | PrimeNG wrapper pattern, layout components, module organization         |
| [Lens & Persona System](architecture/frontend/lens-system.md)                          | `LensService`, persona detection, `ProjectContextService`, lens gating  |
| [State Management](architecture/frontend/state-management.md)                          | Signal-first state, signal↔RxJS bridging, service patterns              |
| [Styling System](architecture/frontend/styling-system.md)                              | Tailwind + PrimeUI, CSS layers, font + color tokens                     |
| [Drawer Pattern](architecture/frontend/drawer-pattern.md)                              | Drawer components, lazy data, chart integration                         |
| [Lazy Loading & Preloading](architecture/frontend/lazy-loading-preloading-strategy.md) | Route splitting + custom preloading strategy                            |
| [Feature Flags](architecture/frontend/feature-flags.md)                                | OpenFeature + LaunchDarkly wiring, signal-reactive flag reads           |
| [Performance](architecture/frontend/performance.md)                                    | Bundle management, SSR, runtime patterns                                |

### Backend

| Topic                                                                  | What's covered                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Backend Architecture](architecture/backend/README.md)                 | Controller-Service pattern, directory layout, core services       |
| [SSR Server](architecture/backend/ssr-server.md)                       | Express + Angular SSR pipeline, middleware order                  |
| [Authentication](architecture/backend/authentication.md)               | Auth0 setup, selective auth middleware, AuthContext, M2M tokens   |
| [Impersonation](architecture/backend/impersonation.md)                 | Auth0 CTE flow, effective-identity helpers                        |
| [Rate Limiting](architecture/backend/rate-limiting.md)                 | `express-rate-limit` budgets for `/api`, `/public/api`, `/login`  |
| [Observability](architecture/backend/observability.md)                 | OpenTelemetry auto-instrumentation, `server-tracer`, custom spans |
| [Logging & Monitoring](architecture/backend/logging-monitoring.md)     | Logger service, operation lifecycle, log levels (ADR 0002)        |
| [Error Handling](architecture/backend/error-handling-architecture.md)  | Error class hierarchy, error-handler middleware                   |
| [Server Helpers](architecture/backend/server-helpers.md)               | Validation type guards, pagination, URL validation                |
| [Pagination](architecture/backend/pagination.md)                       | `page_token` cursor pattern, `fetchAllQueryResources` helper      |
| [AI Service](architecture/backend/ai-service.md)                       | LiteLLM proxy, meeting agenda generation                          |
| [NATS Integration](architecture/backend/nats-integration.md)           | Request/reply pattern, lazy connections                           |
| [Snowflake Integration](architecture/backend/snowflake-integration.md) | Singleton pool, query deduplication, read-only validation         |
| [Public Meetings](architecture/backend/public-meetings.md)             | Unauthenticated meeting access, M2M tokens                        |

### Shared & Testing

| Topic                                                                    | What's covered                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [Shared Package](architecture/shared/package-architecture.md)            | `@lfx-one/shared` structure, import patterns, conventions            |
| [Development Workflow](architecture/shared/development-workflow.md)      | Turborepo, Yarn workspaces, build caching                            |
| [E2E Testing](architecture/testing/e2e-testing.md)                       | Dual-architecture spec files, `data-testid` naming, Playwright setup |
| [Testing Best Practices](architecture/testing/testing-best-practices.md) | Content vs. structural tests, robust locator patterns                |

## Directory Structure

```text
lfx-v2-ui/
├── apps/
│   └── lfx-one/          # Angular 20 SSR application
│       ├── src/app/      # Feature modules, layouts, shared components/services
│       └── src/server/   # Express SSR server (controllers, services, routes, middleware)
├── packages/
│   └── shared/           # @lfx-one/shared — types, constants, utils, validators
└── docs/                 # You are here
```

For runtime commands (`yarn start`, `yarn build`, `yarn e2e`, etc.), see [docs/index.md](./index.md) or the Commands section in [README.md](../README.md).
