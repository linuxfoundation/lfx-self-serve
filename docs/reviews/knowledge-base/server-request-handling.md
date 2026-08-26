# Server request handling

Patterns where new backend routes are mounted without the right auth middleware, guards / interceptors are ordered wrong, history state is wiped on URL updates, or Express query / body / route params are consumed without the project's hardening helpers. CodeRabbit's strongest signal on this codebase — auth and ordering bugs are runtime security bugs.

**Read when:** `app.config.ts`, anything under `app/shared/guards/` or `app/shared/interceptors/`, any `*.routes.ts`, any new file under `apps/lfx-one/src/server/routes/`, `apps/lfx-one/src/server/server.ts`, `middleware/auth*`, or any file under `apps/lfx-one/src/server/controllers/` or `apps/lfx-one/src/server/services/`. Cross-checked in Steps 3-4 of the learnings-review playbook (KB-match gate in Step 3, false-positive filter in Step 4).

---

## `server-request-handling/interceptor-order-breaks-ssr-cookies` — Critical

**Pattern:** in `app.config.ts`'s `withInterceptors([...])` array, a URL-rewriting interceptor (e.g., `ssrBaseUrlInterceptor` that absolutizes paths for SSR loopback) is placed BEFORE the authentication interceptor that adds session cookies based on URL prefix. The auth interceptor only matches `/api/` or `/public/api/` prefixes; once the URL is rewritten to `http://127.0.0.1:PORT/...`, the prefix match fails and cookies are dropped.

**Detect:** in `app.config.ts`, locate the `withInterceptors([...])` array. Check that authentication interceptor appears BEFORE any URL-rewriting interceptor. (Interceptors run in array order on outgoing requests.)

**Empirical citation:** PR #632 `apps/lfx-one/src/app/app.config.ts:40` — CodeRabbit 🔴 Critical — "Placing `ssrBaseUrlInterceptor` before `authenticationInterceptor` breaks authenticated SSR API calls. `authenticationInterceptor` only adds the incoming cookies when `req.url` starts with `/api/` or `/public/api/`, but after the rewrite the URL is `http://127.0.0.1:PORT/…`"

**Failure message:** URL-rewriting interceptor runs before auth interceptor — auth check fails post-rewrite.

**Fix:** reorder the array so the authentication interceptor runs first; URL-rewriting interceptors run after, on already-authenticated requests.

---

## `server-request-handling/guard-runs-before-its-prerequisite` — Critical

**Pattern:** in a route's `canActivate: [guardA, guardB]` array, a context-mutating guard (e.g., `projectQueryParamGuard` which looks up + sets the active project) runs BEFORE an access-control guard (e.g., `executiveDirectorGuard`). Non-authorized users hitting the route with the relevant query param still trigger the context mutation before being redirected away — leaking work AND mutating state for unauthenticated requests.

**Detect:** in `*.routes.ts`, for every `canActivate: [...]` array, check the order. Authz guards (executive director, writer, auth) must precede context-mutating guards (query-param resolvers, project setters).

**Empirical citation:** PR #701 — "For ED-only routes, `projectQueryParamGuard` runs before `executiveDirectorGuard`. Because Angular evaluates guards in order, non-ED users hitting `…?project=` will still trigger the project lookup + context mutation before being redirected."

**Failure message:** Context-mutating guard runs before access-control guard — unauthorized users trigger context changes before redirect.

**Fix:** reorder `canActivate` so authz guards come first. Context-mutating guards should only run when authorization has already passed.

---

## `server-request-handling/new-route-unintended-public-exposure` — Critical

**Pattern:** a new server route is reachable anonymously when it should require a session, because of how the route is _classified_ — not because a middleware call is missing. Auth is applied by a **single global `authMiddleware`** mounted once in `server.ts`, and `DEFAULT_ROUTE_CONFIG` in `auth.middleware.ts` classifies each request by prefix/pattern, with anything unmatched falling through to `defaultAuth: 'required'`. So a bare new `app.use('/api/<X>', router)` is already required-auth by default; the exposure comes from a route landing in the optional/public lane instead.

**Detect:** for each added or changed route, resolve its **effective path** and its **resulting auth classification** against `DEFAULT_ROUTE_CONFIG`. Flag it Critical when a sensitive route becomes anonymously reachable through any of: (a) a new `DEFAULT_ROUTE_CONFIG` entry with `auth: 'optional'`/`'public'`; (b) a new `/public/api/*` (or other public-prefix) mount in `server.ts`; or (c) a new or changed handler added to a router **already mounted** under an existing optional/public prefix (any `public-*.route.ts` under `/public/api`, or an SSR path matching an existing optional pattern), which inherits that classification with no config or mount change. Do **not** flag a normal new `/api/*` mount for lacking an inline `authMiddleware` — the global mount already covers it, and demanding `app.use('/api/<prefix>', authMiddleware, router)` or `router.use(authMiddleware)` is a false positive in this codebase.

**Empirical citation:** general pattern (no single anchor). The classification model is `DEFAULT_ROUTE_CONFIG` in `auth.middleware.ts` and the `/public/api/*` mounts in `server.ts`; this rule guards new routes from silently landing in the optional/public lane. For a required-auth route that still fails to check the caller against the resource it serves, see `server-request-handling/cross-account-authorization-missing` below — that is a different defect from public exposure.

**Failure message:** New route is anonymously reachable via public/optional classification — unintended unauthenticated access.

**Fix:** if the exposure is unintentional, keep the route in the default `required` lane (do not add a `/public/api` mount or an `optional`/`public` `DEFAULT_ROUTE_CONFIG` entry for it). If public access is intentional, mount it under `/public/api/` (or add the explicit `DEFAULT_ROUTE_CONFIG` entry) **and** document why, and ensure the handler still enforces any per-user authorization it needs on the data it returns.

---

## `server-request-handling/cross-account-authorization-missing` — Critical

**Pattern:** a **required-auth** route reads a resource identifier from the request (`req.params`/`req.query`/body) and returns that resource's data without checking that the authenticated caller is allowed to access **that specific** identifier. Authentication is satisfied — the caller has a valid session — but authorization is not: any logged-in user can substitute another tenant's id and read across the account boundary (IDOR / broken object-level authorization). The global `authMiddleware` does **not** close this gap; it only proves the caller is authenticated, never that they own the requested object.

**Detect:** for a handler that takes an account/org/foundation/project identifier from the request and queries by it, verify the handler establishes the caller (`getEffectiveEmail(req)` / the bearer token, per `docs/reviews/backend-checklist.md`) and checks the caller's entitlement to that identifier before returning data — a membership/ownership lookup, an upstream call made **as the user**, or an equivalent access check. Flag it Critical when the identifier flows straight from the request into the data lookup with no such check between them. This is orthogonal to route classification: a route can be correctly required-auth and still fail this.

**Empirical citation:** PR #706 `apps/lfx-one/src/server/controllers/org-lens-foundations.controller.ts:63` — Copilot — "`getFoundationsAndProjects` performs no AuthN/AuthZ check before querying for an arbitrary `accountId`." The route is required-auth (it is not under a public prefix), so the defect is not exposure — it is that any authenticated user could enumerate any org's foundations and projects by supplying its id.

**Failure message:** Required-auth route queries a caller-supplied id without an ownership/entitlement check — cross-account (IDOR) access.

**Fix:** before serving the resource, resolve the authenticated caller and verify their entitlement to the requested identifier — a membership/ownership check, or an upstream read performed as the user so the upstream enforces access. Do not rely on the route being authenticated; authentication is not authorization.

---

## `server-request-handling/instance-state-shared-across-concurrent-requests` — Critical

**Pattern:** a service or controller (singleton-scoped) carries mutable instance state (counter, buffer, current-stream id) that's read / written from per-request handler methods. Two concurrent requests interleave on that state — one request sees the other's progress, or both corrupt each other.

**Detect:** in `apps/lfx-one/src/server/services/**` and `apps/lfx-one/src/server/controllers/**`, find class fields of mutable primitive / map / array type that are mutated inside instance methods called from route handlers. SSE / streaming services are the highest-risk site — counters, buffers, current-status fields. Flag if state isn't per-request-scoped (local variable, or keyed by a request id).

**Empirical citation:** PR #298 `apps/lfx-one/src/server/services/lens.service.ts:13` — "`runContentCount` is stored on the `LensService` instance, but `LensController` holds a single `LensService` and can serve multiple concurrent SSE requests. This counter will be shared across overlapping streams and can cause one client's stage/status to be affected by another's. Make the counter per-stream (e.g., local state inside `readUpstreamSSE`, or pass a mutable context object into `mapUpstreamEvent`) rather than an instance field."

**Failure message:** Singleton-service instance state shared across concurrent requests — cross-request data leak.

**Fix:** move state into the handler-local scope (`let counter = 0` inside the streaming method) or pass a per-request context object through the call chain. If keyed storage is genuinely needed, key a `Map` by request id and clean up on disconnect.

---

## `server-request-handling/case-sensitive-email-tag-match` — Important

**Pattern:** an OIDC-claim email (or other request-supplied email) is passed into a query-service lookup that does tag-based matching (`tags=email:<value>`) without lowercasing first. Query-service tag matches are case-sensitive — uppercase characters in the token email cause the lookup to silently miss the registrant / invitation.

**Detect:** in `apps/lfx-one/src/server/services/**`, find paths where `req.oidc?.user?.email` (or `req.oidc?.idToken` email claim) feeds into `getMeetingRegistrantsByEmail`, `addInvitedStatusToMeeting`, or any query-service helper using email as a tag. Verify the email is `.toLowerCase()`-normalised before use. Cross-check against `user.controller.ts` where normalisation happens correctly (line 123 in the cited PR).

**Empirical citation:** PR #272 `apps/lfx-one/src/server/services/meeting.service.ts:696` — "Email matching against query-service tags is case-sensitive. Here `email` is taken directly from the OIDC claims and passed into `getMeetingRegistrantsByEmail` without normalization, while other code paths lower-case emails before comparing/filtering." Also flagged in PR #249 `public-meeting.controller.ts:66` — "The email should be lowercased before passing to `addInvitedStatusToMeeting` for consistent tag matching."

**Failure message:** Email used for query-service tag matching without lowercasing — uppercase characters cause silent lookup misses.

**Fix:** normalise email at the boundary: `const email = req.oidc?.user?.email?.toLowerCase()`. Or push the normalisation inside `getMeetingRegistrantsByEmail` so every caller benefits.

---

## `server-request-handling/promise-all-vs-allsettled-fans-out` — Important

**Pattern:** `Promise.all([...])` over a fan-out of per-item upstream calls (per-meeting registrant fetch, per-meeting invited-status check) in a controller. A single failure rejects the entire array and returns no data to the client — even for items that succeeded. `Promise.allSettled` would degrade gracefully.

**Detect:** in `apps/lfx-one/src/server/controllers/**`, find `Promise.all([...])` where the array is built from a `.map(meeting => this.x.getY(...))` (or analogous per-item fan-out). Verify whether per-item failure should fail the whole request (rare) or degrade gracefully (typical for read endpoints).

**Empirical citation:** PR #247 `apps/lfx-one/src/server/controllers/meeting.controller.ts:54` (also `:77`) — "The parallel `Promise.all` on line 47 doesn't handle individual promise failures. If `getMeetingRegistrants` fails for one meeting, the entire operation fails and no meetings are returned to the client. Consider using `Promise.allSettled()` instead to handle individual failures gracefully, logging warnings for failed fetches while still returning data for successful ones."

**Failure message:** `Promise.all` fan-out — one failure kills the whole list; consider `Promise.allSettled`.

**Fix:** use `Promise.allSettled(...)`, partition into `fulfilled` / `rejected`, log `rejected` reasons at WARN with the item id, and return the `fulfilled` values. Document the choice so future maintainers don't accidentally re-introduce the all-or-nothing semantics.

---

## `server-request-handling/replaceState-loses-history-state` — Important

**Pattern:** `Location.replaceState(url)` is called with only one argument, OR raw `history.replaceState(state, '', url)` is called with a fresh / null `state` arg, wiping the existing `history.state`. Angular Router stores its `navigationId` in `history.state`; wiping it breaks `Router.getCurrentNavigation()`, back / forward navigation, and scroll restoration. The risk surface covers both the Angular `Location.replaceState(url)` single-arg form AND raw `history.replaceState` calls (typically used for query-param clearing) when the first arg isn't `history.state` (or a spread that preserves it).

**Detect:** grep for `\.replaceState\(\s*[^,)]+\s*\)` — calls with only the URL arg (single-arg form). For two- or three-arg `history.replaceState(state, ...)` calls, verify the first arg is `history.state` (or `{ ...history.state, ... }`), not a fresh literal or `null`.

**Empirical citation:** PR #701 — "`Location.replaceState(...)` without preserving `history.state` — Angular Router's `navigationId` gets wiped." Also flagged at PR #578 (per H-02 KB coverage audit, 2026-05-19): raw `history.replaceState` used for query-param clearing overwrites Router state and breaks back/forward navigation + scroll restoration.

**Failure message:** `replaceState` without state preservation breaks Router internals — back/forward navigation, scroll restoration, and `getCurrentNavigation` all fail.

**Fix:** either (a) pass `history.state` so it's preserved: `this.location.replaceState(url, '', history.state)` (Angular `Location`) or `history.replaceState(history.state, '', url)` (raw API), OR (b) use `this.router.navigate(...)` with `replaceUrl: true` and `skipLocationChange: false` if you actually need Router-aware navigation.

---

## `server-request-handling/router-navigate-re-evaluates-guards` — Important

**Pattern:** `this.router.navigate([...], {...})` is called with an accompanying comment claiming "no navigation" or "no guard re-evaluation". This is wrong — `router.navigate` ALWAYS triggers a navigation event and ALWAYS re-runs guards on the target route. Side effects in those guards (project context mutation, telemetry, fetches) will re-fire.

**Detect:** review comments adjacent to `router.navigate(...)` calls. Flag any that claim it doesn't navigate or doesn't trigger guards.

**Empirical citation:** PR #701 — "`syncProjectQueryParam` comment claims 'no new navigation' but `router.navigate(...)` actually re-evaluates guards. The comment is wrong about behavior."

**Failure message:** Comment misrepresents `router.navigate` — it does trigger guard re-evaluation.

**Fix:** use `Location.go()` or `Location.replaceState()` (with state preservation) for URL-only updates with no navigation event. Or remove the misleading comment and accept that guards will re-evaluate.

---

## `server-request-handling/raw-query-string-cast` — Important

**Pattern:** `req.query['name'] as string` cast instead of using the project's `getStringQueryParam(req, 'name')` helper. Bypasses input hardening; can yield an array when the client sends repeated keys (`?name=a&name=b`). Also loses runtime type safety.

**Detect:** grep for `req\.query\[['"][^'"]+['"]\]\s+as\s+string` in `apps/lfx-one/src/server/**`.

**Empirical citation:** PR #665 `apps/lfx-one/src/server/controllers/project.controller.ts:774` — "`documentType` is read via `req.query['type'] as string`, which bypasses the `getStringQueryParam` hardening used elsewhere (and can yield an array when the client sends repeated keys). Use `getStringQueryParam(req, 'type')`." Same PR was also flagged from the type-safety lens — the cast loses runtime safety and ignores the multi-value case.

**Failure message:** Raw query-param cast bypasses input hardening; can yield arrays from repeated keys; loses runtime safety.

**Fix:** use `getStringQueryParam(req, 'name')` from `apps/lfx-one/src/server/helpers/validation.helper.ts`. Project-wide convention. (Only `getStringQueryParam` exists today — for numeric/boolean params, read via `getStringQueryParam` and coerce/validate explicitly rather than casting `req.query[...]`.)

---

## `server-request-handling/untrimmed-query-value` — Important

**Pattern:** a query parameter is fetched via `getStringQueryParam(...)` (good) but not trimmed (bad). A whitespace-only value (`?name=%20`) is then treated as an active search/filter.

**Detect:** review every `getStringQueryParam` consumer — verify the value is either checked for emptiness after trim, or trimmed before use.

**Empirical citation:** PR #638 `apps/lfx-one/src/app/.../navigation.service.ts:202` — "`name` comes from a raw query param (via getStringQueryParam) and is not trimmed, so a whitespace-only value (e.g. `?name=%20`) will be treated as an active search."

**Failure message:** Query param value not trimmed; whitespace-only values treated as content.

**Fix:** trim the value: `const name = getStringQueryParam(req, 'name').trim()`. Then check for empty: `if (!name) return ...`. The pattern should be: trim first, validate non-empty, then use.

---

## `server-request-handling/missing-typeof-string-validation` — Important

**Pattern:** `validateRequiredParameter(req.params.id, 'id')` (or analogous validator) only checks presence, not type. If a route accepts repeated keys or the helper doesn't narrow type, downstream code may receive an array where it expects a string.

**Detect:** review `validateRequiredParameter` / `validateRequiredField` consumers. Verify the validator (in `apps/lfx-one/src/server/helpers/validation.helper.ts`) narrows to `string`, not just `any`.

**Empirical citation:** general pattern from CodeRabbit on multiple PRs; called out as a recurring gap in the validation-helper coverage.

**Failure message:** Required-parameter validator doesn't enforce string type — downstream type-safety gap.

**Fix:** either (a) extend the validator to enforce `typeof value === 'string'`, (b) read query params via `getStringQueryParam` which already narrows to `string | undefined`, or (c) add an explicit type guard at the controller layer before passing to the service.

---

## `server-request-handling/regex-too-loose-for-id-format` — Important

**Pattern:** a regex used to validate an identifier (account ID, project UID, slug, UUID) is too permissive — accepts lengths or character classes the upstream spec doesn't.

**Detect:** review identifier-validation regexes against the documented format (Salesforce account IDs are exactly 15 or 18 chars; UUIDs have a specific length and dash pattern).

**Empirical citation:** PR #706 `apps/lfx-one/src/server/controllers/org-lens-foundations.controller.ts:11` — Copilot — "`ACCOUNT_ID_PATTERN = /^001[A-Za-z0-9]{12,15}$/` allows lengths 15–18 (`001` + 12..15 chars), but Salesforce account IDs are exactly 15 or 18 characters."

**Failure message:** Regex accepts lengths the spec doesn't; will let through invalid IDs.

**Fix:** tighten the regex to match the actual spec. For Salesforce account IDs: `/^001[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/` (exactly 15, optionally extended to 18). For UUIDs, use a tested regex from a library or pin to the v4/v5 format you actually accept.

**See also:** `security/error-message-identity-leak` — when an authenticated endpoint's error response reveals which lookup failed, that's the security-leak variant of route auth-surface hygiene.
