# Observability and logging

Patterns where renaming routes or adding new health endpoints causes drift in OpenTelemetry's ignore-list and the rate limiter's whitelist, and patterns where logged metrics are misleading or log levels are mis-chosen. Low volume but recurring — every time routes change these files need cross-check, and bad metrics drive bad decisions silently.

**Read when:** `apps/lfx-one/otel.mjs`, `apps/lfx-one/src/server/middleware/rate-limit.ts`, any new route registration in `server.ts`, or any file using `logger.info` / `logger.warning` / `logger.debug`. Cross-checked in Steps 3-4 of the learnings-review playbook (KB-match gate in Step 3, false-positive filter in Step 4).

---

## `observability-and-logging/otel-ignore-list-drift` — Important

**Pattern:** when health/probe routes are renamed (e.g., `/health` → `/livez`, `/readyz`), the `ignoreIncomingRequestHook` in `apps/lfx-one/otel.mjs` must be updated or the new probe paths generate spans on every k8s probe (typically every 5 seconds = ~17,000 spans/day per pod, all useless).

**Detect:** when the diff renames or adds health/probe routes in `server.ts`, cross-check `apps/lfx-one/otel.mjs` `ignoreIncomingRequestHook` for matching path patterns. Flag if the OTEL list doesn't include the new paths.

**Empirical citation:** PR #639 — "OTel `ignoreIncomingRequestHook` still references old `/health` path. Renaming routes without updating OTEL produces probe-traffic spans."

**Failure message:** OTEL ignore-list still references old health-route paths — probe traffic now generates spans.

**Fix:** update `apps/lfx-one/otel.mjs` `ignoreIncomingRequestHook` to match the current health/probe endpoint paths. Use a regex/glob covering both old and new names if you're in a transition window.

---

## `observability-and-logging/health-endpoint-inside-rate-limiter` — Important

**Pattern:** liveness / readiness / health endpoints (`/livez`, `/readyz`, `/healthz`) are mounted INSIDE the `/api` rate-limit middleware. Kubernetes probes fire on a fixed cadence; under load (or with multiple pods), probe traffic can exhaust the rate-limit budget and cause probes to fail, triggering pod restarts.

**Detect:** check that health/probe routes are mounted OUTSIDE the `/api` (or any rate-limited) prefix. In `server.ts`, the probes should be `app.use('/livez', ...)` etc., NOT under `app.use('/api', rateLimiter, ...)`.

**Empirical citation:** PR #639 — "Rate limiting placement — `/livez` and `/readyz` should remain outside the `/api` rate limiter."

**Failure message:** Health endpoint inside rate limiter — k8s probes can exhaust the budget; risk of probe-induced restarts.

**Fix:** mount probes outside `/api`, OR add them to the rate limiter's whitelist (skip rate-limit for probe IPs / paths). See `docs/architecture/backend/rate-limiting.md` for the recommended structure.

---

## `observability-and-logging/count-variable-mismatch` — Important

**Pattern:** a `logger.info({ count: ... })` (or similar metric field) is logged with the wrong variable — typically `Set.size` of a related-but-different set, or array length of the un-deduped collection rather than the deduped one.

**Detect:** review every `logger.info` / `logger.warning` call that includes a count/total/size field. Verify the variable being logged is the one the message describes.

**Empirical citation:** PR #680 — "`responded_count` logs the wrong set." The operation name said `responded_count` but the actual logged value was `Set.size` of the wrong set, producing a misleading metric.

**Failure message:** Logged count uses the wrong variable — metric is misleading.

**Fix:** use the correct collection's size for the metric. Cross-check the operation name (`responded_count`, `attendee_count`, etc.) against the value source.

---

## `observability-and-logging/info-for-high-frequency-fetch` — Important

**Pattern:** `logger.info` used in a code path that runs frequently (per-page-load, per-signal-change, per-keystroke), producing log noise. `logger.info` is for significant business operations; high-frequency ops should be `logger.debug`.

**Detect:** look for `logger.info` calls in code paths that aren't gated by a once-per-session condition — typical culprits are signal effects, route resolvers, and data-fetch services.

**Empirical citation:** general pattern from CodeRabbit comments across multiple PRs; specifically called out in PR #700 / #708 areas.

**Failure message:** INFO level used for a high-frequency operation — produces log noise that drowns signal.

**Fix:** downgrade to `logger.debug`. Per `.claude/rules/logging-patterns.md`: INFO is for significant business operations; DEBUG is for step-by-step tracing.

---

## `observability-and-logging/err-field-vs-error-message` — Important

**Pattern:** error logged as `{ error: error.message }` instead of `{ err: error }`. The `error.message` form loses the stack trace and any custom error properties; the `err` field with the Error object preserves both.

**Detect:** grep for `\{\s*error\s*:\s*\w+\.message\s*\}` or `\{\s*error\s*:\s*err\s*\}` in `apps/lfx-one/src/server/**`.

**Empirical citation:** general pattern from `.claude/rules/logging-patterns.md` plus several CodeRabbit comments echoing it.

**Failure message:** Error logged as `error.message` — loses stack trace and custom properties.

**Fix:** log as `{ err: error }` (the Pino-recognised field). The serializer will preserve the stack and any non-standard properties.

---

## `observability-and-logging/missing-route-in-tracer-config` — Nit

**Pattern:** a new high-traffic Express route is added without checking whether its span attributes are being captured correctly by `server-tracer.ts`. Custom span attributes (route name, user ID) might not propagate.

**Detect:** when new routes are mounted with non-trivial traffic, verify `server-tracer.ts` configuration would tag spans appropriately.

**Empirical citation:** general infrastructure pattern; flagged in PR #635 area ("tag APM spans with matched Express route").

**Failure message:** New route may not propagate matched-route span attribute.

**Fix:** ensure the route is registered with Express in a way that `req.route.path` is populated (use Router, not raw `app.use` with regex), and `server-tracer.ts` reads from `req.route.path` for span naming.
