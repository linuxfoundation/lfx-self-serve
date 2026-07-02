# User Impersonation

## Overview

User impersonation allows authorized LF staff to view the application as another user. This is a debugging and support tool — the impersonator sees the target user's dashboard, meetings, committees, and other data as if they were logged in as that user.

Impersonation uses Auth0's Custom Token Exchange (CTE) feature (RFC 8693) to obtain an access token with the target user's identity while keeping the impersonator's OIDC session intact.

**JIRA:** [LFXV2-1463](https://linuxfoundation.atlassian.net/browse/LFXV2-1463)

## Architecture

### Auth0 Infrastructure

The Auth0 side is managed in the `auth0-terraform` repo:

- **CTE Action** (`lfx_impersonation_token_exchange.js`) — validates the requestor, looks up the target user via Management API, and calls `api.authentication.setUserById()` to issue a new token
- **`can_impersonate` claim** — added to LFX v2 access tokens via `src/actions/custom_claims.js` for authorized impersonators (see Authorization below)
- **Token Exchange Profile** — maps the LFX v2 API `subject_token_type` to the impersonation CTE action
- **Auth Service Client** — the "LFX V2 Auth Service" client has `token_exchange` enabled with `allow_any_profile_of_type: ["custom_authentication"]`

### Authorization

The `can_impersonate` claim is granted in `src/actions/custom_claims.js` (`auth0-terraform`), and the authorization rule differs by tenant:

- **Production** — the user's per-client group list in `app_metadata` (`groups-<client_id>`) must include `lfx-self-serve-allowed-impersonators`.
- **Dev tenant** (`linuxfoundation-dev`) — any verified `@linuxfoundation.org` or `@contractor.linuxfoundation.org` email qualifies, since Auth0 groups are non-trivial to set up there.

### Token Exchange Flow

```text
┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌───────────┐     ┌─────────┐
│ Frontend  │     │ Express (us) │     │ Auth Service │     │   Auth0   │     │ Upstream│
│ (Angular) │     │              │     │   (NATS)     │     │   CTE     │     │  µsvc   │
└────┬─────┘     └──────┬───────┘     └──────┬───────┘     └─────┬─────┘     └────┬────┘
     │                  │                    │                   │                 │
     │ POST /api/impersonate                 │                   │                 │
     │  { targetUser: "jdoe" }               │                   │                 │
     │─────────────────>│                    │                   │                 │
     │                  │                    │                   │                 │
     │           Server checks:              │                   │                 │
     │            - can_impersonate claim     │                   │                 │
     │            - service configured       │                   │                 │
     │                  │                    │                   │                 │
     │                  │ NATS request       │                   │                 │
     │                  │  subject_token=    │                   │                 │
     │                  │   <user's JWT>     │                   │                 │
     │                  │  target_user=jdoe  │                   │                 │
     │                  │───────────────────>│                   │                 │
     │                  │                    │                   │                 │
     │                  │                    │ POST /oauth/token  │                 │
     │                  │                    │  grant_type=       │                 │
     │                  │                    │   token-exchange   │                 │
     │                  │                    │──────────────────>│                 │
     │                  │                    │                   │                 │
     │                  │                    │  { access_token }  │                 │
     │                  │                    │<──────────────────│                 │
     │                  │                    │                   │                 │
     │                  │  { access_token }   │                   │                 │
     │                  │<───────────────────│                   │                 │
     │                  │                   │                 │
     │           Store in appSession:       │                 │
     │            impersonationToken        │                 │
     │            impersonationUser         │                 │
     │            impersonator              │                 │
     │                  │                   │                 │
     │  200 OK          │                   │                 │
     │<─────────────────│                   │                 │
     │                  │                   │                 │
     │  Page reload     │                   │                 │
     │─────────────────>│                   │                 │
     │                  │                   │                 │
     │           Auth middleware:           │                 │
     │            req.bearerToken =         │                 │
     │             impersonation token      │                 │
     │                  │                   │                 │
     │                  │ Bearer <target>   │                 │
     │                  │──────────────────────────────────>│
     │                  │                   │              │
     │                  │          target user's data      │
     │                  │<─────────────────────────────────│
     │  Response        │                   │                 │
     │<─────────────────│                   │                 │
```

### Token Exchange via NATS

The CTE is performed by the **lfx-v2-auth-service** via NATS request-reply on subject `lfx.auth-service.impersonation.token_exchange`. The auth service handles all Auth0 client authentication (private key JWT, RFC 7523) internally — the UI server only sends the subject token and target user.

```typescript
// NATS request payload
{ subject_token: "<user's LFX v2 JWT>", target_user: "jdoe@example.com" }

// NATS response (success)
{ success: true, data: { access_token: "<target user's JWT>" } }

// NATS response (failure)
{ success: false, error: "target_user_not_found: Target user 'jdoe' not found" }
```

Profile enrichment (fetching the target user's name and picture) also uses NATS via the `lfx.auth-service.user_metadata.read` subject — no direct Auth0 Management API calls are made from the UI server.

## Implementation Layers

### 1. Shared Interfaces

**`packages/shared/src/interfaces/impersonation.interface.ts`**

- `ImpersonationUser` — target user identity (`sub`, `email`, `username`, `name?`, `picture?`)
- `Impersonator` — real user identity (`sub`, `email`, `name`)
- `ImpersonationStartRequest`, `ImpersonationStartResponse`, `ImpersonationStatusResponse`

**`packages/shared/src/interfaces/auth.interface.ts`** — `AuthContext` has additional fields:

- `canImpersonate?: boolean` — whether the user has the `can_impersonate` claim
- `impersonating?: boolean` — whether an impersonation session is active
- `impersonator?: Impersonator` — the real user's identity during impersonation

### 2. Backend Service

**`apps/lfx-one/src/server/services/impersonation.service.ts`**

| Method                                                    | Purpose                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `exchangeToken(req, targetUser)`                          | Performs CTE via NATS to `lfx-v2-auth-service`                   |
| `fetchTargetUserProfile(req, userId)`                     | Fetches target user's name/picture via NATS `user_metadata.read` |
| `startImpersonation(req, tokenResponse, claims, profile)` | Stores impersonation state in `appSession`                       |
| `stopImpersonation(req)`                                  | Clears impersonation state from `appSession`                     |
| `getImpersonationToken(req)`                              | Returns active impersonation token or null (clears if expired)   |
| `getImpersonationStatus(req)`                             | Returns current impersonation status                             |

### 3. API Endpoints

**`apps/lfx-one/src/server/routes/impersonation.route.ts`** — mounted at `/api/impersonate`

| Endpoint                  | Method | Purpose                                                           |
| ------------------------- | ------ | ----------------------------------------------------------------- |
| `/api/impersonate`        | POST   | Start impersonation (body: `{ targetUser: "email-or-username" }`) |
| `/api/impersonate/stop`   | POST   | Stop impersonation, clear session                                 |
| `/api/impersonate/status` | GET    | Check current impersonation state                                 |

### 4. Auth Middleware Override

**`apps/lfx-one/src/server/middleware/auth.middleware.ts`**

In `extractBearerToken()`, the impersonation token is checked **before** the normal OIDC token extraction:

```typescript
if (impersonationToken && !expired) {
  req.bearerToken = impersonationToken; // All upstream calls use target's identity
  return { success: true, needsLogout: false };
}
// ... normal OIDC token extraction follows
```

This is the single choke point — every controller and service uses `req.bearerToken` for upstream API calls, so all microservices automatically see the target user's identity.

### 5. Identity Helpers

**`apps/lfx-one/src/server/utils/auth-helper.ts`**

Many controllers and services read the user's email/username from `req.oidc.user` for server-side filtering (e.g., "get my meetings"). During impersonation, `req.oidc.user` is still the real user. Three helpers resolve the correct identity:

| Helper                      | Returns                                                            | Notes                                                                                                     |
| --------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `getEffectiveEmail(req)`    | Impersonated email or OIDC email (lowercased)                      | Email-keyed lookups                                                                                       |
| `getEffectiveUsername(req)` | Impersonated username or OIDC nickname/username/preferred_username | **Preferred** for identity references (LFID username, e.g. `jdoe`)                                        |
| `getEffectiveSub(req)`      | Impersonated sub or OIDC sub                                       | **`@deprecated`** — Auth0 sub (prefixed, e.g. `auth0\|jdoe`); two incidental callers (badges email lookup, mktg-agents session owner binding) |

For the full `username` vs `sub` distinction and the `sub` → `username` migration, see [`authentication.md`](./authentication.md#-identity-claims-username-vs-sub).

These check `req.appSession['impersonationUser']` first, falling back to `req.oidc.user`. All controllers/services that filter by user identity use these helpers (meetings, events, committees, votes, surveys, mailing lists, documents, analytics, badges, persona detection).

**Profile controller — partially impersonation-aware.** The profile controller resolves identity through `getUsernameFromAuth()`, which falls back to the impersonation-aware `getEffectiveUsername`. So most profile operations (get/update metadata, identities, work experiences, project affiliations, email verify/link) follow the **effective** identity and act on the **target** user during impersonation. The exception is password change and reset: they go through the separate `/api/profile/auth/start` management-token flow, which identifies the user by the management token itself (tied to the real user's re-authenticated session) and is not impersonation-aware.

### 6. SSR Handler

**`apps/lfx-one/src/server/server.ts`**

During SSR, the handler runs in this order:

1. Builds `auth.user` from the OIDC session (initially the real user)
2. Runs persona detection (`resolvePersonaForSsr`)
3. Populates `auth.canImpersonate` by decoding the `can_impersonate` claim from the access token
4. When an active impersonation session exists, overrides `auth.user` with the target user's claims (sub, email, username, name, picture) and sets `auth.impersonating = true` + `auth.impersonator`

Note that persona detection (step 2) resolves the **target** user's persona even though it runs **before** the `auth.user` override (step 4). It does so not because of ordering but because `resolvePersonaForSsr` reads identity through the `getEffective*` helpers, which consult `req.appSession['impersonationUser']` directly — independent of `auth.user`.

### 7. Frontend

**Components:**

- **Impersonation banner** (`main-layout.component.html`) — fixed yellow bar at the top showing who is being impersonated and a "Stop" button
- **Impersonation trigger** (`lens-switcher.component.html`) — user-secret icon in the sidebar footer (visible only when `canImpersonate` is true), opens a dialog to enter a target email/username

**Services:**

- `ImpersonationService` — frontend HTTP client for start/stop/status endpoints
- `UserService` — signals: `canImpersonate`, `impersonating`, `impersonator`

**Hydration:** `AppComponent` reads impersonation state from `AuthContext` via `TransferState` and populates `UserService` signals.

## Session Storage

All impersonation state is stored in the `express-openid-connect` session cookie (encrypted, chunked):

```text
┌─────────────────────────────────────────────────────┐
│  req.appSession (encrypted cookie)                  │
│                                                     │
│  Primary OIDC Session (managed by library):         │
│    access_token, refresh_token, id_token            │
│                                                     │
│  Impersonation (manually stored):                   │
│    impersonationToken      — target user's JWT      │
│    impersonationExpiresAt  — expiry timestamp       │
│    impersonationUser       — { sub, email, ...}     │
│    impersonator            — { sub, email, name }   │
└─────────────────────────────────────────────────────┘
```

This is cookie-based (no server-side session store), so it works across replicas without sticky sessions.

## Environment Variables

No impersonation-specific environment variables are required. Both the token exchange and profile enrichment use NATS to communicate with the auth service. The only requirement is `NATS_URL`.

## Token Expiry

When the impersonation token expires, the auth middleware clears the session and falls through to the real user's token. The user is silently returned to their own identity. To re-impersonate, they must initiate a new session.

## Audit Trail

Every request made under impersonation is logged at DEBUG level with opaque identifiers:

```text
impersonation_request: Request under impersonation
  impersonator_sub: auth0|jsmith
  target_sub: auth0|jdoe
  path: /api/user/meetings
```

Impersonation start/stop events are logged at INFO level:

```text
impersonation_granted: Impersonation session started
  impersonator_sub: auth0|jsmith
  target_sub: auth0|jdoe

impersonation_stopped: Impersonation session ended
```

## Limitations

1. **Most profile operations follow the impersonated identity** — the profile controller resolves the user via `getUsernameFromAuth()` → `getEffectiveUsername` (impersonation-aware), so viewing and updating profile metadata, identities, work experiences, and project affiliations during impersonation acts on the **target** user, not the real user. Password change and reset are the exception: they use the management-token profile-auth flow tied to the real user's re-authenticated session.

2. **Write operations use the target's identity** — creating meetings, committees, or votes while impersonating will attribute them to the target user (via the bearer token). The `created_by_name` field on committees is an exception (uses the real user's name).

3. **Local dev (Authelia) not supported** — CTE is an Auth0-specific feature. Impersonation won't work with the Authelia dev auth provider.

4. **Target user must exist in LFID connection** — the Auth0 CTE action looks up users in the `Username-Password-Authentication` connection only. Social-only or enterprise SSO users cannot be impersonated.

5. **Persona cookie stale during impersonation** — if the real user has a cached persona cookie, the first page load after starting impersonation may briefly show the wrong persona until the cookie is refreshed via NATS.

6. **No impersonation of impersonators** — if user A impersonates user B, user B's `can_impersonate` claim is not evaluated. Nested impersonation is not supported.

## Future Work

- **Read-only profile during impersonation** — profile reads already follow the target user, but writes (metadata, identity linking) do too; gate profile writes so impersonators can view the target's profile without modifying the account
- **Impersonation audit dashboard** — a dedicated UI for reviewing impersonation logs
- **Session duration controls** — configurable max impersonation duration, auto-expiry notifications
- **Impersonation notifications** — optionally notify the target user when they are being impersonated
- **Allow-list management UI** — manage authorized impersonators without Terraform changes
- **Authelia dev support** — mock impersonation flow for local development
