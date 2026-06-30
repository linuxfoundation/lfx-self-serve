---
type: APIGroup
title: Authenticated API
description: Protected Express routes under /api/** requiring a valid Auth0 bearer token.
resource: apps/lfx-one/src/server/routes/
tags: [backend, api, auth]
---

## Overview

The Authenticated API consists of all protected routes mounted under `/api/**` that require user authentication via Auth0 bearer tokens. These routes serve the core functionality of the LFX platform — user profiles, meeting management, surveys, committees, projects, and more. Each request must include a valid `Authorization: Bearer <token>` header to proceed.

Authentication is enforced by the unified auth middleware (`apps/lfx-one/src/server/middleware/auth.middleware.ts`), which examines incoming requests against a `DEFAULT_ROUTE_CONFIG` array to determine whether a route requires authentication. All routes under `/api/` are protected by default unless explicitly listed as public.

## Key Responsibilities

- Validate bearer token on every request
- Enforce user authorization and access control
- Execute business logic with authenticated user context
- Return appropriate HTTP status codes (401 Unauthorized, 403 Forbidden)
- Log operations with request-scoped correlation
- Apply rate limiting (500 requests/IP/minute via `apiRateLimiter`)

## Route Coverage

The following route files implement protected API endpoints under `/api/`:

| Route File               | Endpoint(s)             | Purpose                                       |
| ------------------------ | ----------------------- | --------------------------------------------- |
| `analytics.route.ts`     | `/api/analytics/**`     | User analytics and platform metrics           |
| `badges.route.ts`        | `/api/badges/**`        | Credential badge management                   |
| `campaigns.route.ts`     | `/api/campaigns/**`     | Campaign data and management                  |
| `committees.route.ts`    | `/api/committees/**`    | Committee creation and updates                |
| `documents.route.ts`     | `/api/documents/**`     | Project document access                       |
| `events.route.ts`        | `/api/events/**`        | Event browsing and registration               |
| `impersonation.route.ts` | `/api/impersonation/**` | Admin impersonation (Executive Director only) |
| `invite.route.ts`        | `/api/invite/**`        | Invite token validation and acceptance        |
| `mailing-lists.route.ts` | `/api/mailing-lists/**` | Mailing list subscription management          |
| `meetings.route.ts`      | `/api/meetings/**`      | Meeting CRUD and detail retrieval             |
| `meetups.route.ts`       | `/api/meetups/**`       | Meetup browsing and registration              |
| `navigation.route.ts`    | `/api/navigation/**`    | Application navigation structure              |
| `newsletters.route.ts`   | `/api/newsletters/**`   | Newsletter listing and management             |
| `organizations.route.ts` | `/api/organizations/**` | Organization data and hierarchy               |
| `orgs.route.ts`          | `/api/orgs/**`          | Alternative org endpoints                     |
| `past-meetings.route.ts` | `/api/past-meetings/**` | Historical meeting access                     |
| `persona.route.ts`       | `/api/persona/**`       | User persona detection and enrichment         |
| `profile.route.ts`       | `/api/profile/**`       | User profile and account settings             |
| `projects.route.ts`      | `/api/projects/**`      | Project listing and details                   |
| `rewards.route.ts`       | `/api/rewards/**`       | Reward program data                           |
| `search.route.ts`        | `/api/search/**`        | Full-text search across resources             |
| `surveys.route.ts`       | `/api/surveys/**`       | Survey CRUD and response collection           |
| `training.route.ts`      | `/api/training/**`      | Training enrollment and status                |
| `enrollment.route.ts`    | `/api/enrollment/**`    | Learning path enrollment management           |
| `transaction.route.ts`   | `/api/transaction/**`   | Billing and purchase history                  |
| `user.route.ts`          | `/api/user/**`          | Current user details and preferences          |
| `votes.route.ts`         | `/api/votes/**`         | Poll and vote creation/management             |
| `crowdfunding.route.ts`  | `/api/crowdfunding/**`  | Crowdfunding campaign access                  |
| `copilot.route.ts`       | `/api/copilot/**`       | AI copilot features                           |
| `akrites.route.ts`       | `/api/akrites/**`       | Akrites-specific data endpoints               |
| `mktg-agents.route.ts`   | `/api/mktg-agents/**`   | Marketing agent and guild proxy               |

## Authentication Flow

1. **Request** — Client sends HTTP request to `/api/...` with `Authorization: Bearer <token>` header
2. **Auth Middleware Check** — Middleware examines route against `DEFAULT_ROUTE_CONFIG`
3. **Token Validation** — Bearer token extracted and validated against Auth0
4. **User Context Injection** — Authenticated user state attached to request (`req.oidc.user`)
5. **Business Logic** — Route handler executes with authenticated context
6. **Response** — Returns resource data or appropriate error status

## Rate Limiting

All authenticated API routes sit behind the `apiRateLimiter`:

- **Limit**: 500 requests per IP per minute
- **Response on Limit**: HTTP 429 with `RateLimit-*` standard headers
- **Window**: 1 minute (sliding)
- **Affected**: All `/api/**` routes

See [Rate Limiting Architecture](../../architecture/backend/rate-limiting.md) for detailed rate-limiting design.

## Dependencies / Consumers

- **Express.js** — HTTP server and routing framework
- **express-openid-connect** — Auth0 middleware for session and bearer token validation
- **Authentication Architecture** — Selective route protection pattern
- **Rate Limiting Middleware** — Per-IP request budget enforcement
- **Error Handler Middleware** — Centralized error logging and response formatting
- **@lfx-one/shared** — Shared interfaces, types, and constants

## Related Concepts

- [Public API](./public-api.md) — Unauthenticated counterpart for public-facing endpoints
- [SSR Server](./ssr-server.md) — Express entry point and middleware orchestration
- [Authentication](../../architecture/backend/authentication.md) — Auth0 configuration and token validation
- [Rate Limiting](../../architecture/backend/rate-limiting.md) — Request budget management

## Citations

- Source: `apps/lfx-one/src/server/routes/`
- Authentication: `docs/architecture/backend/authentication.md`
- Rate Limiting: `docs/architecture/backend/rate-limiting.md`
- Auth Middleware: `apps/lfx-one/src/server/middleware/auth.middleware.ts`
