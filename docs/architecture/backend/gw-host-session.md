# Gatewaze Host Session

Host-session mode moves the embedded Gatewaze admin off its browser sign-in. LFX One gets the user's Gatewaze (GoTrue) session server to server with GoTrue's `id_token` grant and keeps it in Valkey. The browser holds only its LFX `appSession` cookie and never sees a Gatewaze token. Tracking issue: #2738.

This page covers session acquisition, the `/api/gatewaze/session` routes and logout. The Supabase and API proxy, Realtime and the embed outlet change come in later PRs, and each one extends this page.

## Files

| File                                                                 | Role                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/server/services/gatewaze-session.service.ts`                    | Configuration gate, key derivation, the session store, `getGatewazeSession`, `getGatewazeMe`, `endGatewazeSession` |
| `src/server/routes/gatewaze.route.ts`                                | The `/api/gatewaze` router: `no-store`, the gates, the session routes                                              |
| `src/server/controllers/gatewaze-session.controller.ts`              | `/session/me` and `/session/logout`                                                                                |
| `src/server/middleware/require-gatewaze-host-session.middleware.ts`  | The uniform 404 while host-session mode is off                                                                     |
| `src/server/middleware/end-gatewaze-session-on-logout.middleware.ts` | Ends the Gatewaze session on LFX's `/logout`                                                                       |
| `src/server/helpers/gw-runtime-config.helper.ts`                     | The embed's `RuntimeConfig` fields, including `gwHostSession`                                                      |
| `src/server/utils/refresh-token-exchange.util.ts`                    | `exchangeRefreshTokenForIdToken`, the Auth0 refresh grant that yields an ID token                                  |
| `src/server/helpers/app-session-cookie.helper.ts`                    | Reads the LFX session id from the raw `Cookie` header                                                              |
| `src/server/helpers/server-feature-flag.helper.ts`                   | `ServerFeatureFlag.GatewazeHostSession`                                                                            |
| `packages/shared/src/constants/gw-host-session.constants.ts`         | Scope, HKDF label, TTL, cookie name and id shape                                                                   |

The session logic itself (GoTrue sign-in and refresh, the encrypted store, its locks and sign-out channel) comes from the published `@gatewaze/host-session` package, pinned to an exact version in `apps/lfx-one/package.json`. LFX One is a thin Express adapter over it and follows the package README's host contract.

## How a session is acquired

`getGatewazeSession(req)` returns one of five outcomes and never throws:

1. Check the configuration (see [Feature flag](#feature-flag)). If host-session mode is off, the outcome is `host_session_unavailable`.
2. Read the LFX session id from the `appSession` cookie and derive the Gatewaze session id from it (see [Session id](#session-id)).
3. Call `store.fresh(gwSid, { expectedSub })`. This returns the stored session, refreshing it under a lock first when its access token is within 60 seconds of expiry. If GoTrue refuses the refresh, the store deletes the record and returns null.
4. With no session, call `store.acquire(gwSid, mint, { expectedSub })`. The mint gets an ID token from Auth0 (`exchangeRefreshTokenForIdToken`), then calls GoTrue's `id_token` grant (`signInWithIdToken`). `acquire` runs one mint per session id across every pod; concurrent callers wait for it and get the stored result.

`expectedSub` is `req.oidc.user.sub`, the real signed-in user. A stored session for any other Auth0 subject is revoked, deleted and replaced by a new mint.

| Outcome                    | Cause                                                                                    | What the `/session/me` route answers |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| `ok`                       | A stored, refreshed or newly minted session                                              | 200, or 403/503 from the admin check |
| `host_session_unavailable` | Flag off, store off, Supabase config missing or unsafe, no store-backed `appSession` id  | Uniform 404                          |
| `ended`                    | Auth0 refused the refresh token with `invalid_grant`, or a sign-out marker               | 401 with `x-gw-session: expired`     |
| `refused`                  | GoTrue refused the ID token (a 4xx): provider audience or issuer wrong, or a banned user | 503 with an ERROR log, never 401     |
| `unavailable`              | Valkey, Auth0 or GoTrue could not answer, or Auth0 sent any other 4xx                    | 503                                  |

`refused` is kept apart from `ended` because it is a configuration fault. Answering 401 would send the embed round a reload that cannot fix it. For the same reason, only Auth0's `invalid_grant` means the LFX session is over. Any other Auth0 4xx (`invalid_client`, `unauthorized_client`, `invalid_request`, `invalid_scope`, a bare 401 or 403) is a client or tenant fault, so it is `unavailable` and logged at ERROR with the OAuth error code only.

### Why the ID token comes from a refresh grant

The ID token `express-openid-connect` received at login carries LFX's raw `nonce`, and GoTrue cannot match it. An ID token from a `refresh_token` grant with `scope=openid email profile` and no `audience` carries no nonce, which is what GoTrue requires when the request sends none. The LFX One Auth0 client uses non-rotating refresh tokens, so this extra grant does not invalidate the refresh token `express-openid-connect` holds. The token is passed straight to GoTrue. It is never cached, never written to `appSession` and never logged. Locally the Authelia branch sends the same scope.

## Routes

`app.use('/api/gatewaze', gatewazeRouter)` sits after `authMiddleware` and the API rate limiter, next to `/api/gw`. `/api/*` requires an LFX session, so a signed-out caller gets `authMiddleware`'s JSON 401 before the router runs. The routes are JSON only, so unlike `/api/gw` they need no body-parser or compression exclusion. The router runs, in order:

1. `Cache-Control: no-store` on every `/session` response, including the gates' 404 and 403.
2. `requireGatewazeHostSession`: the uniform 404 unless `resolveGatewazeHostSessionConfig` is non-null. The body is the same `NOT_FOUND` error `/api/gw` gives with its flag off.
3. `requireGwEmbedAccess`, reused as is: ED, root writer or any writer grant, and 403 `GW_EMBED_IMPERSONATION_BLOCKED` while impersonating. No Gatewaze session is ever minted for an impersonation target.
4. `GET /session/me` and `POST /session/logout`.

`requireGwEmbedAccess` lets a request with no bearer token through, because `/api/gw`'s controller answers that itself. The router therefore relies on being mounted under `/api`, where `authMiddleware` has already answered 401.

The controller sends the answers in the tables below with `res.status().json()` rather than through the error classes and `apiErrorHandler`. The embed's shim reads these exact bodies and the `x-gw-session` header, so they are contract answers, not failures. The gates' 404 and 403 still go through `apiErrorHandler`.

### `GET /api/gatewaze/session/me`

`getGatewazeMe` follows the admin BFF's `/bff/me`. It checks for a pending admin check first, then calls GoTrue `/user` with the session's access token (the package's `getUser`), then checks `is_admin`.

| Situation                                                         | Answer                                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Not signed in to LFX                                              | 401 from `authMiddleware`, no marker                                                                                                             |
| Host-session mode off or misconfigured, or no store-backed cookie | Uniform 404                                                                                                                                      |
| No LFX writer or ED access                                        | 403 `GW_EMBED_ACCESS_REQUIRED`                                                                                                                   |
| Impersonating                                                     | 403 `GW_EMBED_IMPERSONATION_BLOCKED`                                                                                                             |
| Session ok and an active admin                                    | 200 `{ user }`, the GoTrue `/user` body                                                                                                          |
| Session ok, not an admin                                          | 403 `{ error: 'not_admin', email }`                                                                                                              |
| Admin check pending                                               | 503 `{ error: 'admin_check_pending' }` with `Retry-After: retryAfterSeconds(s)`                                                                  |
| `ended`: Auth0 `invalid_grant`, or LFX logged out (see below)     | 401 `{ error: 'not_signed_in' }` with `x-gw-session: expired`                                                                                    |
| GoTrue `/user` answers 401, 403 or 404                            | The record is dropped and minted once more; a second refusal drops that record too and is 503 `{ error: 'session_unavailable' }`, logged at WARN |
| `refused`: GoTrue refused the ID token                            | 503 `{ error: 'session_unavailable' }`; the service logs it at ERROR                                                                             |
| `unavailable`: Valkey, Auth0 or GoTrue could not answer           | 503 `{ error: 'session_unavailable' }`                                                                                                           |

The marker is the only answer that tells the embed its session is gone, so it is never sent for a fault. After a `/user` refusal the service revokes the refused session at GoTrue, then calls `store.discard(gwSid, { onlyIfAccessToken })` with the refused access token. `discard` removes the record and publishes the sign-out without setting the sign-out marker. `store.delete` would set it, and the re-mint would then fail as `ended` for 5 minutes. With `onlyIfAccessToken` the record is removed only while it still holds that token, so a session another tab minted in the meantime is kept and used. If GoTrue also refuses the session just minted, that is a Gatewaze fault, not a dead LFX session, and a 401 would send the embed round a reload into the same refusal. The service drops that record as well and answers 503.

### `POST /api/gatewaze/session/logout`

The embed's sign-out button. It checks the package's CSRF rule with `isSameSite`: the `Origin`, when present, must be the origin of `PCC_BASE_URL`, and the `apikey` header must be the anon key. Anything else gets 403 `{ error: 'cross_site' }`. A missing or invalid `PCC_BASE_URL` fails closed.

Then `endGatewazeSession` runs host contract step 8:

1. `store.get(gwSid)`, then `store.fresh(gwSid)`, because GoTrue's logout authenticates with the access token. If the refresh fails, the stored session is used as it is. If GoTrue refuses the refresh outright, the package has already removed the record without the marker, and there is nothing left to revoke.
2. `logout(cfg, s)`, which is `POST /auth/v1/logout?scope=local` and revokes the refresh token.
3. `store.discard(gwSid, { onlyIfAccessToken })` with the access token just revoked. It deletes the record and publishes the sign-out so every pod closes the user's Realtime sockets. It sets no sign-out marker, and it leaves the record alone if another request has replaced it since.

Each step is bounded at `GW_HOST_SESSION_LOGOUT_STEP_TIMEOUT_MS` (2 seconds). A failed refresh or revoke does not stop the steps after it. If the store cannot be reached, or there is no stored session, nothing is removed and no sign-out is published. The route answers 204 even when GoTrue or Valkey failed; the service logs those at WARN, and an undeleted record ages out on its TTL. The LFX session is not touched.

The LFX session is still live, so the embed's next `/session/me` mints a new Gatewaze session from it. The embed's sign-out is in effect a reconnect: it revokes the old GoTrue session and closes its sockets, and the user carries on. Signing out of Gatewaze for real means logging out of LFX.

### LFX logout

`app.use('/logout', endGatewazeSessionOnLogout)` is registered before `auth(authConfig)`, next to `clearIntercomCookies`, because `express-openid-connect`'s built-in `/logout` never calls `next()`. `req.oidc` does not exist at that point, so `endGatewazeSession` finds the session from the `appSession` cookie alone and runs the same bounded steps, except that step 3 is `store.delete(gwSid)`. That also sets the package's 5 minute sign-out marker, so a request still in flight on the old LFX session cannot mint a new Gatewaze session after the logout. The marker is written even when GoTrue refused the refresh in step 1, because a record existed. Nothing is written when no record is found, so a `/logout` with a made-up cookie, which needs no LFX session and is not rate limited, costs one Valkey read. The middleware waits for `endGatewazeSession` for at most `GW_HOST_SESSION_LFX_LOGOUT_WAIT_MS` (3 seconds), and the steps carry on in the background after that. It always calls `next()`, so a Gatewaze or Valkey fault can delay the LFX logout by at most 3 seconds and never fails it. With host-session mode off it returns at once without touching Valkey.

Logouts that skip the `/logout` route, such as the forced `res.oidc.logout()` in `authMiddleware`, leave the record behind. The LFX session id it is keyed on is destroyed, so nothing can reach it, and it expires on its 24 hour TTL. GoTrue's own inactivity limit also applies.

## Where the session lives

The GoTrue session is a separate Valkey record, not a field on `req.appSession`. `express-openid-connect` reads the whole session once per request and overwrites it on every response, and GoTrue rotates refresh tokens, so two concurrent requests would undo each other's rotation. A WebSocket upgrade cannot write `appSession` at all. `AuthStateService` keeps its own record for the same reason.

Keys sit under `lfx-ui[:<VALKEY_KEY_NAMESPACE>]:gatewaze:v1:` (`buildGatewazeHostSessionKeyPrefix`). The package adds `session:`, `refresh-lock:`, `create-lock:` and `signed-out:` keys under it and publishes sign-outs on `<prefix>logout`. The store has its own ioredis connection to `VALKEY_URL`, plus a duplicate for the sign-out subscription, because a subscribed connection cannot run commands. Records have a 24 hour sliding TTL, renewed on each refresh, matching GoTrue's inactivity window.

The package's warn metadata is filtered to `err` and `status` before it reaches the LFX logger, because it also carries the GoTrue `user_id`.

The store's Lua script touches three keys at once, which works on the non-cluster Valkey every environment uses today. If that Valkey ever moves to cluster mode, the prefix needs a hash tag such as `{gatewaze}`.

## Keys

| Key          | Derivation                                                                                             | Use                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Master key   | `HKDF-SHA256(PCC_AUTH0_SECRET, salt = empty, info = 'lfx-one gatewaze host-session v1', 32 bytes)`     | Input to the store key                               |
| Store key    | `deriveKeys([master], 'store')` from the package                                                       | AES-256-GCM on every record, bound to the session id |
| Sid key      | `HKDF-SHA256(PCC_AUTH0_SECRET, salt = empty, info = 'lfx-one gatewaze host-session v1 sid', 32 bytes)` | HMAC key for the session id, never used to encrypt   |
| Gatewaze sid | `base64url(HMAC-SHA256(sid key, 'sid:' + lfxSid))`                                                     | The record's id                                      |

Deriving from `PCC_AUTH0_SECRET` means there is no new secret to provision. Rotating it invalidates every stored Gatewaze record, and each one is re-minted on its next use. It does not end LFX sessions, which live in the session store. The store refuses to read a plaintext record, so a value planted in Valkey is deleted rather than used.

## Session id

`lfxSid` is the raw `appSession` cookie value. With the session store on, that cookie is the bare session id, 32 random bytes from `genid`, unsigned. `readAppSessionId` accepts only that 64 hex character shape, so the encrypted cookie that cookie mode writes is ignored.

This meets the package's session id rules:

- It is an HMAC of a per-login random value and is never derived from user data.
- It changes at every sign-in, because `express-openid-connect` creates a new session id on each login callback.
- It is dropped at sign-out, when the LFX session is destroyed.

Deriving the id rather than storing it means nothing is written to `appSession`, and the Realtime upgrade path and `/logout` can derive the same id from the cookie alone.

## Feature flag

`LFX_GATEWAZE_HOST_SESSION` (`ServerFeatureFlag.GatewazeHostSession`) is off by default and default-deny like every server flag. `resolveGatewazeHostSessionConfig` turns host-session mode on only when all of these hold:

- `LFX_GATEWAZE_HOST_SESSION` and `LFX_GATEWAZE_EMBED_ENABLED` are on.
- `SESSION_STORE_ENABLED` is `true` and `VALKEY_URL` is set. Without the store, `appSession` has no stable id to key on.
- `GW_SUPABASE_URL` is set, and is `https://` when `NODE_ENV` is `production`, because the user's GoTrue tokens go to it.
- `GW_SUPABASE_ANON_KEY` passes `isPublishableSupabaseKey`, so a service-role key turns the mode off.
- `PCC_AUTH0_SECRET` is set.

`RuntimeConfig.gwHostSession` is the result of the same check (`buildGwRuntimeConfig`), so the embed outlet and the routes cannot disagree on one pod. A rolling update that flips the flag is harmless. A page from a flag-on pod whose calls land on a flag-off pod gets the uniform 404, which the embed reads as `unavailable` and retries, and nothing is half-written.

## Related

- [Gatewaze Embed Proxy](./gw-proxy.md), the `/api/gw` pass-through this replaces once host-session mode is the default.
- [Authentication](./authentication.md), for the session store and why `appSession` is never written outside `express-openid-connect`.
- [`@gatewaze/host-session` README](https://www.npmjs.com/package/@gatewaze/host-session), the host contract.
