---
type: Service
title: Auth Service
description: Handles Auth0 user authentication and identity lookups via express-openid-connect middleware with dual authentication pattern.
resource: apps/lfx-one/src/server/services/auth0.service.ts
tags: [backend, express]
---

## Overview

The Auth Service integrates Auth0 for user authentication via `express-openid-connect` middleware. It implements a dual authentication pattern: user authentication with Auth0/Authelia for protected routes and machine-to-machine (M2M) token authentication for server-side API calls. The service provides selective route protection allowing public routes (like `/meetings/` and `/public/api`) to bypass authentication while maintaining protection for sensitive areas.

The service also fetches Auth0 user identity data through the NATS auth-service, which has internal M2M access to Auth0, allowing the application to resolve linked identities without direct Auth0 API calls.

## Key Responsibilities

- Manage Auth0 authentication configuration and session handling
- Implement selective route-based authentication decisions
- Fetch linked Auth0 identities for users via NATS auth-service
- Generate and manage M2M tokens for server-side API calls
- Inject authentication context into Angular SSR for server-side rendering

## Dependencies

- Auth0 service (via express-openid-connect library)
- NATS messaging for auth-service identity lookups
- Email verification service for identity validation
- Express request/response objects for session management

## Related Concepts

- [NATS Integration](./nats-service.md) — routes identity lookups through NATS
- [API Routes](../../architecture/backend/authentication.md) — selective route protection patterns
- [Impersonation](../../architecture/backend/impersonation.md) — admin impersonation capability

## Citations

- Architecture: `docs/architecture/backend/authentication.md`
- Source: `apps/lfx-one/src/server/services/auth0.service.ts`
