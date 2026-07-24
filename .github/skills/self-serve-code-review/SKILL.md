---
name: self-serve-code-review
description: >
  How to judge the implementation of an lfx-self-serve (LFX One) pull request:
  the general quality dimensions (correctness, error handling, tests,
  performance, readability, code truthfulness) and how to hold the diff to the
  repo's documented standards for the Angular SSR app and the Express BFF. Use
  on every PR that changes code, however small; this is the reviewer's
  line-level lens. Security has its own skill (self-serve-security-review).
---

<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Self Serve Code Review

The `/copilot-code-reviewer` skill owns the reviewer's scope and signal
discipline; this skill owns the line-level method. Read enough surrounding code
to judge each hunk in its real context — for a server change, the middleware →
controller → service path it sits on; for an Angular change, the component, its
template, and the signals and services it consumes.

A diff alone is not enough. For each non-trivial hunk, read the **whole changed
function**, not just the diff lines, and `Grep` for **callers and sibling
implementations** of the same pattern to confirm the change matches how the repo
already does it — convention drift is a finding even when the code "works". For
a proxy change, read one layer past the diff: the upstream contract the call
must mirror, not just the local shape.

## The house standards

The repo defines its own standards; hold the diff to them, and name the
documented source in any standards finding. Read the parts relevant to the diff
before judging, every run, because the standards belong to the repo and move with
it. They live in:

- **`CLAUDE.md`** — the source-of-truth order, the domain language (PCC, ED,
  Admin Mode, personas, L2), commit/PR conventions, and the global "what NOT to
  do" list.
- **`.claude/rules/`** — `component-organization.md` (Angular signal structure,
  `model()` vs `WritableSignal`, the DELETE→CREATE rule for full component
  replacements), `logging-patterns.md` (the Pino `LoggerService`, operation
  lifecycle, controller-vs-service logging responsibility), `styling.md`
  (Tailwind, `lfxColors`, `flex + flex-col + gap-*` not `space-y-*`),
  `ssr-safety.md`, and `development-rules.md` (the shared package, M2M-vs-user
  tokens, upstream-contract verification, code-quality rules).
- **The four `docs/reviews/` checklists** — `frontend-checklist.md` (PrimeNG
  wrapper strategy: prefer the LFX wrapper over a raw `<p-*>` in feature
  templates unless a documented exception applies, no function calls in
  render-time expressions — interpolation and property bindings should read
  signals or pipes, not call methods that re-run every change detection; event
  bindings like `(click)="save()"` are the normal exception — component
  organization),
  `backend-checklist.md` (the three-file service/controller/route pattern,
  controller-vs-service separation, custom error classes, user bearer tokens vs
  M2M, upstream API validation, protected files), `shared-and-sql-checklist.md`,
  and `docs-checklist.md`.

Enforcement runs in both directions: code that violates a documented standard is
a finding, and a documented standard the code has visibly outgrown is a finding
against the docs. If a documented convention is wrong for this specific change,
say so explicitly and explain the trade, rather than silently waiving or silently
enforcing it.

## Quality dimensions

Run these on the changed code, scaled to the size of the change:

- **Correctness**: does it do what it claims? Watch unhandled Observable errors
  and leaked subscriptions, signals read where a `computed` was meant, effects
  with hidden write loops, `async`/`await` that drops a rejected promise,
  boundary conditions, and proxy calls whose request/response shape does not
  match the upstream contract.
- **Error handling**: server errors follow the repo's error model — controllers
  pass errors to the handler (`next(error)`), services throw the custom error
  classes (`BaseApiError` and friends), and nothing is silently swallowed or
  leaked to the client. On the client, HTTP failures surface through the
  established error path, not a swallowed `catchError(() => of(null))` that hides
  a real failure as empty state.
- **Tests**: new or changed behavior has tests that assert real behavior, not
  that a mock was called; new components get `data-testid` hooks and the dual
  E2E coverage the repo expects where appropriate. Missing tests on
  contract-bearing or security-sensitive code is always worth flagging.
- **Performance**: for a caller-facing list, page the cursor through to the
  caller rather than draining every upstream page into one response
  (`/query/resources` carries a cursor — use it); a deliberate all-pages fetch
  for a complete-set operation (via the established all-pages helper) is a
  supported pattern, not a defect. No work in a template
  expression (it re-runs every change detection), no waterfall of sequential
  awaits that should be concurrent, no payload loaded server-side and shipped
  whole into the client bundle via TransferState.
- **Readability and structure**: the change reads like the surrounding code;
  names say what a thing is or does; no nested ternaries; duplicated logic that
  wants a shared helper is a finding when it traps the next editor.
- **Code truthfulness**: comments, docs, and the PR description match what the
  code actually does; a stale comment, a dead branch, a `data-testid` that lies
  about the element, or a TODO dressed as done is a finding.

## Self Serve specifics worth a second look

- **Shared package boundary.** New interfaces, reusable constants, and enums
  belong in `@lfx-one/shared`, not as module-level consts or local `interface`
  declarations inside `apps/lfx-one/`. A type duplicated instead of imported is a
  finding.
- **PrimeNG independence.** Components are consumed through the LFX wrapper
  components, and types reference the PrimeNG component interface. A raw `<p-*>`
  where an LFX wrapper exists, or a hand-rolled type where the wrapped interface
  exists, breaks the UI-library-independence the repo deliberately keeps —
  PrimeNG controls with a sanctioned direct use (documented exceptions) are
  fine.
- **SSR safety.** Browser-only APIs (`window`, `document`, `localStorage`,
  `navigator`, the observers) must sit behind a browser-only boundary — an
  `isPlatformBrowser` guard, or an Angular render callback that does not execute
  during SSR; either is acceptable. Browser-only libraries must be lazy-imported
  inside that boundary
  — a static top-level import crashes the SSR bundle even when the call site is
  guarded. The failure only shows under `yarn build`, not `yarn start`. (Security
  consequences of SSR — secret leakage into the client — are the security skill's
  job.)
- **Critical constants.** A changed constant is a behavior change even when the
  code "works": timeouts, retry/backoff values, page-size caps, cache TTLs,
  rate-limit tiers, feature-flag defaults, env-var keys, and upstream URLs or
  subjects. When the diff moves one, ask whether the change is stated and
  intentional and what its blast radius is; an unexplained constant change is a
  finding.
- **Protected files.** Changes to `server.ts`, the singleton services, build/format
  config, or `CLAUDE.md` carry repo-owner weight and warrant closer scrutiny —
  raise one when its risk or intent is unclear, not merely because a sensitive
  file was touched (a clean, well-understood edit to one is not itself a
  finding).

## Judgment calls

- **Point at the working pattern.** When the diff violates a pattern, cite the
  working example in the surrounding code rather than describing an abstract
  ideal.
- **Do not propose rewrites of a sound approach**, and do not suggest change for
  its own sake; working, readable code needs no improvement.
- **Know your limits.** Distinguish "this is wrong" from "this might be a problem
  depending on context", and say which one you mean. When a judgment depends on
  something you cannot see (an upstream microservice's contract, a deployment
  value, a runtime feature flag), note the dependency rather than asserting a
  defect you cannot confirm.
