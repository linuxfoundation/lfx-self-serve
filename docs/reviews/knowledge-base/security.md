# Security

Trust-boundary patterns across the stack — credential disclosure, identity enumeration, public-meeting visibility, untrusted URL binding, sanitizer bypass, and cookie-as-identity. Sampled from CodeRabbit / GitHub Copilot PR comments 2026-01-15 → 2026-05-15.

**Read when:** always — secrets, sanitization, auth-state leakage, untrusted cookies and untrusted URLs can hit any change. Cross-checked in Steps 3-4 of the learnings-review playbook (KB-match gate in Step 3, false-positive filter in Step 4); findings without a quotable pattern below are dropped.

---

## `security/secrets-in-diff` — Critical

**Pattern:** hardcoded tokens, API keys, `Bearer ey...`, `sk_live_`, `sk_test_`, AWS keys, or any other credential committed to the diff.

**Detect:** grep the diff for key assignments `(api[_-]?key|secret|token|password)\s*[:=]\s*['"]` and value-shaped credentials `(Bearer\s+ey[A-Za-z0-9._-]+|AKIA[0-9A-Z]{16}|sk_(live|test)_[A-Za-z0-9]+)` (case-insensitive). Also flag any new `.env` / `*.local.json` / `*.pem` file that doesn't have a corresponding `.gitignore` entry.

**Empirical citation:** not observed in our sampled PRs (which is good). Preventive — CodeRabbit's Gitleaks scan catches this for every PR; we mirror the check pre-PR.

**Failure message:** Hardcoded secret detected — never commit credentials.

**Fix:** move to environment variable, fetch via 1Password (`op://...`), or revert the change. If the secret leaked already, rotate it before merging.

---

## `security/public-meeting-visibility-filter` — Critical

**Pattern:** a public endpoint serving meeting/event data must filter by `visibility: 'public'` before pagination — otherwise the page response can contain private items.

**Detect:** for any new endpoint under `/public/api/*` returning meeting/event data, verify that the upstream query (`MicroserviceProxyService.proxyRequest` call) includes a visibility filter, and that filtering happens BEFORE `page_size` / `page_token` paging.

**Empirical citation:** PR #697 `apps/lfx-one/src/server/controllers/project.controller.ts` (`/public/api/projects/:id/calendar.ics` endpoint) — public ICS calendar endpoint didn't filter by visibility before paginating; private meetings could appear in anonymous ICS feeds.

**Failure message:** Public endpoint paginates over data that may contain private items.

**Fix:** apply the visibility filter in the upstream query (not in post-processing), so paging is bounded to public-only data.

---

## `security/href-from-untrusted-source` — Critical

**Pattern:** an element's `[href]` is bound to a value sourced from user input or an external API response without validation. Risk of `javascript:` URL injection.

**Detect:** find `[href]="..."` bindings whose source is a service / API response / user-provided field. Verify the value is either (a) constructed from known-safe template literals, or (b) validated against an allowlist of schemes (`http`, `https`).

**Empirical citation:** general security best-practice; flagged occasionally in past PR review comments in PRs touching external-link rendering.

**Failure message:** `[href]` bound to untrusted value — `javascript:` URL injection risk.

**Fix:** validate the URL scheme before binding. Reject (or substitute) any URL whose scheme isn't `http` or `https`. Don't rely solely on the sanitizer — Angular's default protection is for runtime sanitization, but explicit validation is safer.

---

## `security/cookie-as-identity-no-validation` — Critical

**Pattern:** a cookie value is parsed as JSON or destructured as an identity/account/session object, and the resulting data is used to drive authorization, queries, or UI state — without validating the shape or verifying a signature.

**Detect:** grep for `req\.cookies\[` followed within ~5 lines by `JSON\.parse(` or destructuring of an expected shape. Verify there's either (a) a zod/joi/yup schema validation, OR (b) signed-cookie verification (HMAC / express-session signature check) before the value is trusted.

**Empirical citation:** PR #667 — "`selectedAccount` initialized from cookie value without validation. Cookie payload treated as trusted." A malicious user could craft a cookie that injects an arbitrary `accountId` into downstream queries.

**Failure message:** Cookie payload used as identity / trusted data without shape or signature validation. Tampering exposure.

**Fix:** (a) define a zod schema for the expected cookie payload and parse-or-reject; (b) if cookie is supposed to be signed, verify the signature before parsing; (c) treat the value as untrusted input and validate against a known list of acceptable account IDs from the authenticated session.

---

## `security/innerHTML-unsanitized-user-content` — Critical

**Pattern:** `[innerHTML]="userField"` binding where `userField` is user-provided content (vote description, meeting description, comment body). Angular's default HTML sanitizer (`SecurityContext.HTML`, active on `[innerHTML]`) removes `<script>` elements and the common dangerous attributes by default — so naive payloads are blocked. The risk surface this entry captures is two-step: (a) the value is later wrapped in `DomSanitizer.bypassSecurityTrustHtml(...)`, which disables sanitization entirely; or (b) user-controlled content is accepted into a code path where bypass is later added without re-reviewing every reachable input.

**Detect:** grep for `\[innerHTML\]=` in `.component.html`. For each match, trace the source to a service / API field. Verify either (a) a `DomSanitizer.sanitize(SecurityContext.HTML, ...)` pipe applied (like the `linkify` pipe pattern), or (b) the field is from a trusted-server source the team has explicitly approved.

**Empirical citation:** PR #242 `apps/lfx-one/src/app/.../vote-results-drawer/vote-results-drawer.component.html:108` (also lines 120, 343) — "Using `[innerHTML]` with unsanitized user-controlled content creates a Cross-Site Scripting (XSS) vulnerability. Vote descriptions are user-provided input and should be sanitized before rendering as HTML."

**Failure message:** `[innerHTML]` bound to user-provided content without sanitization — XSS exposure.

**Fix:** prefer text interpolation `{{ voteData.description }}` if HTML isn't needed. If HTML is required, apply a sanitizer pipe (like the codebase's `linkify` pipe) that wraps `DomSanitizer.sanitize(SecurityContext.HTML, ...)`.

---

## `security/window-open-no-noopener` — Critical

**Pattern:** `window.open(externalUrl, '_blank')` called without `'noopener,noreferrer'` features. The opened page can access `window.opener` and navigate the originating tab (reverse-tabnabbing) — credential phishing risk.

**Detect:** grep for `window\.open\(` in `.component.ts` / `.service.ts`. For each match, verify the third argument is the string `'noopener,noreferrer'` (or a superset). Also flag `<a target="_blank">` without `rel="noopener noreferrer"`.

**Empirical citation:** PR #269 `apps/lfx-one/src/app/modules/meetings/components/meeting-card/meeting-card.component.ts:277` (also `dashboard-meeting-card.component.ts:96`, `meeting-join.component.ts:196`) — "`window.open(res.download_url, '_blank')` can expose the app via reverse-tabnabbing because the opened page can access `window.opener`."

**Failure message:** `window.open(..., '_blank')` without `noopener,noreferrer` — reverse-tabnabbing risk.

**Fix:** `window.open(url, '_blank', 'noopener,noreferrer')` (and/or set `newWindow.opener = null` after open). For anchors, add `rel="noopener noreferrer"`.

---

## `security/http-in-production-environment` — Critical

**Pattern:** `apps/lfx-one/src/environments/environment.prod.ts` (or any production-flagged env file) contains a `http://` URL for any service the browser will connect to. Mixed-content blocked or insecure traffic at runtime.

**Detect:** grep `^.*=\s*['"]http://` in any file under `apps/lfx-one/src/environments/` whose name contains `prod` or `staging`. Dev / local files are exempt.

**Empirical citation:** PR #233 `apps/lfx-one/src/environments/environment.prod.ts:9` — "The PCC URL in production uses HTTP instead of HTTPS, which is a security concern. All other environments (dev, staging, local) use HTTPS. Production should also use HTTPS for secure communication."

**Failure message:** `http://` URL in production environment file — must be HTTPS.

**Fix:** change to `https://` and verify the upstream serves HTTPS. If the upstream is HTTP-only, surface that as a blocker — don't ship insecure URLs to production.

---

## `security/ssrf-external-fetch-incomplete-guards` — Critical

**Pattern:** a server-side fetch of an external URL (user-supplied or derived from user input) without the full SSRF guard set: hostname IP-blocklist, DNS resolution + post-resolution IP check (defeats DNS rebinding), `Content-Type` allowlist on the response, request size limit, rate limit on the endpoint.

**Detect:** for any new server file that calls `fetch(externalUrl)` / `axios.get(externalUrl)`, verify (a) hostname is checked against a private/loopback/link-local IP blocklist, (b) the resolved IP (post-DNS) is rechecked against the same blocklist before connecting, (c) the response Content-Type is validated, (d) the route is rate-limited.

**Empirical citation:** PR #252 `apps/lfx-one/src/server/services/url-metadata.service.ts:109` — "The fetchUrlTitle flow only calls isBlockedHostname but does not resolve the hostname to an IP before fetching, leaving a DNS rebinding SSRF gap." Same PR also flagged missing rate limiting on the route (`url-metadata.route.ts:12`) and missing Content-Type validation (`url-metadata.service.ts:115`).

**Failure message:** Server-side external fetch missing full SSRF guard set (DNS-rebinding / Content-Type / rate-limit).

**Fix:** resolve `parsed.hostname` to IPs before fetching, validate every resolved IP against blocked CIDR ranges (loopback, RFC1918, link-local, ULA `fd00::/8`), reject non-text Content-Types, and rate-limit the route. Centralise the helper so all external-fetch sites use it.

---

## `security/pii-in-logs-and-identifiers` — Important

**Pattern:** a user email / username / other PII is passed into `logger.startOperation` / `logger.info` / `logger.debug` as a `user_id` or similar identifier, or persisted into a metadata object that the logger then serialises. The structured-log destination (Datadog / Snowflake) retains the PII indefinitely.

**Detect:** grep `logger\.(startOperation|info|debug|warning)\(` for arguments containing `email`, `user_email`, `userEmail`, or destructured email fields. Also check `redact.paths` in `server-logger.ts` — verify any nested token / email paths are included. Finally, grep `LoggerService.sanitize` usage near interfaces with `user_email` fields.

**Empirical citation:** PR #280 `apps/lfx-one/src/server/controllers/lens.controller.ts:14` — "The controller is forwarding raw email addresses as `user_id`. Use a stable opaque identifier instead (e.g., OIDC `sub`) or compute a salted hash before passing to `logger.startOperation` and downstream services." Also PR #285 `apps/lfx-one/src/server/server-logger.ts:81` — "`redact.paths` only covers top-level keys and misses nested `token_response.access_token`." Also PR #230 `packages/shared/src/interfaces/poll.interface.ts:245` — "`IndividualVote.user_email` contains PII and must be sanitized before logging; call `LoggerService.sanitize(metadata)` before logger calls that pass `userEmail` or objects containing `IndividualVote`."

**Failure message:** PII (email / username) flowing into logs as identifier or unsanitized metadata.

**Fix:** prefer OIDC `sub` (or a salted hash) as the user_id field. For metadata containing PII, call `LoggerService.sanitize(metadata)` before passing to the logger. Extend `redact.paths` in `server-logger.ts` to cover nested token / email fields.

---

## `security/error-message-identity-leak` — Important

**Pattern:** error messages that disclose whether a username/email/identifier matched (timing or content-based account enumeration). The denial response differs based on which lookup failed. Applies to both unauthenticated lookups and authenticated endpoints whose error payloads vary by which lookup failed (user vs. registrant vs. permission check).

**Detect:** grep for error responses that branch on `if (user)` / `if (registrant)` / `if (member)` with different `res.status(...).json({ message: ... })` per branch. Also review controllers handling lookup failures — check that the error payload is identical whether the user wasn't found, the registrant wasn't found, or the permission check failed.

**Empirical citation:** PR #636 `apps/lfx-one/src/server/services/meeting.service.ts` — "restricted-meeting denial message exposes whether the email or username matched. The denial should be opaque about which lookup failed." Same PR also surfaced the route-side variant ("error-message identity leakage — restricted-meeting denial message exposes whether the email or username matched") — both kept under this pattern.

**Failure message:** Differentiated error messages allow account enumeration.

**Fix:** return a single generic "not authorized" response regardless of which lookup failed. Log the specifics server-side at DEBUG; don't leak to the client.

---

## `security/non-http-scheme-stripped` — Important

**Pattern:** a non-http URL scheme (`webcal:`, `tel:`, `mailto:`, `sms:`) bound to `[href]` (or interpolated into a template-bound `href`) is silently stripped by Angular's `DomSanitizer` to `unsafe:...`. The link looks present in source but doesn't navigate at runtime.

**Detect:** grep for `\[href\]="[^"]*(webcal|tel|mailto|sms):` or interpolations like `${webcalUrl}` bound to `[href]`. Also flag any component code constructing such URLs without explicitly bypassing the sanitizer.

**Empirical citation:** PR #697 `apps/lfx-one/src/app/.../ical-subscribe-dialog.component.ts` — "`webcal://` blocked by Angular sanitizer."

**Failure message:** Non-http URL scheme in `[href]` — Angular sanitizer strips at runtime; link doesn't navigate.

**Fix:** use `DomSanitizer.bypassSecurityTrustUrl(url)` to mark the URL as safe, then bind via `[href]` or `[attr.href]` — never `[innerHTML]` (that's for HTML content and pairs with `bypassSecurityTrustHtml`, not `bypassSecurityTrustUrl`). Be explicit about the security trade-off; only do this for known-safe URLs you constructed, never on user-supplied input.

---

## `security/missing-encodeURIComponent-on-slug` — Important

**Pattern:** a template-literal URL or query-param construction interpolates a user-input or variable value (slug, search term, ID) into the URL without `encodeURIComponent`. Special characters break the URL or enable injection.

**Detect:** grep for template literals containing `https?://` or `/api/` with `${...}` interpolations. Verify the interpolated values are wrapped in `encodeURIComponent(...)`.

**Empirical citation:** general pattern from CodeRabbit + Copilot in multiple PRs; not always specific to one but a recurring Nit-to-SHOULD-FIX.

**Failure message:** User input in URL slug/query without encoding — breaks on special characters; potential injection.

**Fix:** wrap the interpolated value: `` `/api/users/${encodeURIComponent(name)}` ``. For query-string assembly, use `URLSearchParams`.

---

## `security/prototype-pollution-via-dynamic-key-assignment` — Important

**Pattern:** a recursive walker reconstructs plain objects by iterating `Object.entries(input)` (or `Object.keys`) and writing each key back via `result[key] = ...`. If the input is JSON-derived (`JSON.parse` of an upstream payload, request body, or user-controlled content), it may carry an own-property literally named `__proto__`, `constructor`, or `prototype`. The dynamic-key assignment then invokes the corresponding setter on `result`'s prototype chain rather than creating an own-property, polluting `Object.prototype` for the whole process.

**Detect:** function returning a fresh `{}` (or `Record<string, unknown>`) whose keys come from `Object.entries(input)` / `Object.keys(input)` and are assigned via bracket notation in a recursion. A plain-object guard on the _input_ (`Object.getPrototypeOf(value) === Object.prototype`) does NOT close the hole — it limits which inputs are walked, but the dangerous keys still get copied through.

**Empirical citation:** PR #673 `packages/shared/src/utils/object.utils.ts` — Copilot: "When rebuilding plain objects, `result` is initialized as `{}` and then populated via `result[key] = ...`. If an input object contains a `__proto__` key, this assignment can mutate `result`'s prototype (prototype pollution). Consider creating the result with a null prototype (e.g. `Object.create(null)` or `Object.create(proto)` when `proto === null`) and/or safely defining dangerous keys (`__proto__`, `constructor`, `prototype`) so they become data properties instead of triggering prototype setters."

**Failure message:** Recursive plain-object walker assigns keys via `result[key] = ...`; an input own-property named `__proto__`, `constructor`, or `prototype` would pollute `Object.prototype`.

**Fix:** prefer `Object.defineProperty(result, key, { value, writable: true, enumerable: true, configurable: true })` — defines an own-property regardless of the key name and bypasses the dangerous setters. This is what PR #673 shipped, with the in-code rationale: _"Use defineProperty to bypass setters (e.g. `__proto__`) and prevent prototype pollution when keys come from untrusted sources like `JSON.parse`."_ Alternatives: skip the three dangerous keys explicitly (`if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;`), or use `Object.create(null)` for a prototype-less result (limits downstream consumers that rely on `Object.prototype` methods).

---

## `security/cookie-payload-bigger-than-headers` — Nit

**Pattern:** cookie payload contains a large object (>1KB) that's pushed on every request. Network overhead; also can hit reverse-proxy header size limits.

**Detect:** when setting cookies, check that the value is small (typically just an ID, not a full object). Anything > 1KB is suspect.

**Empirical citation:** general best-practice; observed in CodeRabbit suggestions on PR #667 area.

**Failure message:** Cookie payload is large; consider storing in session and only the ID in the cookie.

**Fix:** persist the full object in session storage (Redis / express-session); put only the session key in the cookie.
