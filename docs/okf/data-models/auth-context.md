---
type: DataModel
title: AuthContext
description: The resolved identity object attached to authenticated requests, used to distinguish user bearer tokens from M2M tokens.
resource: packages/shared/src/interfaces/
tags: [auth, typescript, interfaces]
---

## Overview

`AuthContext` is the primary data structure that encapsulates authentication and user identity state for requests in the LFX platform. It is created server-side for every HTTP request, injected into Angular's server-side rendering context, and made available to frontend components and backend services. The AuthContext distinguishes between user-authenticated requests (where a real person is interacting with the application) and machine-to-machine requests (where the application itself authenticates to upstream services on behalf of users).

**Source**: `packages/shared/src/interfaces/auth.interface.ts`

## Shape

```typescript
export interface AuthContext {
  authenticated: boolean;
  user: User | null;

  // Persona + project enrichment (populated server-side via persona-detection,
  // hydrated to browser through Angular TransferState)
  persona?: PersonaType | null;
  personas?: PersonaType[];
  organizations?: Account[];
  projects?: EnrichedPersonaProject[];
  personaProjects?: Partial<Record<PersonaType, PersonaProject[]>>;

  // Impersonation capability + active state
  canImpersonate?: boolean;
  impersonating?: boolean;
  impersonator?: Impersonator;
}

export interface User {
  sid: string;
  'https://sso.linuxfoundation.org/claims/username': string;
  given_name: string;
  family_name: string;
  nickname: string;
  name: string;
  picture: string;
  updated_at: string;
  email: string;
  email_verified: boolean;
  sub: string;
}

export interface M2MTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}
```

## Key Fields

| Field             | Type                                             | Purpose                                                                                |
| ----------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `authenticated`   | `boolean`                                        | Whether the request has a valid authenticated user session                             |
| `user`            | `User \| null`                                   | User details from Auth0/Authelia (name, email, subject claim); null if unauthenticated |
| `persona`         | `PersonaType \| null`                            | Current persona (Contributor, Maintainer, ED, Board Member)                            |
| `personas`        | `PersonaType[]`                                  | All available personas for the user across projects                                    |
| `organizations`   | `Account[]`                                      | Organizations the user is affiliated with                                              |
| `projects`        | `EnrichedPersonaProject[]`                       | Projects where user has a role, enriched with metadata                                 |
| `personaProjects` | `Partial<Record<PersonaType, PersonaProject[]>>` | Projects grouped by persona                                                            |
| `canImpersonate`  | `boolean`                                        | Whether user has executive director permission to impersonate                          |
| `impersonating`   | `boolean`                                        | Whether an active impersonation session is in place                                    |
| `impersonator`    | `Impersonator`                                   | Details of the ED impersonating the current session                                    |

## User Token vs M2M Token

### User Bearer Tokens

**When to Use**: Any authenticated endpoint (`/api/**`) where a real user is making the request.

- Represents a person logging in via Auth0/Authelia
- Created during login flow; attached to session cookie
- Contains user identity claims (email, name, subject)
- Scoped to user's permissions and data access
- Refresh token lifecycle managed by session middleware
- Used in browser requests; also available for programmatic API clients

**In Code**:

```typescript
// Request has user session (browser login)
if (req.oidc?.isAuthenticated()) {
  auth.authenticated = true;
  auth.user = req.oidc?.user as User;
}
```

### M2M (Machine-to-Machine) Tokens

**When to Use**:

- Unauthenticated public endpoints (`/public/api/**`) making upstream API calls
- Explicit privileged upstream calls from an authenticated route (rare)

- Represents the application itself, not a user
- Issued by Auth0/Authelia M2M flow
- Contains application credentials (client ID, client secret)
- Scoped to application-level permissions only
- No user identity or audit trail
- Used for server-to-server communication; never exposed to frontend

**When NOT to Use**:

- ❌ Replacing user identity for normal authenticated flows
- ❌ Building new protected endpoints (`/api/**`) — use user tokens instead
- ❌ Skipping authorization checks because "the app has M2M access"
- ❌ Attributing user actions without user identity (breaks audit trail)

**In Code**:

```typescript
// Public endpoint — no user exists
// Generate M2M token for upstream call
const m2mToken = await m2mTokenUtil.getToken();

// Make upstream request with M2M credentials
const response = await apiClient.get('/meetings/:id', {
  headers: { Authorization: `Bearer ${m2mToken}` },
});
```

**M2M Configuration**:

```bash
M2M_AUTH_CLIENT_ID='...'
M2M_AUTH_CLIENT_SECRET='...'
M2M_AUTH_ISSUER_BASE_URL='https://auth.k8s.orb.local/'
M2M_AUTH_AUDIENCE='http://lfx-api.k8s.orb.local/'
```

## Persona System

The persona system tracks a user's role(s) across different projects and contexts:

- **Contributor** — Community participant in a project
- **Maintainer** — Project maintainer with elevated permissions
- **ED (Executive Director)** — Organization/project executive director
- **Board Member** — Board-level governance role

Each persona may carry different data access levels and feature availability. The `PersonaType` enum and persona detection logic live in `@lfx-one/shared/enums` and are enriched server-side via `persona-detection.service.ts`.

## Authentication Flow

1. **Login** — User navigates to `/login`; Auth0/Authelia redirects to login page
2. **Session Created** — After authentication, secure session cookie set
3. **Auth Middleware** — Express middleware creates `AuthContext` from session
4. **SSR Injection** — Server injects `AuthContext` into Angular Universal rendering
5. **Frontend State** — Angular components access user state via `UserService` (signal-based)
6. **Frontend Hydration** — TransferState hydrates server-computed `AuthContext` to browser
7. **Persona Enrichment** — Persona detection service queries backend to resolve user roles/projects
8. **Protected Routes** — Guards check `authenticated` and persona before rendering

## Server-Side Creation

The SSR server creates `AuthContext` for every request:

```typescript
// apps/lfx-one/src/server/server.ts
app.use('/**', (req: Request, res: Response, next: NextFunction) => {
  const auth: AuthContext = {
    authenticated: false,
    user: null,
  };

  if (req.oidc?.isAuthenticated()) {
    auth.authenticated = true;
    auth.user = req.oidc?.user as User;
  }

  angularApp
    .handle(req, {
      auth,
      providers: [
        { provide: APP_BASE_HREF, useValue: process.env['PCC_BASE_URL'] },
        { provide: REQUEST, useValue: req },
        { provide: 'RESPONSE', useValue: res },
      ],
    })
    .then((response) => {
      if (response) {
        return writeResponseToNodeResponse(response, res);
      }
      return next();
    })
    .catch((error) => {
      // Error handling
    });
});
```

## Frontend State Management

The frontend uses Angular signals for lightweight, reactive state:

```typescript
// apps/lfx-one/src/app/shared/services/user.service.ts
@Injectable({ providedIn: 'root' })
export class UserService {
  public authenticated: WritableSignal<boolean> = signal(false);
  public user: WritableSignal<User | null> = signal(null);
}
```

## Impersonation

The impersonation system allows Executive Directors to act on behalf of other users for support/testing:

- `canImpersonate` — Whether user has ED privileges
- `impersonating` — Whether currently in an impersonation session
- `impersonator` — Details of the ED performing impersonation

**Reference**: `docs/architecture/backend/impersonation.md`

## Dependencies / Consumers

- **Express Server** — Creates `AuthContext` in middleware for every request
- **Angular SSR** — Receives `AuthContext` as provider for server-side rendering
- **Frontend Components** — Consume via `UserService` or injected `AUTH_CONTEXT`
- **Route Guards** — Check `authenticated` and persona to enforce access control
- **API Controllers** — Receive `AuthContext` from request for authorization checks
- **Logging Service** — Uses `AuthContext` for request correlation and audit trails

## Related Concepts

- [Shared Package](./shared-package.md) — Contains `AuthContext` interface definition
- [Authentication](../../architecture/backend/authentication.md) — Auth0/Authelia configuration and token strategies
- [Impersonation](../../architecture/backend/impersonation.md) — ED impersonation system
- [Development Rules - M2M vs User Tokens](../../../.claude/rules/development-rules.md#authentication-user-tokens-vs-m2m-tokens) — Guidance on token usage

## Citations

- Source: `packages/shared/src/interfaces/auth.interface.ts`
- Server Implementation: `apps/lfx-one/src/server/server.ts`
- Service: `apps/lfx-one/src/app/shared/services/user.service.ts`
- M2M Token Utility: `apps/lfx-one/src/server/utils/m2m-token.util.ts`
- Persona Detection: `apps/lfx-one/src/server/services/persona-detection.service.ts`
- Architecture: `docs/architecture/backend/authentication.md`
