# Gatewaze Host Session

Host-session mode moves the embedded Gatewaze admin off its browser sign-in. LFX One gets the user's Gatewaze (GoTrue) session server to server with GoTrue's `id_token` grant and keeps it in Valkey. The browser holds only its LFX `appSession` cookie and never sees a Gatewaze token. Tracking issue: #2738.

This page covers session acquisition, which is the first part to land. Nothing is mounted on it yet. The `/api/gatewaze/session/*` routes, the Supabase and API proxy, Realtime and the embed outlet change come in later PRs, and each one extends this page.

## Files

| File                                                         | Role                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `src/server/services/gatewaze-session.service.ts`            | Configuration gate, key derivation, the session store, `getGatewazeSession`       |
| `src/server/utils/refresh-token-exchange.util.ts`            | `exchangeRefreshTokenForIdToken`, the Auth0 refresh grant that yields an ID token |
| `src/server/helpers/app-session-cookie.helper.ts`            | Reads the LFX session id from the raw `Cookie` header                             |
| `src/server/helpers/server-feature-flag.helper.ts`           | `ServerFeatureFlag.GatewazeHostSession`                                           |
| `packages/shared/src/constants/gw-host-session.constants.ts` | Scope, HKDF label, TTL, cookie name and id shape                                  |

The session logic itself (GoTrue sign-in and refresh, the encrypted store, its locks and sign-out channel) comes from the published `@gatewaze/host-session` package, pinned to an exact version in `apps/lfx-one/package.json`. LFX One is a thin Express adapter over it and follows the package README's host contract.

## How a session is acquired

`getGatewazeSession(req)` returns one of five outcomes and never throws:

1. Check the configuration (see [Feature flag](#feature-flag)). If host-session mode is off, the outcome is `host_session_unavailable`.
2. Read the LFX session id from the `appSession` cookie and derive the Gatewaze session id from it (see [Session id](#session-id)).
3. Call `store.fresh(gwSid, { expectedSub })`. This returns the stored session, refreshing it under a lock first when its access token is within 60 seconds of expiry. If GoTrue refuses the refresh, the store deletes the record and returns null.
4. With no session, call `store.acquire(gwSid, mint, { expectedSub })`. The mint gets an ID token from Auth0 (`exchangeRefreshTokenForIdToken`), then calls GoTrue's `id_token` grant (`signInWithIdToken`). `acquire` runs one mint per session id across every pod; concurrent callers wait for it and get the stored result.

`expectedSub` is `req.oidc.user.sub`, the real signed-in user. A stored session for any other Auth0 subject is revoked, deleted and replaced by a new mint.

| Outcome                    | Cause                                                                                    | What the `/session/me` route will answer |
| -------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| `ok`                       | A stored, refreshed or newly minted session                                              | 200, or 403/503 from the admin check     |
| `host_session_unavailable` | Flag off, store off, Supabase config missing or unsafe, no store-backed `appSession` id  | Uniform 404                              |
| `ended`                    | Auth0 refused the refresh token (`invalid_grant`, 400, 401, 403), or a sign-out marker   | 401 with `x-gw-session: expired`         |
| `refused`                  | GoTrue refused the ID token (a 4xx): provider audience or issuer wrong, or a banned user | 503 with an ERROR log, never 401         |
| `unavailable`              | Valkey, Auth0 or GoTrue could not answer                                                 | 503                                      |

`refused` is kept apart from `ended` because it is a configuration fault. Answering 401 would send the embed round a reload that cannot fix it.

### Why the ID token comes from a refresh grant

The ID token `express-openid-connect` received at login carries LFX's raw `nonce`, and GoTrue cannot match it. An ID token from a `refresh_token` grant with `scope=openid email profile` and no `audience` carries no nonce, which is what GoTrue requires when the request sends none. The LFX One Auth0 client uses non-rotating refresh tokens, so this extra grant does not invalidate the refresh token `express-openid-connect` holds. The token is passed straight to GoTrue. It is never cached, never written to `appSession` and never logged. Locally the Authelia branch sends the same scope.

## Where the session lives

The GoTrue session is a separate Valkey record, not a field on `req.appSession`. `express-openid-connect` reads the whole session once per request and overwrites it on every response, and GoTrue rotates refresh tokens, so two concurrent requests would undo each other's rotation. A WebSocket upgrade cannot write `appSession` at all. `AuthStateService` keeps its own record for the same reason.

Keys sit under `lfx-ui[:<VALKEY_KEY_NAMESPACE>]:gatewaze:v1:` (`buildGatewazeHostSessionKeyPrefix`). The package adds `session:`, `refresh-lock:`, `create-lock:` and `signed-out:` keys under it and publishes sign-outs on `<prefix>logout`. The store has its own ioredis connection to `VALKEY_URL`, plus a duplicate for the sign-out subscription, because a subscribed connection cannot run commands. Records have a 24 hour sliding TTL, renewed on each refresh, matching GoTrue's inactivity window.

The store's Lua script touches three keys at once, which works on the non-cluster Valkey every environment uses today. If that Valkey ever moves to cluster mode, the prefix needs a hash tag such as `{gatewaze}`.

## Keys

| Key          | Derivation                                                                                         | Use                                                  |
| ------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Master key   | `HKDF-SHA256(PCC_AUTH0_SECRET, salt = empty, info = 'lfx-one gatewaze host-session v1', 32 bytes)` | Input to the two below                               |
| Store key    | `deriveKeys([master], 'store')` from the package                                                   | AES-256-GCM on every record, bound to the session id |
| Gatewaze sid | `base64url(HMAC-SHA256(master, 'sid:' + lfxSid))`                                                  | The record's id                                      |

Deriving from `PCC_AUTH0_SECRET` means there is no new secret to provision, and rotating it already signs everyone out of LFX. The store refuses to read a plaintext record, so a value planted in Valkey is deleted rather than used.

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
- `GW_SUPABASE_URL` is set and `GW_SUPABASE_ANON_KEY` passes `isPublishableSupabaseKey`, so a service-role key turns the mode off.
- `PCC_AUTH0_SECRET` is set.

A rolling update that flips the flag is harmless. A page from a flag-on pod whose calls land on a flag-off pod gets the uniform 404, which the embed reads as `unavailable` and retries, and nothing is half-written.

## Related

- [Gatewaze Embed Proxy](./gw-proxy.md), the `/api/gw` pass-through this replaces once host-session mode is the default.
- [Authentication](./authentication.md), for the session store and why `appSession` is never written outside `express-openid-connect`.
- [`@gatewaze/host-session` README](https://www.npmjs.com/package/@gatewaze/host-session), the host contract.
