# Frontend state and timing

Patterns CodeRabbit + Copilot reliably flag at the signals ↔ observables interface — double-emissions from `toObservable + startWith`, missing `distinctUntilChanged` after primitive projections, identity-equal-object re-emissions triggering redundant downstream work, and guards / persona checks racing against asynchronously-populated context services.

**Read when:** any `.component.ts` / `.service.ts` under `apps/lfx-one/src/app/` changed. Cross-checked in Steps 3-4 of the learnings-review playbook (KB-match gate in Step 3, false-positive filter in Step 4); findings without a quotable pattern below are dropped.

---

## `frontend-state-and-timing/sse-parser-overwrites-multiline-data` — Critical

**Pattern:** an SSE event-block parser that handles multi-line `data:` frames by overwriting the `data` variable on each `data:` line (instead of concatenating with `\n`). Per the SSE spec, multiple `data:` lines in one event block should join with newlines. Large JSON payloads split across `data:` lines silently lose all but the last fragment — runtime parse errors or truncated content.

**Detect:** in any custom SSE parser (`parseUpstreamSSEBlock`, `parseSSE`, or the inline parser inside `LensService` / `SseService`), find the line-handling logic for `data:` lines. Verify it concatenates (`data = (data ? data + '\n' : '') + raw`) rather than reassigns (`data = raw`). Also verify the `TextDecoder` is `decode()`-flushed after the read loop (multibyte boundaries) and the SSE split delimiter is `\n\n` (event-block separator).

**Empirical citation:** PR #280 `apps/lfx-one/src/server/services/lens.service.ts:160` — "The `parseUpstreamSSEBlock` method overwrites the `data` variable when multiple `data:` lines appear in a single SSE event block. According to the SSE specification, if an event contains multiple `data:` lines, their values should be concatenated with a newline character between them." Same PR flagged the frontend mirror at `sse.service.ts:114`, and the missing `decoder.decode()` flush at `lens.service.ts:109`.

**Failure message:** SSE parser drops multi-line `data:` fragments — data corruption on large payloads.

**Fix:** concatenate `data:` lines with `\n`. Flush `TextDecoder` after the read loop with a final `decoder.decode()` so trailing multibyte bytes aren't lost. Split event blocks on `\n\n`, not raw newlines.

---

## `frontend-state-and-timing/sse-disconnect-listener-on-req-not-res` — Important

**Pattern:** in an Express SSE handler, the client-disconnect listener is registered on `req.on('close', ...)` instead of `res.on('close', ...)`. `req.on('close')` fires after the request body is read — for a long-lived response, mid-stream disconnects aren't detected, and upstream fetches / AbortControllers keep running.

**Detect:** in any controller that streams SSE (response with `text/event-stream` Content-Type), find the disconnect listener. Verify it's `res.on('close', ...)`. Cross-check that an `AbortController` is aborted when the listener fires.

**Empirical citation:** PR #280 `apps/lfx-one/src/server/controllers/lens.controller.ts:41` — "The SSE disconnect handling currently listens on `req.on('close')` which fires after the request body is read; change the listener to `res.on('close')` so mid-response disconnects are detected."

**Failure message:** SSE disconnect listener on `req.on('close')` — mid-stream disconnects undetected.

**Fix:** switch to `res.on('close', ...)`. Inside the handler, set `clientDisconnected = true` and call `abortController.abort()` so the upstream fetch terminates.

---

## `frontend-state-and-timing/toObservable-startWith-double-emit` — Important

**Pattern:** `toObservable(signal).pipe(startWith(initialValue))` — `toObservable` already synchronously emits the signal's current value on subscribe. Adding `startWith` prepends a second synchronous emission, doubling downstream firing (e.g., `combineLatest` fires twice on mount, refetches data twice).

**Detect:** grep for `toObservable\([^)]+\)\s*\.pipe\([^)]*startWith\(` in `*.component.ts` / `*.service.ts`.

**Empirical citation:** PR #706 `apps/lfx-one/src/app/.../org-overview-foundations-and-projects.component.ts:101` — "`retryTrigger$` is `toObservable(this.retryTrigger)`, which already emits the signal's current value (0) on subscribe. Adding `.pipe(startWith(0))` prepends a second synchronous 0, so `combineLatest` will fire twice on mount…"

**Failure message:** `toObservable + startWith` double-emits — causes duplicate downstream firing.

**Fix:** drop the `startWith`. `toObservable` already emits the initial value. If you need an initial DIFFERENT value, refactor to emit it from the signal itself.

---

## `frontend-state-and-timing/missing-distinctUntilChanged-after-id-projection` — Important

**Pattern:** `toObservable(obj-signal).pipe(map(x => x.id))` — when the wrapping object can be re-emitted with the same `id` but a new object identity (e.g., context service enriches and re-sets the signal), downstream re-fires unnecessarily, triggering redundant fetches.

**Detect:** grep for `\.pipe\([^)]*map\([^)]*=>\s*[^.)]+\.(id|uid|key|accountId|projectId|meetingId)[^)]*\)\)` — a `map` projecting a stable primitive ID from an object. Verify a `distinctUntilChanged()` follows.

**Empirical citation:** PR #708 `apps/lfx-one/src/app/.../org-overview-foundations-and-projects.component.ts:46` — "`selectedAccountId$` will emit again when `AccountContextService` enriches the selected account (same `accountId`, new object), which can trigger an unnecessary full refetch."

**Failure message:** Missing `distinctUntilChanged` after primitive projection — same value triggers downstream re-fire.

**Fix:** append `.pipe(map(x => x.id), distinctUntilChanged())` so downstream only fires when the projected value actually changes.

---

## `frontend-state-and-timing/effect-resets-on-identity-equal-input` — Important

**Pattern:** `effect()` reads a signal whose value is identity-different but semantically-equal (e.g., the same account enriched with extra metadata). The effect runs again and resets state that was set inside the effect — clobbering downstream state.

**Detect:** when reviewing `effect()` callbacks that READ a signal AND SET another signal, check whether the input signal can be re-emitted with new object identity but the same semantic content.

**Empirical citation:** general pattern from Copilot, related to PR #706 / #708 timing finds.

**Failure message:** `effect()` reads identity-different input and resets downstream state — same content re-fires.

**Fix:** use `computed()` instead of `effect()` if you're just deriving state. If you genuinely need an effect, project the input to a primitive ID and gate on `equal` (the `effect()` config option) or `distinctUntilChanged` on a toObservable bridge.

---

## `frontend-state-and-timing/async-context-not-ready-when-consumed` — Important

**Pattern:** a guard, persona check, feature gate, or TLF / ED enforcement reads a context value (`activeProject`, `selectedAccount`, persona signal) that's populated by a separate asynchronous service initialization. If the guard fires before the async population resolves, the check sees `undefined` / a stale value and either fails open, redirects incorrectly, or hangs the navigation.

**Detect:** in guards (`apps/lfx-one/src/app/shared/guards/**`), persona helpers, and feature-flag checks, find every read of a context-service signal / getter. Verify either (a) the route resolver / guard awaits a readiness signal before reading, OR (b) the context is populated synchronously at app bootstrap (not from an HTTP call). Async-population sites typically live in services that subscribe to a fetch and `.set()` the signal inside the callback — those are the risk surface.

**Empirical citation:** H-02 KB coverage audit (2026-05-19) — PRs #279, #345: "Persona/TLF enforcement depends on asynchronously populated project context."

**Failure message:** Guard / persona check reads context populated asynchronously — races against the initial fetch.

**Fix:** expose a `ready: Signal<boolean>` (or readiness `Observable<true>`) from the context service that flips after the initial fetch resolves. Gate the guard on readiness — e.g., `toObservable(ctx.ready).pipe(filter(Boolean), take(1), switchMap(() => actualCheck()))`. Or move population into a route resolver so guards run after the data is in place.
