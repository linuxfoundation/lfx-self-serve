---
type: Service
title: SSR Server
description: Express.js entry point that runs Angular Universal SSR and mounts all API route groups.
resource: apps/lfx-one/src/server/server.ts
tags: [backend, ssr, express]
---

## Overview

The SSR Server is the Express.js application entry point (`apps/lfx-one/src/server/server.ts`) that orchestrates the entire backend of the LFX platform. It integrates Angular Universal for server-side rendering, mounts all API route groups (both authenticated and public), applies cross-cutting middleware (authentication, logging, rate limiting, error handling), and provides health checks for production monitoring.

The server operates in multiple modes — development with hot reload via Angular CLI, production as a standalone Node.js process, and build integration for Angular CLI builds — automatically detecting its execution environment.

## Key Responsibilities

- **Server Initialization** — Bootstrap Express application with middleware pipeline
- **Static Asset Serving** — Fast path for pre-built Angular browser bundles with caching headers
- **Health Monitoring** — Unobstructed `/livez` and `/readyz` endpoints for load balancers
- **Structured Logging** — Pino-based JSON logging with request/response tracking and sensitive data redaction
- **Authentication** — Session management via Auth0/express-openid-connect with selective route protection
- **API Route Mounting** — Register all 30+ protected and public routes
- **Angular SSR** — Universal server-side rendering as fallback handler
- **Error Handling** — Centralized error response formatting and logging
- **Rate Limiting** — Apply per-IP request budgets to API and auth flows
- **OpenTelemetry Tracing** — Optional distributed tracing instrumentation
- **Process Lifecycle** — Graceful shutdown, connection draining, cleanup hooks

## Middleware Pipeline

The server applies middleware in strict order for optimal performance and correct functionality:

1. **Static Asset Serving** — Express `static()` for pre-built Angular bundles
   - 1-year cache headers for immutable assets
   - Fast path before other middleware

2. **Health Monitoring** — Unobstructed `/livez`, `/readyz`, `/.well-known` endpoints
   - Bypass all authentication and logging
   - Immediate response for monitoring systems

3. **Structured Logging** — Pino HTTP middleware
   - Request/response tracking
   - Performance metrics and status codes
   - Automatic sensitive header redaction (Authorization, Cookies)
   - Excludes health check endpoints to reduce noise

4. **Rate Limiting** — Per-IP request budget enforcement
   - `/public/api/*` — 100 requests/IP/minute
   - `/api/*` — 500 requests/IP/minute
   - `/login`, auth callbacks — 20 requests/IP/minute

5. **Authentication** — Auth0/Authelia session and token validation
   - Selective authentication via `DEFAULT_ROUTE_CONFIG`
   - Public routes bypass user auth (e.g., `/meetings/:id`, `/public/api`)
   - Bearer token validation for API requests
   - Custom login handler with URL validation

6. **API Routes** — Domain-specific route handlers
   - 30+ route files mounted under `/api` and `/public/api`
   - Business logic with authenticated/M2M context
   - Return JSON responses

7. **Error Handler Middleware** — Centralized error catch-all
   - Formats error responses with HTTP status codes
   - Logs errors with full context
   - Graceful degradation for unhandled exceptions

8. **Angular SSR** — AngularNodeAppEngine fallback handler
   - Renders all remaining routes via Angular Universal
   - Injects authentication context into SSR
   - Returns proper HTTP status codes (404, 401, 500)
   - SEO optimization via server-side content generation

## Configuration

The server reads environment variables for all configuration:

### User Authentication

- `PCC_AUTH0_SECRET` — Session encryption key
- `PCC_BASE_URL` — Application base URL (e.g., `http://localhost:4000`)
- `PCC_AUTH0_ISSUER_BASE_URL` — Auth0 tenant URL
- `PCC_AUTH0_CLIENT_ID` — Auth0 application ID
- `PCC_AUTH0_CLIENT_SECRET` — Auth0 application secret
- `PCC_AUTH0_AUDIENCE` — Auth0 API audience (optional)

### M2M Authentication (Public Endpoints)

- `M2M_AUTH_CLIENT_ID` — OAuth2 M2M client ID
- `M2M_AUTH_CLIENT_SECRET` — OAuth2 M2M client secret
- `M2M_AUTH_ISSUER_BASE_URL` — M2M token endpoint
- `M2M_AUTH_AUDIENCE` — M2M token audience

### OpenTelemetry Tracing (Optional)

- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP collector endpoint (unset = disabled)
- `OTEL_SERVICE_NAME` — Service name in traces (default: `lfx-self-serve`)
- `OTEL_TRACES_SAMPLER` — Sampler strategy (default: `parentbased_always_on`)
- `OTEL_TRACES_SAMPLER_ARG` — Sampling ratio 0.0–1.0 (default: `1.0`)
- `OTEL_LOG_LEVEL` — OTEL diagnostic level (default: `info`)
- `APP_VERSION` — Version reported in traces (default: `development`)

### Environment & Execution

- `NODE_ENV` — Environment (development/production)
- `PM2` — Set to `true` when running under PM2 process manager

## Request Flow Example

```
┌─────────────────────┐
│  Incoming Request   │
└──────────┬──────────┘
           ▼
    ┌──────────────────┐
    │  Static Assets?  │ ─── Yes ──→ [Return cached file]
    └──────┬───────────┘
           │ No
           ▼
    ┌──────────────────┐
    │  Health Check?   │ ─── Yes ──→ [Return 200 OK]
    └──────┬───────────┘
           │ No
           ▼
    ┌──────────────────┐
    │  Log Request     │ ──────────→ [Pino HTTP logger]
    └──────┬───────────┘
           ▼
    ┌──────────────────┐
    │  Rate Limited?   │ ─── Yes ──→ [Return 429]
    └──────┬───────────┘
           │ No
           ▼
    ┌──────────────────┐
    │ Validate Auth    │ ──────────→ [Auth0/Authelia]
    └──────┬───────────┘
           ▼
    ┌──────────────────┐
    │  API Route?      │ ─── Yes ──→ [Execute handler, return JSON]
    └──────┬───────────┘
           │ No
           ▼
    ┌──────────────────┐
    │  Error Handler   │ ──────────→ [If exception caught]
    └──────┬───────────┘
           │
           ▼
    ┌──────────────────┐
    │  Angular SSR     │ ──────────→ [Render component, return HTML]
    └──────────────────┘
```

## Environment Detection

The server automatically detects its execution mode:

```typescript
const isPM2 = process.env['PM2'] === 'true';
const isMain = isMainModule(import.meta.url);
```

- **Development**: Hot reload via Angular CLI dev server
- **Production**: Standalone Node.js process (may be wrapped by PM2)
- **Build**: Provides request handler for Angular CLI build processes

## Dependencies / Consumers

- **Express.js** — HTTP framework
- **@angular/ssr/node** — Angular Universal SSR engine
- **express-openid-connect** — Auth0 session management
- **pino, pino-http** — Structured JSON logging
- **express-rate-limit** — Request rate limiting
- **OpenTelemetry SDK** — Optional distributed tracing
- **@lfx-one/shared** — Shared types and interfaces
- **Route Handlers** — 30+ domain-specific route files
- **Middleware** — Auth, logging, error handling, rate limiting

## Related Concepts

- [Authenticated API](./authenticated-api.md) — Protected routes under `/api/**`
- [Public API](./public-api.md) — Unauthenticated routes under `/public/api/**`
- [Authentication](../../architecture/backend/authentication.md) — Auth0/Authelia integration
- [Rate Limiting](../../architecture/backend/rate-limiting.md) — Per-IP request budgets
- [SSR Architecture](../../architecture/backend/ssr-server.md) — Detailed server design

## Citations

- Source: `apps/lfx-one/src/server/server.ts`
- Architecture: `docs/architecture/backend/ssr-server.md`
- Authentication: `docs/architecture/backend/authentication.md`
- Rate Limiting: `docs/architecture/backend/rate-limiting.md`
- Logging: `docs/architecture/backend/logging-monitoring.md`
