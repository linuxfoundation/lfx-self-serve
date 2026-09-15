# Gatewaze Embed Proxy (`/api/gw/*`)

The BFF pass-through in front of the embedded Gatewaze admin pilot's own backend. This is the repo's **first wildcard proxy route**, and it departs from the controller/service/route shape every other endpoint follows, so the reasoning is recorded here rather than left in code comments.

**Files**

| File                                                          | Role                                       |
| ------------------------------------------------------------- | ------------------------------------------ |
| `src/server/routes/gw-proxy.route.ts`                         | Mount, middleware order                    |
| `src/server/middleware/require-gw-embed-access.middleware.ts` | Authorization                              |
| `src/server/controllers/gw-proxy.controller.ts`               | Header policy, body limiter, upstream call |
| `src/server/helpers/gw-api.helper.ts`                         | `GW_API_URL` resolution and validation     |

## Why a wildcard proxy at all

The embedded module is a React application with its own backend. The agreed permission model routes **all** of its API traffic through LFX so that access is controlled on the LFX side rather than by exposing the Gatewaze API to browsers directly. The embed calls dozens of endpoints that LFX does not model and should not have to; enumerating them here would mean a code change in this repo for every upstream route change.

So the route is `router.use(...)` — every method, every sub-path — and the controller names no endpoint of its own.

## Why there is no service layer

`docs/reviews/backend-checklist.md` requires service / controller / route for every endpoint. This endpoint has controller + route only. The deviation is deliberate:

- There is no business logic to separate. What looks like logic — header policy, the body limiter, the timeout, the undici error unwrap — is all HTTP-boundary concern, which is the controller's job under the same checklist.
- The parts that would move are the parts that took three rounds of review to get right (the 413 drain protocol in particular) and are now pinned by a real-socket integration test. Moving them buys structure and risks correctness.
- This IS unusual here, and saying so is more useful than a bad precedent. Across `src/server/controllers/`, only this and `persona.controller.ts` have no domain service, and that one delegates to `utils/persona-helper`. An earlier draft of this doc cited `mktg-agents.controller.ts` as controller-only; that was wrong — it injects `GuildService`, `BrandKitService`, `FoundationMessageService` and `ProjectService`, and is an example of the three-file pattern, not an exception to it.

Revisit if a second wildcard proxy appears; two would justify a shared service.

### And why not `MicroserviceProxyService`

`backend-checklist.md` §12 requires external calls to go through `MicroserviceProxyService.proxyRequest()` rather than raw `fetch`. This route uses raw `fetch`, deliberately: `proxyRequest` is built for LFX gateway services — it resolves a service base URL, attaches LFX auth, and parses a JSON body. None of that applies here. The upstream is not an LFX microservice, it authenticates on the embed's own Supabase bearer rather than LFX's, and the whole point is to forward an opaque byte stream in both directions without parsing it. `guild.service.ts` sets the in-repo precedent for calling a non-gateway upstream with raw `fetch`.

## Request path

1. **`authMiddleware`** (global) — every `/api/*` path requires a bearer before reaching here.
2. **`apiRateLimiter`** (global) — caps request count, not bytes.
3. **`requireGwEmbedAccess`** — see below.
4. **`GwProxyController.proxy`** — flag + bearer gate, then forward.

### Authorization

Both Angular mounts are gated by `newsletterAccessGuard`: ED persona, or writer on the route's foundation/project. The proxy originally gated on "is authenticated", which made the BFF **weaker than the UI in front of it** — a Contributor with no project role could relay arbitrary methods and bodies to `GW_API_URL` through LFX's server identity and network position.

`requireGwEmbedAccess` closes that. It cannot be as precise as the guard: the guard checks writer on a _named_ project taken from `:projectUid` or `?project=`, and a proxied request names a Gatewaze path, not an LFX project. So the check is coarser — ED, root writer, or a writer grant on any foundation/project — which closes the "no role at all" hole without pretending to per-project precision the request cannot express.

Order matters twice:

- It runs **before** the controller, so a denied caller cannot stream 100MB through the limiter first.
- It **defers to the controller's uniform 404** when the flag is off or no bearer is present. A 403 there would tell a prober the route exists and is merely disabled.

### The uniform 404

Flag-off and no-bearer answer identically — same status, same envelope, same `NOT_FOUND` code — so a caller cannot tell which of the two it hit, and the response names no feature. It was once `gw_flag_disabled`, which named the pilot to any authenticated prober.

That is the whole of the claim, deliberately. The response is **not** indistinguishable from a genuinely unknown `/api/*` path: there is no JSON 404 terminator for unmatched `/api/*` — `app.use('/api/*', apiErrorHandler)` is a 4-arg Express _error_ handler, so an unmatched path falls through to the SSR catch-all and renders HTML. A prober can still tell this route exists from the envelope alone. Closing that means adding an app-wide `/api/*` JSON not-found terminator, which is a larger change than this route should make unilaterally.

The real reason for the 404 is recorded in a server-side log line instead.

## Middleware exclusions in `server.ts`

`/api/gw` is carved out of three global middlewares. Each exclusion is load-bearing:

| Middleware             | Why excluded                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `express.json()`       | The raw body must reach the upstream byte-for-byte; parsing consumes the stream.                                 |
| `express.urlencoded()` | Same.                                                                                                            |
| `compression`          | The response body is streamed through; compressing a pass-through re-encodes bytes the upstream already encoded. |

The mount test is `path === '/api/gw' || path.startsWith('/api/gw/')` — anchored on a segment boundary so a future `/api/gwidgets` does not silently inherit these exclusions.

Because the body parsers are excluded, the route inherits none of their 15MB limit. `GW_PROXY_MAX_BODY_BYTES` (100MB) exists so the route is not an unbounded upload path; it is set well above 15MB because `host-media` uploads legitimately pass through here.

## Header policy

**Requests** use a denylist (`STRIPPED_REQUEST_HEADERS`). `Cookie` is stripped so LFX session cookies never reach the upstream; `Origin` and the `X-Forwarded-*` family are stripped because this proxy does not vouch for them. `Authorization` is deliberately **kept** — it carries the embed's Supabase token, the only credential the upstream accepts.

> Known limitation: a denylist forwards anything not named. An allowlist would be safer but needs a captured list of what the embed actually sends; inverting it blind risks breaking vendor headers. The upstream authenticates on the bearer alone, so no other header is load-bearing for authorization today.

**Responses** use an allowlist (`FORWARDED_RESPONSE_HEADERS`), so the upstream cannot leak arbitrary headers into an LFX response. Three cases need care:

- **`content-length` is dropped when the upstream set `content-encoding`.** `fetch` decodes the body but leaves the compressed length on the header object; copying it truncates the write and delivers valid-looking JSON cut off mid-document. This is the anti-truncation guarantee, not a backstop.
- **`location` is forwarded only when it resolves to the configured upstream origin.** Verbatim, it is an upstream-controlled open redirect wearing the LFX origin.
- **`nosniff` and `Content-Security-Policy: sandbox; default-src 'none'` are set after the allowlist loop**, so the upstream cannot override them. This route is not JSON-only — `host-media` means user-uploaded bytes are served from the LFX origin, and without these an uploaded `.html` or `.svg` executes script there with reach over the session cookie, `localStorage` and every `/api/*` route. The sandbox drops the response into an opaque origin; `fetch`/XHR consumers, which is how the embed reads this route, are unaffected.

## Upstream URL construction

The upstream URL is **resolved, not concatenated**:

```ts
const base = new URL(`${baseUrl}/`);
const resolved = new URL(req.url.replace(/^\/+/, ''), base);
```

Express does not normalize the path it hands the router — `/api/gw/../../secret` arrives as `/../../secret` — and the URL parser inside `fetch` resolves those dot segments. Concatenation would send `https://host/api/v1/../../secret` upstream as `https://host/secret`, outside the base path `GW_API_URL` may legitimately carry. A request whose resolved origin or path prefix moves is rejected with `400 gw_path_escapes_base`.

The upstream **host** was never reachable this way: Express matches the mount on a segment boundary, so `req.url` always begins with `/` and authority injection (`//evil.com`, `@evil.com`) cannot occur.

## Failure handling

| Condition                      | Response                       |
| ------------------------------ | ------------------------------ |
| Flag off / no bearer           | `404 not_found`                |
| Caller lacks newsletter access | `403 GW_EMBED_ACCESS_REQUIRED` |
| Path escapes the base          | `400 gw_path_escapes_base`     |
| Body over the ceiling          | `413` after a bounded drain    |
| Upstream timeout (60s)         | `408 TIMEOUT`                  |
| `GW_API_URL` misconfigured     | `503 GW_API_URL_MISCONFIGURED` |

Two subtleties in the 413 path, both regressions that shipped once and are now pinned by `gw-proxy.controller.integration.spec.ts` (a real `http.Server` and a real client socket — the unit spec substitutes `Readable.from()`, which has no socket, so `req.destroy()` is a no-op there and a drain that never completes looks identical to one that does):

- The response must not be written to a destroyed socket. Destroying the request first gave the caller `ECONNRESET` while the log recorded a clean 413.
- The drain must complete before the response ends. `res.end()` stops Node feeding the socket into `req`, so the client could never finish writing and hung until keep-alive.

Separately, undici wraps **any** request-body stream failure in `TypeError: fetch failed` with the original on `.cause`. Without unwrapping, the limiter's 413 reaches `apiErrorHandler` as a bare `TypeError` and the caller gets a generic 500.

## Environment

| Variable     | Required | Notes                                                                                          |
| ------------ | -------- | ---------------------------------------------------------------------------------------------- |
| `GW_API_URL` | Yes      | Validated lazily on first proxied request. No trailing slash; `https:` outside dev/local/test. |

`GW_PROXY_TIMEOUT_MS` (60s) and `GW_PROXY_MAX_BODY_BYTES` (100MB) are currently **module constants, not environment variables**, despite being described as env vars when the work was scoped. Worth reconciling — either wire them up or drop the expectation.

## Related

- [Authentication](./authentication.md) — bearer extraction, selective auth
- [Error Handling](./error-handling-architecture.md) — the shared error pipeline this route delegates to
- [Logging & Monitoring](./logging-monitoring.md) — operation lifecycle and log levels
