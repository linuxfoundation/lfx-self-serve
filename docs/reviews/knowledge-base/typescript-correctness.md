# TypeScript correctness

TypeScript-soundness and async-lifecycle patterns CodeRabbit + Copilot flag — generics whose return types lie, non-null assertions on async results, deep imports that route around the barrel, timer leaks, and observable readiness races.

**Read when:** any `.ts` file changed. Cross-checked in Steps 3-4 of the learnings-review playbook (KB-match gate in Step 3, false-positive filter in Step 4); findings without a quotable pattern below are dropped.

---

## `typescript-correctness/generic-return-type-lies` — Critical

**Pattern:** generic utility function whose declared return type doesn't account for runtime `null` / `undefined` when the type parameter resolves to a primitive (string, number).

**Detect:** grep for `function <name><T>(...)` where the body can return `null` but the return type is declared as `T` (or any type that doesn't include null). Especially look at object-mapping utilities, ID helpers, deep-clone-like functions.

**Empirical citation:** PR #673 `packages/shared/src/utils/object.utils.ts` covered this class of bug while introducing `nullifyEmptyStrings<T>`: string leaves can become `null`, so the accepted shape is `NullifyEmptyStrings<T>` rather than a return type that still claims plain `T`.

**Failure message:** Generic claims `T` but returns null at runtime — the type lies.

**Fix:** narrow the type parameter with a constraint (`T extends object`), or widen the return type to `T | null` and require callers to handle the null case.

---

## `typescript-correctness/snake-vs-camel-case-shared-interface` — Important

**Pattern:** a shared interface in `packages/shared/src/interfaces/**` introduces a camelCase field whose name implies it's part of the upstream API payload (e.g., `votesFor`, `joinTier`, `myRole`) but the rest of the interface uses snake_case to match Go service responses. The risk is silent payload-shape drift: the camelCase field is on the response-shape interface but never arrives in the response, so consumers read `undefined` at runtime.

**Detect:** in any modified `packages/shared/src/interfaces/**.ts`, scan each interface body for case-style mixing. Treat as a finding only when the camelCase field LOOKS like an API-payload field. **Exception:** camelCase fields are allowed when JSDoc on the field explicitly documents them as UI-populated / view-only (the convention seen on `Committee.behavioralClass` + `Committee.classDisplay` — populated by the UI before binding, never sent by the server). Findings without a JSDoc UI-only marker on the camelCase field are flagged.

**Empirical citation:** PR #292 `packages/shared/src/interfaces/committee.interface.ts:111` — "`GroupEligibility` uses camelCase keys (`joinTier`, `chairTier`, `votingTier`) while most shared interfaces in this repo use snake_case to match API payloads." Same PR flagged `MyCommittee` at `:268` (`myRole`, `myMemberUid` mixed) and `CommitteeVote` at `:362` (`votesFor`/`votesAgainst` mixed with `created_by`).

**Failure message:** Shared interface mixes snake_case and camelCase without a UI-only JSDoc marker on the camelCase field — payload mapping ambiguity.

**Fix:** either rename the camelCase field to snake_case (if it's part of the API payload), or add a JSDoc marker on the field explaining it's UI-populated/view-only (matches the `behavioralClass` / `classDisplay` convention).

---

## `typescript-correctness/date-string-utc-day-shift` — Important

**Pattern:** a `YYYY-MM-DD` string from Snowflake / a server API is passed into `new Date(dateStr)`, which the JS spec parses as **UTC midnight**. When converted back via `.toLocaleDateString()` (or any `getDate()`-style read) in a non-UTC browser timezone, the displayed date can be off by one day.

**Detect:** find `new Date(<YYYY-MM-DD-string>)` in `.component.ts` / `.service.ts`. The fix is `new Date(year, month - 1, day)` (local midnight). Snowflake `DATE` and `TIMESTAMP_NTZ` columns are the typical input.

**Empirical citation:** PR #259 `apps/lfx-one/src/app/.../organization-involvement.component.ts:530` — "The date strings from `MembershipTierResponse` are `YYYY-MM-DD` and using `new Date()` causes UTC-based day shifts; implement a private `parseLocalDate(dateStr: string): Date` function (create `Date(year, month-1, day)` to construct local date)."

**Failure message:** `new Date('YYYY-MM-DD')` parses as UTC — date shifts by one day in non-UTC timezones.

**Fix:** parse explicitly with `new Date(year, month - 1, day)`. The shared package already exposes `parseLocalDateString(dateStr: string): Date` in `packages/shared/src/utils/date-time.utils.ts` (re-exported from `@lfx-one/shared/utils`) — use it at every API → UI boundary for date-only fields rather than rolling a per-component helper.

---

## `typescript-correctness/non-null-assertion-on-async-result` — Important

**Pattern:** non-null assertion (`!`) on a value that's the result of an async call, an array `.find(...)`, an HTTP response field, a route param, or a `signal()` value — any of which can be undefined at runtime.

**Detect:** grep for `\.(find|first|get)\s*\([^)]*\)!` or `(request[a-zA-Z]+)\([^)]*\)!` or `\.signal\(\)!`.

**Empirical citation:** PR #673 area — non-null on `find(...)` in object-utils chains; multiple other PRs flagged similar patterns.

**Failure message:** Non-null assertion on a potentially-undefined async result will throw at runtime if the result is missing.

**Fix:** handle the undefined case explicitly with an `if` guard or a default value (`?? defaultValue`). If the value is genuinely guaranteed non-null by an invariant, prefer a type-narrowing helper that asserts the invariant explicitly.

---

## `typescript-correctness/deep-shared-import` — Important

**Pattern:** importing from `@lfx-one/shared/<category>/<file>` instead of the barrel (`@lfx-one/shared/<category>`). Bypasses the curated public surface and risks importing internal helpers.

**Detect:** grep for `from '@lfx-one/shared/(interfaces|enums|constants|utils|validators)/[^'"]+'` (matches a path with a deeper segment after the category).

**Empirical citation:** 8 Copilot finds across multiple PRs (PRs sampled: #706, #678, others) — typically `from '@lfx-one/shared/interfaces/org-involvement.interface'` instead of `from '@lfx-one/shared/interfaces'`.

**Failure message:** Deep import bypasses the barrel; you may be reaching into the internal surface.

**Fix:** import from `@lfx-one/shared/interfaces` (or the appropriate sub-barrel). If the type isn't exported from the barrel, add it to `index.ts` rather than deep-importing.

---

## `typescript-correctness/setTimeout-no-cleanup` — Important

**Pattern:** `setTimeout(...)` in a component / dialog / service that does not clear the timer on destroy. The callback can fire after the host is gone, setting state on a destroyed component or executing logic against stale references.

**Detect:** grep for `setTimeout\(` in `*.component.ts` / `*.dialog.ts` / `*.directive.ts`. For each match, verify either (a) a corresponding `clearTimeout(timerId)` in `DestroyRef` / `ngOnDestroy`, or (b) the timer body is wrapped in a `takeUntilDestroyed()`-aware idiom.

**Empirical citation:** PR #689 `apps/lfx-one/src/app/.../ical-subscribe-dialog.component.ts:69` — "`setTimeout(() => this.copied.set(false), 2000)` can race if the user clicks Copy multiple times… It can also fire after the dialog is closed."

**Failure message:** `setTimeout` without cleanup can fire after the host is destroyed.

**Fix:** store the timer id and call `clearTimeout` in `DestroyRef.onDestroy(...)`, or replace with a signal-driven pattern (`timer(2000)` piped through `takeUntilDestroyed()`).

---

## `typescript-correctness/take1-against-async-readiness` — Important

**Pattern:** `take(1)` subscribed to an observable whose downstream short-circuits based on a readiness flag, when that flag is flipped by a separate async callback (e.g., `script.onload`). If the observable emits before the flag is true, the single value is dropped.

**Detect:** harder to grep mechanically — look for `take(1)` near subscriptions that consume a `ready` / `loaded` / `initialized` flag, and check whether that flag is set in an async callback that may resolve after the subscription fires.

**Empirical citation:** PR #709 `apps/lfx-one/src/app/.../meeting-join.component.ts:1171` — "Race condition: `trackPage()` short-circuits when `!this.analyticsReady`, and `analyticsReady` is only flipped to `true` inside `script.onload`. The deferred subscription here uses `take(1)`, so if the `project` signal resolves before the Plausible script finishes loading, the single enriched pageview will be silently dropped."

**Failure message:** `take(1)` can fire before the async readiness flag is set, silently dropping the subscription.

**Fix:** chain on the readiness signal with `filter(() => this.analyticsReady)` BEFORE `take(1)`, or combine the readiness observable into a `combineLatest` so emission waits for both.

---

## `typescript-correctness/timer-races-parent-fetch` — Important

**Pattern:** UI state transition driven by a `setTimeout` / interval races against a parent fetch that resolves on its own schedule. Final state depends on which finishes first.

**Detect:** review components that set state both inside a `setTimeout`/`setInterval` callback AND inside a `subscribe(...)` / `effect(...)` consuming a fetch result, where the two state-setters target the same field.

**Empirical citation:** general pattern flagged by Copilot in 9 PRs sampled (PRs #708, #709, #685, others). The clearest instance is PR #689's ical-subscribe-dialog where copy state races against dialog close.

**Failure message:** Timer races against async fetch — final state is non-deterministic.

**Fix:** drive the state from the fetch resolution, not from a parallel timer. If the timer is for UX feedback (e.g., "Copied!"), make sure it doesn't conflict with state managed by the fetch path.
