---
type: Decision
title: Auth0 + Authelia Authentication
description: Selective user authentication via Auth0/express-openid-connect and M2M authentication for server-side API calls.
resource: docs/architecture/backend/authentication.md
tags: [architecture, security, backend]
---

## Context and Rationale

The application implements a dual authentication model:

1. **User Authentication** — Auth0 + Authelia via `express-openid-connect` middleware
2. **Machine-to-Machine (M2M) Authentication** — M2M tokens for server-side calls to upstream APIs

This design supports both protected and public routes while maintaining security and audit trails.

### User Authentication Rationale

**Auth0** is an identity-as-a-service platform; **Authelia** is a self-hosted authentication server used in the local development environment. Both are integrated via **express-openid-connect**, which:

- Handles OIDC (OpenID Connect) protocol for authentication
- Manages session cookies and tokens
- Provides selective route protection (some routes require auth, others don't)
- Automatically redirects unauthenticated users to the login page

**Why adopted:**

- **Standards-based** — OIDC is an open standard supported by both Auth0 and Authelia
- **Selective protection** — routes can explicitly require authentication or allow anonymous access
- **Session management** — user sessions are stored securely in cookies
- **User enrichment** — Auth0 provides user attributes (email, name, roles) for authorization
- **Flexible** — works with both cloud (Auth0) and self-hosted (Authelia) providers

### M2M Authentication Rationale

Some endpoints need to call upstream APIs without a user context. **Machine-to-Machine (M2M) tokens** represent the LFX One application itself (not a user).

**Why adopted:**

- **Public endpoints** — public meeting pages or registration endpoints have no user session but need to fetch meeting details from upstream APIs
- **Privileged operations** — some user-facing endpoints require a privileged upstream call (beyond what the user's token grants) to validate access or fetch restricted data
- **Audit trail** — the user's action in the app is still logged; the M2M call is an internal detail supporting that user's request

**Configuration:**

```bash
# Machine-to-Machine (M2M) Token Authentication
M2M_AUTH_CLIENT_ID='your-m2m-client-id'
M2M_AUTH_CLIENT_SECRET='your-m2m-client-secret'
M2M_AUTH_ISSUER_BASE_URL='https://auth.k8s.orb.local/'
M2M_AUTH_AUDIENCE='http://lfx-api.k8s.orb.local/'
```

## Architecture

### User Authentication Flow

1. **Unauthenticated user visits app** → Express middleware checks `req.oidc?.isAuthenticated()`
2. **If not authenticated and route requires auth** → Middleware redirects to Auth0/Authelia login
3. **User logs in** → Auth0/Authelia returns session token (JWT) in a secure cookie
4. **Authenticated requests** → Middleware injects user data into `req.oidc?.user`, app uses it for authorization
5. **Server-side enrichment** → Express services load persona, organizations, projects from upstream APIs
6. **Hydration to browser** → User context is injected into Angular's transfer state (SSR) and available to the client

### Selective Route Protection

**Configuration in Express:**

```typescript
// apps/lfx-one/src/server/server.ts
app.use(auth({
  authRequired: false,              // Global default: no auth required
  auth0Logout: true,                // Support logout endpoint
  secret: process.env.PCC_AUTH0_SECRET,
  baseURL: process.env.PCC_BASE_URL,
  clientID: process.env.PCC_AUTH0_CLIENT_ID,
  clientSecret: process.env.PCC_AUTH0_CLIENT_SECRET,
  issuerBaseURL: process.env.PCC_AUTH0_ISSUER_BASE_URL,
  audience: process.env.PCC_AUTH0_AUDIENCE,
}));
```

Individual routes then apply protection via middleware:

```typescript
// Public route (e.g., public meeting page)
app.get('/api/meetings/:id/public', (req, res) => {
  // No auth required; optional bearer token supported
});

// Protected route (e.g., user's meetings)
app.get('/api/meetings', requireAuth(), (req, res) => {
  // Auth required; user context available in req.oidc?.user
});
```

**`requireAuth()` middleware** ensures the route is only accessible to authenticated users.

### User Data Structure

After authentication, the server populates an `AuthContext`:

```typescript
export interface AuthContext {
  authenticated: boolean;
  user: User | null;
  // User identity
  persona?: PersonaType | null;           // Current persona (Contributor, Maintainer, ED, Board Member)
  personas?: PersonaType[];               // Available personas
  organizations?: Account[];              // Organizations the user belongs to
  projects?: EnrichedPersonaProject[];    // Projects the user has access to
  personaProjects?: Partial<Record<PersonaType, PersonaProject[]>>;
  // Impersonation (ED/Admin feature)
  canImpersonate?: boolean;
  impersonating?: boolean;
  impersonator?: Impersonator;
}
```

This context is:

1. **Built on the server** — Express calls upstream services to fetch persona, orgs, projects
2. **Hydrated via Angular TransferState** — sent to the browser during SSR
3. **Available to the client** — Angular components access user context via the auth service

## Trade-offs

### Security vs. Simplicity

**Benefit:** OIDC standard is well-understood, Auth0/Authelia are mature, selective protection is flexible.

**Trade-off:** Dual auth model (user + M2M) adds complexity. Developers must carefully decide which token to use for each API call.

**Mitigation:** The rule is simple: **Default to user bearer tokens.** Use M2M tokens only for public endpoints or explicit privileged operations. See `.claude/rules/development-rules.md` for detailed M2M usage rules.

### Session Management Overhead

**Benefit:** Secure cookie-based sessions avoid storing tokens in browser storage (which is vulnerable to XSS).

**Trade-off:** The server must validate session tokens on every request, and cookies must be available (not cross-origin by default).

**Mitigation:** The Express server is same-origin with the Angular app (both under `PCC_BASE_URL`), so cookies work. Token validation is cached in memory.

## Key Implications for Development

1. **User tokens are default** — use `req.bearerToken` from the OIDC session for user-facing endpoints
2. **Check auth status explicitly** — routes with `authRequired: false` must check `req.oidc?.isAuthenticated()` before accessing user data
3. **M2M tokens are rare** — only for public endpoints or privileged upstream calls
4. **After M2M calls, restore user context** — do not replace the user's token with an M2M token permanently
5. **Audit trails matter** — user actions must be attributable to the user, not the application

## Related Concepts

- [Monorepo Turborepo](../decisions/monorepo-turborepo.md) — Express server structure
- [Angular Zoneless SSR](../decisions/angular-zoneless-ssr.md) — client-side auth context consumption

## Citations

- **Source:** `docs/architecture/backend/authentication.md`, Auth0 Integration and Express Server Integration sections
- **Source:** `docs/architecture/backend/authentication.md`, User Data Structure subsection (lines 35–79)
- **Source:** `.claude/rules/development-rules.md`, Authentication: User Tokens vs M2M Tokens section (policy on when to use M2M)
