# Gatewaze Host Session

Host-session mode is how the embedded Gatewaze admin gets its session. LFX One gets the user's Gatewaze (GoTrue) session server to server with GoTrue's `id_token` grant and keeps it in Valkey. The browser holds only its LFX `appSession` cookie and never sees a Gatewaze token. Tracking issue: #2738.

It is the embed's only mode. With host-session mode off, `/api/gatewaze` answers the uniform 404 and the outlet shows its not-configured panel.

This page covers session acquisition, the `/api/gatewaze/session` routes, logout, the Supabase and Gatewaze API proxies, their authorization and middleware exclusions, and the Realtime WebSocket proxy. The embed outlet's side of this mode is in [Gatewaze Embed Host](../frontend/gw-embed.md#session).

## Files

| File                                                                 | Role                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/server/services/gatewaze-session.service.ts`                    | Configuration gate, key derivation, the session store, `getGatewazeSession`, `getGatewazeMe`, `endGatewazeSession` |
| `src/server/routes/gatewaze.route.ts`                                | The `/api/gatewaze` router: `no-store`, the gates, the session routes, the Realtime route                          |
| `src/server/services/gatewaze-realtime.service.ts`                   | The Realtime WebSocket proxy: the `upgrade` hook, socket caps, the bridge, shutdown                                |
| `src/server/controllers/gatewaze-session.controller.ts`              | `/session/me` and `/session/logout`                                                                                |
| `src/server/controllers/gatewaze-proxy.controller.ts`                | `proxySupabase` and `proxyApi`, the cookie-authenticated proxies                                                   |
| `src/server/helpers/gatewaze-module.helper.ts`                       | The per-module entitlement seam: `gatewazeModuleForPath` and `authorizeGatewazeModule`                             |
| `src/server/middleware/require-gatewaze-host-session.middleware.ts`  | The uniform 404 while host-session mode is off, or with no LFX bearer token                                        |
| `src/server/middleware/require-gw-embed-access.middleware.ts`        | LFX authorization: ED, root writer or any writer grant; 403 while impersonating                                    |
| `src/server/helpers/gw-api.helper.ts`                                | `GW_API_URL` resolution, the `/api/gatewaze` mount test (`isGwProxyPath`), request-body drain                      |
| `src/server/helpers/gw-proxy-limits.helper.ts`                       | `GW_PROXY_TIMEOUT_MS` and `GW_PROXY_MAX_BODY_BYTES`                                                                |
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

`app.use('/api/gatewaze', gatewazeRouter)` sits after `authMiddleware` and the API rate limiter. `/api/*` requires an LFX session, so a signed-out caller gets `authMiddleware`'s JSON 401 before the router runs. The proxies stream the raw request body, so the mount is carved out of the body parsers and compression in `server.ts` (see [Middleware exclusions](#middleware-exclusions-in-serverts)). The router runs, in order:

1. `Cache-Control: no-store` on every response, including the gates' 404 and 403. A proxied response replaces it with the upstream's own `Cache-Control` when the upstream sends one, and a response made with the session always has one, because the package marks it `private`. A proxy failure before any body byte reached the browser answers with `no-store` and none of the upstream's headers.
2. `requireGatewazeHostSession`: the uniform 404 unless `resolveGatewazeHostSessionConfig` is non-null (see [The uniform 404](#the-uniform-404)).
3. `requireGatewazeBearer`: the same uniform 404 when the request has no LFX bearer token, so the router's authorization does not rest on `authMiddleware` alone. Under `/api` it never fires today.
4. `requireGwEmbedAccess`: ED, root writer or any writer grant, and 403 `GW_EMBED_IMPERSONATION_BLOCKED` while impersonating. No Gatewaze session is ever minted for an impersonation target. See [Authorization](#authorization).
5. The proxies, `ALL /supabase/{rest,storage,functions}/v1/*` and `ALL /api/*`.
6. `GET /session/me` and `POST /session/logout`.
7. `GET /supabase/realtime/v1/websocket`, reached only by a WebSocket upgrade (see [Realtime](#realtime)). The controller hands it to the Realtime service.

The controller sends the answers in the tables below with `res.status().json()` rather than through the error classes and `apiErrorHandler`. The embed's shim reads these exact bodies and the `x-gw-session` header, so they are contract answers, not failures. The gates' 404 and 403 still go through `apiErrorHandler`.

### `GET /api/gatewaze/session/me`

`getGatewazeMe` follows the admin BFF's `/bff/me`. It checks for a pending admin check first, then calls GoTrue `/user` with the session's access token (the package's `getUser`), then checks `is_admin`.

| Situation                                                         | Answer                                                                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not signed in to LFX                                              | 401 from `authMiddleware`, no marker                                                                                                                                   |
| Host-session mode off or misconfigured, or no store-backed cookie | Uniform 404                                                                                                                                                            |
| No LFX writer or ED access                                        | 403 `GW_EMBED_ACCESS_REQUIRED`                                                                                                                                         |
| Impersonating                                                     | 403 `GW_EMBED_IMPERSONATION_BLOCKED`                                                                                                                                   |
| Session ok and an active admin                                    | 200 `{ user, admin? }`: `user` is the GoTrue `/user` body, and `admin` is the admin profile and granted features from `getAdminContext`, omitted when it resolves null |
| Session ok, not an admin                                          | 403 `{ error: 'not_admin', email }`                                                                                                                                    |
| Admin check pending                                               | 503 `{ error: 'admin_check_pending' }` with `Retry-After: retryAfterSeconds(s)`                                                                                        |
| `ended`: Auth0 `invalid_grant`, or LFX logged out (see below)     | 401 `{ error: 'not_signed_in' }` with `x-gw-session: expired`                                                                                                          |
| GoTrue `/user` answers 401, 403 or 404                            | The record is dropped and minted once more; a second refusal drops that record too and is 503 `{ error: 'session_unavailable' }`, logged at WARN                       |
| `refused`: GoTrue refused the ID token                            | 503 `{ error: 'session_unavailable' }`; the service logs it at ERROR                                                                                                   |
| `unavailable`: Valkey, Auth0 or GoTrue could not answer           | 503 `{ error: 'session_unavailable' }`                                                                                                                                 |

The marker is the only answer that tells the embed its session is gone, so it is never sent for a fault. After a `/user` refusal the service revokes the refused session at GoTrue, then calls `store.discard(gwSid, { onlyIfAccessToken })` with the refused access token. `discard` removes the record and publishes the sign-out without setting the sign-out marker. `store.delete` would set it, and the re-mint would then fail as `ended` for 5 minutes. With `onlyIfAccessToken` the record is removed only while it still holds that token, so a session another tab minted in the meantime is kept and used. If GoTrue also refuses the session just minted, that is a Gatewaze fault, not a dead LFX session, and a 401 would send the embed round a reload into the same refusal. The service drops that record as well and answers 503.

For an admin session, the service starts `getAdminContext` (`@gatewaze/host-session` 1.2.0) before `getUser`, so the two run in parallel. It reads the active `admin_profiles` row and `rpc/admin_get_features` with the user's own token, and the 200 carries the result as `admin`. With it, the embed skips its own profile read and per-route permission calls before its first render. `getAdminContext` never rejects. When it resolves null, or when the profile's `user_id` is not GoTrue's `user.id`, the 200 is `{ user }` alone and the embed reads the profile itself. The 401, 403 and 503 answers never carry it, and a non-admin session never reads it. Each of its two reads is bounded at 3 seconds (`ADMIN_CONTEXT_TIMEOUT_MS`), so an admin's `/me` can take up to about 3 seconds longer than before when Supabase is slow, before it falls back to `{ user }`. Its warnings go through `hostSessionCoreLogger`, which drops the user id.

### `POST /api/gatewaze/session/logout`

The embed's sign-out button. It checks the package's CSRF rule with `isSameSite`: the `Origin`, when present, must be the origin of `PCC_BASE_URL`, and the `apikey` header must be the anon key. Anything else gets 403 `{ error: 'cross_site' }`. A missing or invalid `PCC_BASE_URL` fails closed.

Then `endGatewazeSession` runs host contract step 8:

1. `store.get(gwSid)`, then `store.fresh(gwSid)`, because GoTrue's logout authenticates with the access token. If the refresh fails, the stored session is used as it is. If GoTrue refuses the refresh outright, the package has already removed the record without the marker, and there is nothing left to revoke.
2. `logout(cfg, s)`, which is `POST /auth/v1/logout?scope=local` and revokes the refresh token.
3. `store.discard(gwSid, { onlyIfAccessToken })` with the access token just revoked. It deletes the record and publishes the sign-out so every pod closes the user's Realtime sockets. It sets no sign-out marker, and it leaves the record alone if another request has replaced it since.

Each step is bounded at `GW_HOST_SESSION_LOGOUT_STEP_TIMEOUT_MS` (2 seconds). A failed refresh or revoke does not stop the steps after it. If the store cannot be reached, or there is no stored session, nothing is removed and no sign-out is published. The route answers 204 even when GoTrue or Valkey failed; the service logs those at WARN, and an undeleted record ages out on its TTL. The LFX session is not touched.

The LFX session is still live, so the embed's next `/session/me` mints a new Gatewaze session from it. The embed's sign-out is in effect a reconnect: it revokes the old GoTrue session and closes its sockets, and the user carries on. Signing out of Gatewaze for real means logging out of LFX.

### The Supabase and API proxies

The embed's Supabase client points at `<origin>/api/gatewaze/supabase` and its API calls at `/api/gatewaze/api`, so every call it makes in host-session mode comes here with the placeholder `Authorization: Bearer host-session`.

| Browser path                            | Upstream                              |
| --------------------------------------- | ------------------------------------- |
| `/api/gatewaze/supabase/rest/v1/*`      | `GW_SUPABASE_URL` + `/rest/v1/*`      |
| `/api/gatewaze/supabase/storage/v1/*`   | `GW_SUPABASE_URL` + `/storage/v1/*`   |
| `/api/gatewaze/supabase/functions/v1/*` | `GW_SUPABASE_URL` + `/functions/v1/*` |
| `/api/gatewaze/api/*`                   | `GW_API_URL` + `/api/*`               |

GoTrue's `/auth/v1` is not proxied, as in the admin BFF: the embed's shim answers auth from `/session/me`. Realtime has its own upgrade handler. `GW_API_URL` must be an origin here, because the package resolves every path against the upstream's origin; a base path answers 503 `GW_API_URL_MISCONFIGURED` rather than being dropped.

`GatewazeProxyController` follows the package's host contract, steps 2 to 6. For each request it:

1. Resolves the path with the package's `upstreamUrl`. A path that normalises out of its prefix (`..`, `%2e%2e`, a backslash) gets 400 `GW_BAD_PATH`, before any session is loaded.
2. Calls `csrfDecision` with the origin of `PCC_BASE_URL`. `reject` gets 403 `{ error: 'cross_site' }`. A write needs the same origin (or none) and either `apikey` equal to the anon key or a Bearer header. A GET without proof is `anon`. A missing `PCC_BASE_URL` rejects everything that needs proof. No response ever carries `Access-Control-Allow-*`, so a cross-site page can set neither header. A GET with `Sec-Fetch-Site: same-origin` also counts as proof, so an `<img>` or link on an LFX page sends the session. Gatewaze GET endpoints must therefore have no side effects.
3. Asks the module seam (below). A refusal is 403 `GW_MODULE_ACCESS_REQUIRED`.
4. For `session`, calls `getGatewazeSession` and maps the outcome as the table below shows.
5. Forwards with the package's `proxyRequest`. Anon credentials come from `anonCredentials`: a publishable key goes in `apikey` only, and the API gets nothing.

| Outcome                                     | Answer                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `ok`, active admin                          | Forwarded with `Bearer <access token>` (and `apikey` on Supabase)                 |
| `ok`, not an admin, `isPublicRead` path     | Forwarded as anon                                                                 |
| `ok`, not an admin, admin check pending     | 503 `{ error: 'admin_check_pending' }` with `Retry-After`                         |
| `ok`, not an admin                          | 403 `{ error: 'not_admin' }`                                                      |
| `ended`                                     | 401 `{ error: 'not_signed_in' }` with `x-gw-session: expired`                     |
| `host_session_unavailable` with placeholder | 401 with the marker: embed code that only runs after sign-in has lost its session |
| `host_session_unavailable`, no placeholder  | Forwarded as anon                                                                 |
| `refused` or `unavailable`                  | 503 `{ error: 'session_unavailable' }`, never the marker                          |

The header, redirect, body and timeout policy:

- **Request headers.** The package drops `Authorization`, `Cookie`, `Origin`, `Referer`, `apikey`, `Host`, `X-Forwarded-*`, `Forwarded` and hop-by-hop headers, and sets its own credentials. The controller also drops the client-address headers (`X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP`, `X-Client-IP`, `Via`, `X-Forwarded-Server`). The browser's `X-Forwarded-For` chain is not forwarded. The upstream gets `X-Forwarded-For` set to `req.ip`, the one client address LFX resolved behind its ingress. `?access_token=` and `?token=host-session` are removed from the URL. LFX's own bearer token is never sent upstream. A Storage signed URL carries its own `?token=`, so `token`, `access_token`, `refresh_token` and `code` on any `/api/gatewaze` path are redacted in LFX's request log (`redactLoggedUrl`), its HTTP spans (`otel.mjs`) and Datadog RUM (`redactRumUrl`).
- **Response headers.** An allowlist, applied after the package drops `Set-Cookie` and any upstream `x-gw-session`. It leaves out `Access-Control-Allow-*` and `WWW-Authenticate`. The body passes through still encoded, so `Content-Encoding` and `Content-Length` travel together. `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src 'none'` are set last, because Storage serves user uploads from the LFX origin. A response made with the session gets `Cache-Control: private` and `Vary: Cookie` from the package.
- **Redirects.** Never followed. The package's `rewriteLocation` drops unsafe values, including `//host`, and makes a redirect to the upstream's origin root-relative. The controller then puts the mount in front, so it lands back on the proxy. A path-relative redirect is resolved against the request path. Either relative form is normalised and kept only while it stays under the mount, so `..` or `%2e%2e` cannot walk the browser off it. An `https:` redirect elsewhere, such as an edge function's OAuth hand-off, passes unchanged.
- **Body cap.** `GW_PROXY_MAX_BODY_BYTES` (default 100MB), counted on the bytes forwarded. The mount is excluded from the body parsers, so it inherits none of their 15MB limit, and the cap sits well above that because `host-media` uploads pass through here. Over the cap is 413 `gw_body_too_large`, after the request is drained so the client can finish writing. Every early answer drains first too.
- **Timeout.** `GW_PROXY_TIMEOUT_MS`, as an idle bound on the upstream socket, so a hung upstream is cut off and a slow upload or download that keeps moving is not. A timeout before the response is 408 `TIMEOUT`; any other upstream failure is 502 `GW_UPSTREAM_UNAVAILABLE`. A failure after the headers are sent breaks the connection.

#### Module entitlements (seam only)

`gatewazeModuleForPath(upstream, pathname)` maps a request to a Gatewaze module id. `authorizeGatewazeModule(req, moduleId)` is called for each mapped request before the session is loaded, and allows everything for now. This is a seam, not a gate. The mapping is incomplete. Only the API's `/api/modules/<id>/…` routes map to a module (case-insensitive, repeated slashes allowed). Modules also mount routes elsewhere under `/api`, e.g. `tasks` at `/api/admin/tasks`, and Supabase tables, buckets and functions are not mapped. The follow-up that enforces LFX-permission-based entitlements must build the mapping from the API's route registry and refuse a path it cannot map.

### LFX logout

`app.use('/logout', endGatewazeSessionOnLogout)` is registered before `auth(authConfig)`, next to `clearIntercomCookies`, because `express-openid-connect`'s built-in `/logout` never calls `next()`. `req.oidc` does not exist at that point, so `endGatewazeSession` finds the session from the `appSession` cookie alone and runs the same bounded steps, except that step 3 is `store.delete(gwSid)`. That also sets the package's 5 minute sign-out marker, so a request still in flight on the old LFX session cannot mint a new Gatewaze session after the logout. The marker is written even when GoTrue refused the refresh in step 1, because a record existed. Nothing is written when no record is found, so a `/logout` with a made-up cookie, which needs no LFX session and is not rate limited, costs one Valkey read. The middleware waits for `endGatewazeSession` for at most `GW_HOST_SESSION_LFX_LOGOUT_WAIT_MS` (3 seconds), and the steps carry on in the background after that. It always calls `next()`, so a Gatewaze or Valkey fault can delay the LFX logout by at most 3 seconds and never fails it. With host-session mode off it returns at once without touching Valkey.

Logouts that skip the `/logout` route, such as the forced `res.oidc.logout()` in `authMiddleware`, leave the record behind. The LFX session id it is keyed on is destroyed, so nothing can reach it, and it expires on its 24 hour TTL. GoTrue's own inactivity limit also applies.

## Authorization

Both Angular mounts are gated by `newsletterAccessGuard`: ED persona, or writer on the route's foundation/project. `requireGwEmbedAccess` makes the BFF match that, so a Contributor with no project role cannot reach the Gatewaze API or Supabase through LFX's server identity and network position.

It cannot be as precise as the guard. The guard checks writer on a _named_ project taken from `:projectUid` or `?project=`, and a proxied request names a Gatewaze path, not an LFX project. So the check is coarser: ED, root writer, or a writer grant on any foundation/project. That closes the "no role at all" hole without pretending to per-project precision the request cannot express.

**Authorization results are cached for 15 s per caller** (`GW_WRITER_SUMMARY_CACHE_TTL_MS`), so **a revoked writer grant stays admitted on `/api/gatewaze/*` for up to 15 seconds.** The cache exists because `getWriterSummary` fully paginates the caller's direct grants and access-checks every one, and these routes are called many times per screen. The window matches `PERSONAS_CACHE_TTL_MS`, which gates the same decision for the ED/root fast path. Keys are namespaced by identity kind (`u:` / `e:`) so a username cannot alias another caller's email address. Failed lookups are evicted at once rather than pinned for the TTL.

It runs before the proxies, so a denied caller cannot stream 100MB through the body limiter first. With `LFX_GATEWAZE_EMBED_ENABLED` off or no bearer token it answers the uniform 404 itself rather than a 403, which would tell a prober the route exists. On this router the two gates before it already answer those cases.

### The uniform 404

Host-session mode off, the embed flag off and a missing bearer token all answer identically: same status, same envelope, same `NOT_FOUND` code, and nothing in the response names the feature. Every gate builds it with one factory, `gwUniformNotFound` (`gw-api.helper.ts`), and `gatewaze.route.spec.ts` checks the three bodies are equal. Each gate records the real reason in a server-side DEBUG log line instead. When only one of the two flags is on, `resolveGatewazeHostSessionConfig` also logs a WARN once per process, since that is the likeliest reason for the outlet's not-configured panel.

That is the whole of the claim. The response is **not** indistinguishable from a genuinely unknown `/api/*` path: `app.use('/api/*', apiErrorHandler)` is a 4-arg Express _error_ handler, so an unmatched path falls through to the SSR catch-all and renders HTML. Closing that means an app-wide `/api/*` JSON not-found terminator, which is a larger change than this route should make on its own.

## Middleware exclusions in `server.ts`

`/api/gatewaze` is carved out of three global middlewares. Each exclusion is load-bearing:

| Middleware             | Why excluded                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `express.json()`       | The raw body must reach the upstream byte-for-byte; parsing consumes the stream.                                                                                                                          |
| `express.urlencoded()` | Same.                                                                                                                                                                                                     |
| `compression`          | The response is a streamed pass-through that must not be re-wrapped. The bytes arriving here are still encoded and carry the upstream's `Content-Encoding`, so compressing them again would corrupt them. |

The mount test is `isGwProxyPath` in `gw-api.helper.ts`: the path is `/api/gatewaze` or starts with `/api/gatewaze/`, case-insensitively because Express mounts are, and anchored on a segment boundary so a future `/api/gatewazex` does not silently inherit these exclusions.

**It must be given an untrimmed path**, and every caller goes through `gwMountPath(req)` (`req.originalUrl` with the query stripped) to guarantee that. `compression`'s filter is **deferred**: it runs at the first `res.write`, by which point Express has entered the mount and trimmed the prefix off `req.url`. Asked about `req.path`, it answered false and gzipped every proxied response, which also buffered streaming endpoints into one chunk at the end.

### Draining the body on an early rejection

Nothing upstream of the router consumes the request, so a middleware that answers on its own (`authMiddleware` with a 401, `apiRateLimiter` with a 429) leaves an in-progress upload unread, and Node will not finish with a keep-alive connection while a request body is still unread.

`attachGwDrainGuard` (`gw-api.helper.ts`, wired in `server.ts` behind the same `isGwProxyPath` gate) closes that. **The drain has to happen before the response is written**: once the response emits `finish`, Node stops feeding the socket into `req`, so responding first and draining second is the same hang. So the guard wraps `res.end` and defers the write until the drain settles, bounded by `GW_DRAIN_TIMEOUT_MS`. It drains at most once per request (`drainRequestBody` marks the request, and `requireGwEmbedAccess` and the controller drain before their own rejections), and it suppresses a second `res.end()`. While a drain is pending, `res.headersSent` stays `false`.

## Realtime

The embed's `supabase-js` builds its Realtime URL from `supabase.url`, which in host-session mode is `<origin>/api/gatewaze/supabase`. It opens `wss://<origin>/api/gatewaze/supabase/realtime/v1/websocket?apikey=…&vsn=1.0.0` and sends the placeholder `host-session` as its token. `realtime-js` puts the token inside Phoenix messages (`phx_join` and `access_token`), not in a header, so LFX One ends the browser's socket and opens its own to Supabase Realtime. The package's `bridgeRealtime` relays the messages and puts the real access token into every `phx_join` and `access_token` message. The browser never holds the token. This is host contract step 7.

### The upgrade hook

`startServer()` calls `getGatewazeRealtimeService().attach(httpServer, app)` right after `app.listen`. When host-session mode is on at startup, it adds an `upgrade` listener to the HTTP server and a shutdown hook. When the mode is off, it attaches nothing, so the server handles `Upgrade` requests exactly as before. Turning the flag on therefore needs a restart, as every environment flag does.

Once the listener exists, Node gives it every request that carries an `Upgrade` header and no longer serves such a request as a normal one. So with the mode on, any upgrade outside the Realtime path gets 404, e.g. a `GET /livez` with `Upgrade: h2c`. Browsers send `Upgrade` only for WebSockets, and Cloudflare and Traefik do not send h2c.

Under `ng serve`, Express is mounted through `createNodeRequestHandler` and upgrades go to the dev server, so Realtime works only on a built server (`yarn build`, then `node dist/lfx-one/server/server.mjs` with `PM2=true`) or on a deployed environment.

### Checks on each upgrade

An upgrade runs outside Express, so `req.oidc` and the middleware chain are not there. `onUpgrade` makes the cheap checks first, then runs the request through the Express app:

1. The path is exactly `/api/gatewaze/supabase/realtime/v1/websocket`, the socket `realtime-js` opens, or 404. No other Realtime path is proxied.
2. The pod is not shutting down, or 503.
3. Host-session mode is on (`isGatewazeHostSessionEnabled`), or the uniform 404. Nothing reads Valkey before this.
4. `Origin` is exactly the origin of `PCC_BASE_URL`, or 403. A missing `Origin` is refused. `SameSite=Lax` still sends the cookie on a cross-site WebSocket, so this is the cross-site check.
5. The pod is under its socket cap, or 503.
6. The request runs through `app` with a `ServerResponse` that has no socket behind it. It passes the same `auth()`, `authMiddleware`, `apiRateLimiter`, `requireGatewazeHostSession`, `requireGatewazeBearer` and `requireGwEmbedAccess` as every other `/api/gatewaze` request. `authMiddleware` sets the bearer token on the upgrade request as on any other. Because the path is under `/api/gatewaze`, it also skips the body parsers and compression, and the drain guard is a no-op on a GET. So a caller with no LFX session gets 401, a caller without ED, root writer or a writer grant gets 403, and an impersonating admin gets 403. Whatever Express answers, its status becomes the refused handshake, with `Retry-After` and `x-gw-session` copied over. A 2xx or 3xx answer, e.g. a sign-in redirect, becomes 500. Nothing Express writes reaches the socket. The whole upgrade, the gates here and the session load in step 9, has `GW_REALTIME_UPGRADE_TIMEOUT_MS` (45 seconds). Past that it is refused with 503 and its slots are freed, so a middleware that never answers or a hung Valkey or GoTrue call cannot hold them. A session that loads after the deadline is released, not used.
7. The Realtime route (`handleRoute`) takes the upgrade. A plain GET to the same path, with no upgrade behind it, gets the uniform 404.
8. The user is under the per-user cap, or 429. A client that went away while the gates ran is dropped here, before any session is loaded.
9. `openRealtimeSession(req)` loads the Gatewaze session the same way `getGatewazeSession` does: stored, refreshed, or minted from the LFX session. It starts listening for a sign-out before the load, so one that lands meanwhile is not missed.
10. The session outcome maps as on `/session/me`: `ended` is 401 with the marker, `refused` and `unavailable` are 503, `host_session_unavailable` is 404. A non-admin gets 403, and a pending admin check gets 503 with `Retry-After`.
11. `realtimeUpstreamUrl` builds the upstream URL from `GW_SUPABASE_URL`. It refuses a path that leaves `/realtime/v1` after normalisation (400), as a second check behind step 1. It drops any `access_token` from the query, and sets `apikey` to the anon key.
12. `ws` completes the handshake (`WebSocketServer` with `noServer`, messages capped at 8 MiB), and the socket is handed to `bridgeRealtime`.

Browsers cannot read a refused handshake's status or headers. The embed learns a session ended from its next HTTP call, which carries the same `x-gw-session: expired` marker. pino-http never logs an upgrade, because its response never finishes, so each refusal is logged at DEBUG with its status and a fixed reason, and never the URL or a header.

Running the upgrade through Express means the gates cannot drift from the HTTP routes. It also means `express-openid-connect` loads the LFX session for the upgrade. The response never ends on success, so the session is not written back. A token that `authMiddleware` refreshed during the upgrade is not saved, and the next HTTP request refreshes it again. That is safe only because the LFX One Auth0 client uses non-rotating refresh tokens. If it ever moves to rotating refresh tokens, an upgrade that refreshes would throw away the rotated token, and this has to change.

### Caps

| Cap                         | Value  | Answer | Scope                                                                 |
| --------------------------- | ------ | ------ | --------------------------------------------------------------------- |
| Sockets per LFX user        | 20     | 429    | One pod, keyed on the Auth0 `sub`; the admin BFF's value              |
| Sockets per pod             | 1,000  | 503    | Open sockets plus upgrades still being checked                        |
| Time to complete an upgrade | 45 s   | 503    | Per upgrade, so a stalled middleware or dependency cannot hold a slot |
| Socket age                  | 15 min | 1001   | Per socket, so access is re-checked on reconnect                      |
| Channels per socket         | 100    | 1008   | The package's bridge                                                  |
| Message size from browser   | 8 MiB  | 1009   | `ws` `maxPayload`                                                     |
| Unsent data per socket      | 4 MiB  | 1013   | The package's bridge, in each direction                               |

A slot is taken before anything async runs, so concurrent upgrades cannot all pass a cap. It is freed when the upgrade is refused, when the socket closes, or when the bridge closes. The caps are per pod, not across pods.

### Token refresh

The bridge refreshes the session 60 seconds before the access token expires by calling `fresh`. LFX's `fresh` first checks that the LFX session is still live: present in the session store, not expired, and not impersonating. A socket outlives the request that opened it, so this is how an LFX session that ended without `/logout` (expiry, or a forced `res.oidc.logout()`) closes the socket within one token lifetime. Then it calls `store.fresh(gwSid, { expectedSub })`, which refreshes under the store's lock. When the token changed, the bridge pushes the new token to every joined channel. When `fresh` returns null, the bridge closes the socket with 4001 and `realtime-js` reconnects through all the checks above. When GoTrue is unreachable, the bridge retries every 5 seconds while the current token is still valid, then closes with 1011.

The token refresh re-checks the LFX session but not the LFX authorization (ED, root writer or a writer grant). So every socket is closed with 1001 after `GW_REALTIME_MAX_SOCKET_AGE_MS` (15 minutes), and `realtime-js` reconnects through every check above. A user who loses that access keeps an open socket for at most 15 minutes. One who starts impersonating keeps it until the next refresh or the 15 minute close, whichever comes first. The socket runs as the real signed-in user throughout, never as an impersonation target.

A Valkey fault on the LFX session read counts as a missing session, because `SessionStoreService` is fail-soft. The socket closes and reconnects, which is fail-closed.

### Sign-out

`bridgeRealtime` gets `onSignedOut: (fn) => store.onDelete(gwSid, fn)`. `store.delete` and `store.discard` publish the sign-out on the store's channel, and every pod closes that session's sockets with 4001. LFX's `/logout`, the embed's sign-out button and a `/user` refusal all reach it. A sign-out that lands while the socket is still opening closes it as soon as the handshake completes.

### Shutdown

The shutdown hook calls `closeAll()`, which stops taking upgrades and closes every bridge with 1001 (going away). `realtime-js` reconnects, and the load balancer sends it to another pod. The hook runs during the 15 second load balancer drain window, before the HTTP server closes.

### Ingress

On LF dev, `app.dev.lfx.dev` goes through Cloudflare, an AWS NLB and Traefik (ingress class `traefik`, `websecure` entrypoint). All three pass WebSocket upgrades without extra annotations, and an upgrade request to this path reaches Express there today. The Phoenix heartbeat `realtime-js` sends every 25 to 30 seconds keeps the socket inside Cloudflare's 100 second and the NLB's 350 second idle timeouts. Traefik is not given custom entrypoint timeouts, so confirm on dev that a socket stays open past 60 seconds.

## Where the session lives

The GoTrue session is a separate Valkey record, not a field on `req.appSession`. `express-openid-connect` reads the whole session once per request and overwrites it on every response, and GoTrue rotates refresh tokens, so two concurrent requests would undo each other's rotation. A WebSocket upgrade cannot write `appSession` at all. `AuthStateService` keeps its own record for the same reason.

Keys sit under `lfx-ui[:<VALKEY_KEY_NAMESPACE>]:gatewaze:v1:` (`buildGatewazeHostSessionKeyPrefix`). The package adds `session:`, `refresh-lock:`, `create-lock:` and `signed-out:` keys under it and publishes sign-outs on `<prefix>logout`. The store has its own ioredis connection to `VALKEY_URL`, plus a duplicate for the sign-out subscription, because a subscribed connection cannot run commands. Records have a 24 hour sliding TTL, renewed on each refresh, matching GoTrue's inactivity window.

Every use of the package (the store, the proxies and the Realtime bridge) logs through `hostSessionCoreLogger`, which keeps only `err`, `status` and `path` from the package's warn metadata, because it also carries the GoTrue `user_id`.

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

Deriving the id rather than storing it means nothing is written to `appSession`, and `/logout` can derive the same id from the cookie alone.

## Feature flag

`LFX_GATEWAZE_HOST_SESSION` (`ServerFeatureFlag.GatewazeHostSession`) is off by default and default-deny like every server flag. `resolveGatewazeHostSessionConfig` turns host-session mode on only when all of these hold:

- `LFX_GATEWAZE_HOST_SESSION` and `LFX_GATEWAZE_EMBED_ENABLED` are on.
- `SESSION_STORE_ENABLED` is `true` and `VALKEY_URL` is set. Without the store, `appSession` has no stable id to key on.
- `GW_SUPABASE_URL` is set, and is `https://` when `NODE_ENV` is `production`, because the user's GoTrue tokens go to it.
- `GW_SUPABASE_ANON_KEY` passes `isPublishableSupabaseKey`, so a service-role key turns the mode off.
- `PCC_AUTH0_SECRET` is set.

`RuntimeConfig.gwHostSession` is the result of the same check (`buildGwRuntimeConfig`), so the embed outlet and the routes cannot disagree on one pod. While it is false the outlet shows its not-configured panel and never mounts the embed.

The flag stays separate from `LFX_GATEWAZE_EMBED_ENABLED` rather than being folded into it plus config presence. Folding it would turn host-session mode on in any environment that already has the embed flag and the Supabase config, and it would remove the one switch that turns off only the server-held sessions. Two flags cost one extra env var. A rolling update that flips the flag is harmless. A page from a flag-on pod whose calls land on a flag-off pod gets the uniform 404, which the embed reads as `unavailable` and retries, and nothing is half-written.

## Related

- [Gatewaze Embed Host](../frontend/gw-embed.md#session), the context the embed outlet passes to the loader in this mode.
- [Error Handling](./error-handling-architecture.md), the shared error pipeline the gates' 404 and 403 go through.
- [Authentication](./authentication.md), for the session store and why `appSession` is never written outside `express-openid-connect`.
- [`@gatewaze/host-session` README](https://www.npmjs.com/package/@gatewaze/host-session), the host contract.
