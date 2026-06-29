---
type: APIGroup
title: Public API
description: Unauthenticated Express routes under /public/api/** with rate limiting; uses M2M tokens for upstream calls.
resource: apps/lfx-one/src/server/routes/
tags: [backend, api, public]
---

## Overview

The Public API consists of unauthenticated routes mounted under `/public/api/**` that allow anonymous access to specific LFX resources. These endpoints are designed for public-facing features such as meeting discovery, project browsing, and public event listings. While users do not require authentication to call these routes, the server internally uses machine-to-machine (M2M) authentication tokens to authenticate upstream calls to backend services.

The Public API bridges the gap between public user access and secure backend communication: external clients call `/public/api/**` without credentials, and the server translates those requests into authenticated upstream calls using M2M tokens generated via Auth0 or Authelia.

## Key Responsibilities

- Accept unauthenticated requests from external clients
- Validate request parameters and input data
- Generate M2M tokens for authenticated upstream API calls
- Enforce meeting visibility rules and optional passcode protection
- Return appropriate HTTP status codes (401 Unauthorized for invalid passcodes, 403 Forbidden for restricted access)
- Apply stricter rate limiting (100 requests/IP/minute via `publicApiRateLimiter`)
- Log operations with request-scoped correlation

## Route Coverage

The following route files implement public API endpoints:

| Route File | Endpoint(s) | Purpose |
| --- | --- | --- |
| `public-meetings.route.ts` | `/public/api/meetings/:id` | Public meeting discovery and detail retrieval |
| `public-committees.route.ts` | `/public/api/committees/**` | Public committee browsing |
| `public-projects.route.ts` | `/public/api/projects/**` | Public project discovery |

## M2M Token Strategy

Public endpoints cannot use user bearer tokens (no authenticated user exists). Instead, they generate application-level M2M tokens:

1. **Token Generation** — Server generates M2M token using configured credentials
2. **Provider Support** — Works with both Auth0 and Authelia (`M2M_AUTH_ISSUER_BASE_URL`, `M2M_AUTH_AUDIENCE`)
3. **Token Injection** — Bearer token automatically added to all upstream API calls
4. **Transparent to Client** — End users do not see or manage M2M credentials
5. **Scope Limiting** — M2M token permissions restricted to public data only

**Implementation**: `apps/lfx-one/src/server/utils/m2m-token.util.ts`

**Environment Variables**:
- `M2M_AUTH_CLIENT_ID` — OAuth2 client ID for M2M authentication
- `M2M_AUTH_CLIENT_SECRET` — OAuth2 client secret for M2M authentication
- `M2M_AUTH_ISSUER_BASE_URL` — Auth provider token endpoint (e.g. `https://auth.k8s.orb.local/`)
- `M2M_AUTH_AUDIENCE` — API audience for M2M token scope (e.g. `http://lfx-api.k8s.orb.local/`)

## Access Control Patterns

### Public Meetings

Public meeting endpoints respect meeting visibility levels:

- **PUBLIC** — Fully accessible without authentication or passcode
- **PRIVATE** — Requires passcode validation; returns limited project information only
- **RESTRICTED** — Not exposed through public endpoints

Passcode validation occurs server-side only; passcodes are never exposed to clients.

**Reference**: `docs/architecture/backend/public-meetings.md`

## Rate Limiting

Public API routes sit behind the stricter `publicApiRateLimiter`:

- **Limit**: 100 requests per IP per minute
- **Response on Limit**: HTTP 429 with `RateLimit-*` standard headers
- **Window**: 1 minute (sliding)
- **Rationale**: Public endpoints receive higher abuse risk; stricter limit protects against DoS

**Why stricter?** Public endpoints lack user identity context and are more susceptible to automated abuse. The tighter budget protects server resources and downstream services.

See [Rate Limiting Architecture](../../architecture/backend/rate-limiting.md) for detailed rate-limiting design.

## Dependencies / Consumers

- **Express.js** — HTTP server and routing framework
- **M2M Token Utility** — Automatic token generation and injection
- **Rate Limiting Middleware** — Per-IP request budget enforcement
- **Error Handler Middleware** — Centralized error logging and response formatting
- **@lfx-one/shared** — Shared interfaces, types, and constants
- **Auth0 / Authelia** — M2M token generation provider

## Related Concepts

- [Authenticated API](./authenticated-api.md) — Protected counterpart for user-authenticated endpoints
- [SSR Server](./ssr-server.md) — Express entry point and middleware orchestration
- [Authentication](../../architecture/backend/authentication.md) — Auth0 and M2M token strategies
- [Public Meetings Architecture](../../architecture/backend/public-meetings.md) — Meeting visibility and passcode handling
- [Rate Limiting](../../architecture/backend/rate-limiting.md) — Request budget management

## Citations

- Source: `apps/lfx-one/src/server/routes/public-*.route.ts`
- Public Meetings: `docs/architecture/backend/public-meetings.md`
- Authentication: `docs/architecture/backend/authentication.md`
- Rate Limiting: `docs/architecture/backend/rate-limiting.md`
- M2M Token Utility: `apps/lfx-one/src/server/utils/m2m-token.util.ts`
