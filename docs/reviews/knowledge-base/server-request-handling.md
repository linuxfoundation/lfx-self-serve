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

## `server-request-handling/new-api-route-no-auth-middleware` — Critical

**Pattern:** a new `/api/<X>` route prefix is mounted in `server.ts` (via `app.use('/api/<X>', router)`) but no `authMiddleware` is applied — either at the prefix mount point or inside the router itself. Anyone hitting the endpoint without a session can access it.

**Detect:** in `server.ts`, find each `app.use('/api/<prefix>', router)` line. Verify that either (a) `authMiddleware` is applied immediately before the route mount (e.g., `app.use('/api/<prefix>', authMiddleware, router)`), or (b) the router itself applies `authMiddleware` at the top via `router.use(authMiddleware)`. If neither, fail — the route is unauthenticated.

**Empirical citation:** PR #706 `apps/lfx-one/src/server/controllers/org-lens-foundations.controller.ts:63` — Copilot — "`getFoundationsAndProjects` performs no AuthN/AuthZ check before querying for an arbitrary `accountId` — the route is mounted in `server.ts` without any visible auth middleware on this prefix in the diff."

**Failure message:** New `/api/*` route is mounted without auth middleware — unauthenticated access possible.

**Fix:** apply `authMiddleware` to the prefix in `server.ts` (e.g., `app.use('/api/org-lens', authMiddleware, orgLensRouter)`), OR if intentional, mount under `/public/api/` and add a comment explaining the public exposure.

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

**Fix:** use `getStringQueryParam(req, 'name')` from `apps/lfx-one/src/server/helpers/validation.helper.ts`. Project-wide convention. Same applies to `getNumberQueryParam`, `getBooleanQueryParam`, etc.

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

**Fix:** either (a) extend the validator to enforce `typeof value === 'string'`, (b) use `getStringQueryParam` / `getStringRouteParam` which already narrow, or (c) add an explicit type guard at the controller layer before passing to the service.

---

## `server-request-handling/regex-too-loose-for-id-format` — Important

**Pattern:** a regex used to validate an identifier (account ID, project UID, slug, UUID) is too permissive — accepts lengths or character classes the upstream spec doesn't.

**Detect:** review identifier-validation regexes against the documented format (Salesforce account IDs are exactly 15 or 18 chars; UUIDs have a specific length and dash pattern).

**Empirical citation:** PR #706 `apps/lfx-one/src/server/controllers/org-lens-foundations.controller.ts:11` — Copilot — "`ACCOUNT_ID_PATTERN = /^001[A-Za-z0-9]{12,15}$/` allows lengths 15–18 (`001` + 12..15 chars), but Salesforce account IDs are exactly 15 or 18 characters."

**Failure message:** Regex accepts lengths the spec doesn't; will let through invalid IDs.

**Fix:** tighten the regex to match the actual spec. For Salesforce account IDs: `/^001[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/` (exactly 15, optionally extended to 18). For UUIDs, use a tested regex from a library or pin to the v4/v5 format you actually accept.

**See also:** `security/error-message-identity-leak` — when an authenticated endpoint's error response reveals which lookup failed, that's the security-leak variant of route auth-surface hygiene.
