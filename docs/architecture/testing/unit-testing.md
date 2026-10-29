# Unit Testing Architecture

Unit tests run under [Vitest](https://vitest.dev/) in **two halves** (three spec sets — see the
table below), because the two halves of this app run in two different places. Server code under `src/server/` is plain Node; app code
under `src/app/` is Angular components and services that need templates compiled and a DOM to
render into. One runner configuration cannot serve both without giving each half an environment
it does not want, so there are two — wired to the same `yarn test`.

| Half    | Specs                     | Runner                                 | Environment | Config                                |
| ------- | ------------------------- | -------------------------------------- | ----------- | ------------------------------------- |
| Server  | `src/server/**/*.spec.ts` | `vitest run`                           | `node`      | `vitest.config.ts`                    |
| Scripts | `scripts/**/*.spec.mjs`   | `vitest run`                           | `node`      | `vitest.config.ts`                    |
| App     | `src/app/**/*.spec.ts`    | `ng test` (`@angular/build:unit-test`) | `jsdom`     | `angular.json` + `tsconfig.spec.json` |

Build-time scripts under `scripts/` ride the server runner: they are plain Node with no Angular or
DOM involvement, so they need the same environment `src/server/` does. They are listed separately
only because the path does not fall under `src/`.

`*.integration.spec.ts` files ride the same server runner and need no separate configuration. They
exist where a unit test structurally cannot see the behaviour: `gatewaze-proxy.controller.integration.spec.ts`
stands up a real `http.Server` and drives it with a real client socket, because the proxy's
oversized-upload rejection depends on socket and response-lifecycle semantics that a substituted
`Readable.from()` request simply does not have. Two defects shipped through a green unit suite
before the first such spec existed, on the proxy it replaced. Reach for one only when that is the case — a fake is cheaper everywhere else.

```bash
yarn test          # local: server then app; root Turbo also runs shared tests
yarn test:server   # server only — fast, no Angular compile
yarn test:app      # app only
```

The app workspace's `yarn test` runs the two halves **serially and unconditionally** and exits with the worse of the two statuses,
rather than chaining them with `&&`. A failing server spec must not stop the app half from
running: the point of splitting them is that each half reports independently, and a local run that
shows only the first failure sends you back for a second round to discover the second. At the
repo root, Turbo also runs the shared package's tests. CI uses independent jobs instead of this
local wrapper.

That lives in `scripts/run-tests.mjs` rather than in the `package.json` script, because
`yarn run` executes scripts in **Yarn's own portable shell, not `sh`**. That shell has no `$?`
and no `$(( ))` — it globs the `?` (`No matches found: "?"`) and then hands `process.exitCode`
a `NaN`, which fails the run for a reason that has nothing to do with the tests. A one-liner
that works when pasted into your terminal can still be broken under `yarn test`, so verify
changes to it **through `yarn test`**, not by running the pieces by hand.

Keep the two sets disjoint. A server spec picked up by the Angular builder pays for a browser
environment it never uses; an app spec picked up by `vitest.config.ts` fails on the missing
template compiler.

## CI execution

The **Quality Checks** workflow (`.github/workflows/quality-check.yml`) runs these jobs
independently, so a failure in one does not prevent the others from reporting:

- `static-checks`: fixture-data and company-address guards, formatting, lint, type checking, and
  E2E collection (no browser execution).
- `build`: the full `yarn build`.
- `unit-tests`: a server/shared matrix with `fail-fast: false`.
- `frontend-tests`: an app-spec matrix of shards 1–4, also with `fail-fast: false`. Each shard
  builds the shared package and runs `docs:build` before executing its app specs.

The final `quality-checks` job retains the check name **Code Quality Checks**. It runs with
`always()` and succeeds only when **every** required job succeeds; a skipped, cancelled, or
failed dependency cannot produce a green aggregate check.

### Incremental compiler caching

Angular's disk cache is enabled for both local development and CI through
`cli.cache.environment: "all"` in `apps/lfx-one/angular.json`. The production-build job
restores and saves **only** `apps/lfx-one/.angular/cache`. Its namespace includes the runner
OS/architecture, resolved Node version, dependency and build-configuration hash, and production
mode. Each successful source revision
gets a new cache key; the matching namespace can restore earlier incremental state. Angular still
validates the current source inputs.

Cache hits never skip a build or test command. Compiled application outputs, test results, and
Turbo task-success records are not persisted. In particular, restoring `.turbo` would need a
separate audit of environment hashing and validation semantics; compiler caching is not task caching.

Only successful main pushes, same-repository pull requests, and manual runs save caches. Fork
pull requests and merge-queue runs may restore accessible caches but do not save them. Compiler
caches can contain transformed source: keep deployment secrets and generated secret-bearing
configuration out of these jobs, and never consume PR-scoped caches from privileged deployment jobs.

The first production run populates the cache. Frontend shards do not transfer persistent caches:
benchmarking showed too little warm-compilation improvement to justify transfer/storage overhead.
Compare compilation and cache-transfer durations on later runs before extending cache persistence
to another job. From `apps/lfx-one`, `yarn ng cache info` reports
the effective setting and cache size; `yarn ng cache clean` clears this workspace's compiler state.

### Running an app shard locally

From `apps/lfx-one`, after building `@lfx-one/shared` and running `yarn docs:build`:

```bash
node scripts/run-app-test-shard.mjs 1/4         # execute the first of four shards
node scripts/run-app-test-shard.mjs 1/4 --list  # print the partition without executing tests
```

The caller supplies those build prerequisites; the shard runner does not perform them. It
discovers `src/app/**/*.spec.ts` and assigns files deterministically using weighted greedy
balancing: checked-in historical timing weights in `scripts/frontend-test-durations.json` supply the
weights, with a one-second default for other or new specs. Every shard validates that the whole
plan is exhaustive, disjoint, and nonempty. Invalid arguments fail, as does a change to the
Angular test configuration's include/exclude discovery contract that the runner does not support.

Execution still uses the Angular unit-test builder, with an explicit `--include` per assigned
file and `--watch=false`, not vanilla Vitest. The Angular builder does not support native
sharding. This CI partitioning leaves the local `yarn test` wrapper unchanged.

## The app-side builder

App specs go through the **`@angular/build:unit-test`** builder rather than a hand-rolled Vite +
Angular plugin setup. The builder is released by the Angular team alongside the framework and
carries the framework's compatibility contract — not a promise that the two resolve to the same
version (`@angular/build` is 20.3.42 here against a 20.3.34 framework; they are independent
packages) — and it reuses the application build (`buildTarget: lfx-one:build:development`) —
which is what makes `templateUrl`, `styleUrls`, and the `@lfx-one/shared/*` path aliases resolve
in specs exactly as they do in the app. Nothing about the module graph is re-described in a
second config file, so nothing about it can drift.

> The builder prints `NOTE: The "unit-test" builder is currently EXPERIMENTAL` on every run.
> That is expected. The API surface used here is small — `buildTarget`, `tsConfig`, `runner`,
> `providersFile`, `include` — and all of it is the documented shape.

### Why `apps/lfx-one` runs Vitest 4 under Angular 20

The builder does not bundle Vitest. It imports Vitest's Node API from the workspace, so the
version it runs against is a real compatibility constraint, not a formality.
`@angular/build@20.x` declares `"vitest": "^3.1.1"`, and support for Vitest 4 first appears in
`@angular/build@21.x`.

Both workspaces are on **`vitest: ^4.1.12`** anyway. Vitest 3 depends on `tinypool` 1.x, which
has no patched release for its critical advisories, so staying on Vitest 3 would have kept those
Dependabot alerts open until the Angular 21 upgrade. The move was validated by running the whole
app suite on Vitest 4.1.12 (about 13,300 specs), not a sample.

Expect yarn to print a peer warning that `vitest` 4.1.12 doesn't satisfy what `@angular/build`
requests. That warning is known and intended, so don't silence it with `packageExtensions` or
`peerDependencyRules`; it stays visible until the upgrade removes it. The remaining risk is a
later 20.x patch of `@angular/build` that relies on a Vitest 3 internal, such as the runner or
pool API. **If a `@angular/build` bump breaks `yarn test:app` with an unfamiliar runner error,
check this mismatch first.**

The Angular 21 upgrade, where the builder's peer range covers Vitest 4 and this section goes
away, is tracked in linuxfoundation/lfx-self-serve-ops#1199.

`browsers` is deliberately **omitted**, which selects jsdom on Node. That keeps unit tests free
of a browser download and a browser's startup cost; real-browser coverage is the E2E suite's job
(see [E2E Testing](./e2e-testing.md)), and duplicating it here would buy nothing.

## Zoneless change detection

This application is zoneless (`provideZonelessChangeDetection()` in `src/app/app.config.ts`) and
**zone.js is not a dependency**. A TestBed left on the default zone-based scheduler would either
fail to boot or — worse — pass under change-detection semantics the application does not use.

So the provider is installed once, for every spec, via `providersFile`:

```ts
// apps/lfx-one/src/test-providers.ts
export default [provideZonelessChangeDetection()];
```

A spec cannot forget it, and no spec needs to repeat it. Keep that file to providers that are
true of _every_ spec — anything one spec needs (an HTTP testing backend, a router harness, a fake
service) belongs in that spec, where a reader can see it.

The practical consequence for writing specs: **`await fixture.whenStable()`, not
`fixture.detectChanges()`**. Setting an input and awaiting stability is what lets the zoneless
scheduler flush, and it is also the assertion that it flushed at all.

```ts
fixture.componentRef.setInput('selectedFilter', 'kubecon');
await fixture.whenStable();

expect(pill('kubecon').getAttribute('aria-pressed')).toBe('true');
```

### Fast tests without changing scheduling semantics

Use virtual time for deliberate debounce and retry delays, rather than shortening production
timeouts or waiting for them in real time. In RxJS debounce tests, selectively fake `Date`,
`setInterval`, and `clearInterval`; leave Angular's timeout/animation-frame scheduling real.
Flush the Angular effect that schedules the debounce **before** advancing time, then render and
await stability. Preserve intermediate assertions that intentionally run before the debounce fires.

Retry-budget tests must advance both timers and `Date`, because elapsed-time guards read the
clock. Attach the promise's rejection assertion before asynchronous timer advancement so a
rejection cannot become unhandled. Keep boundary cases and read-count assertions intact. Destroy
fixtures or reset TestBed before restoring real timers, and clear pending virtual timers in teardown.

For state-only component cases, an explicit empty-template fixture can retain the real component,
forms, services, and signals without repeatedly mounting unrelated children. Keep real templates
for DOM, child-binding, lazy-panel, and handoff assertions. Similarly, expensive module initialization
can be shared within a fixed-configuration suite while stdout spies, mutable state, environment
restoration, and filesystem scratch directories remain isolated per test.

## Writing an app spec

```ts
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FilterPillsComponent } from './filter-pills.component';

describe('FilterPillsComponent', () => {
  let fixture: ComponentFixture<FilterPillsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FilterPillsComponent] }).compileComponents();
    fixture = TestBed.createComponent(FilterPillsComponent);
    fixture.componentRef.setInput('options', options);
    await fixture.whenStable();
  });
});
```

Conventions, all of which the existing specs follow:

- **Import vitest symbols explicitly** (`import { describe, expect, it } from 'vitest'`) rather
  than relying on globals — this matches the server specs and keeps a spec readable in isolation.
- **Components are standalone**, so they go in `imports`, not `declarations`.
- **Set signal inputs with `fixture.componentRef.setInput(...)`.** Assigning to the instance
  property does not work for `input()` signals.
- **Query by `data-testid`**, the same contract the E2E specs rely on
  (see [E2E Testing](./e2e-testing.md#data-testid-architecture)). A spec that queries by CSS class
  breaks on a Tailwind change that changed nothing a user can perceive.
- **License header on every spec file** — enforced by `license-header-check.yml`.

`src/app/**/*.spec.ts` is type-checked against `tsconfig.spec.json`, and a type error fails the
run before any test executes. There is no separate `check-types` step for the app to catch it
later.

The shared package's specs (`packages/shared/src/**/*.spec.ts`) get the same treatment through a
separate route: the Vitest runs are transpile-only (esbuild), so `packages/shared/tsconfig.spec.json`
carries the type-check pass and is what the package's `yarn check-types` runs (see
[Package Architecture](../shared/package-architecture.md#build-process)). Fixtures typed against
shared interfaces stay in sync at compile time rather than silently desyncing on a required-field
add; the fixture-builder convention is codified in
[shared-and-sql-checklist § 5a](../../reviews/shared-and-sql-checklist.md#5a-shared-spec-fixtures-use-typed-builders-not-as-cast-literals-should-fix).

Specs are also **linted like any other source file**. `**/*.spec.ts` used to sit in
`eslint.config.js`'s ignore list, which meant every spec in the repo was exempt from the rules
the code it tests must follow — a test file is the last place that should be, since a fake that
quietly breaks a rule is how a fake stops modelling the real thing. The exemption is gone.

## Verifying a test actually binds

A test that passes proves nothing on its own — a fake that short-circuits, or an assertion that
never reaches the code under test, passes just as green as a real one. **Before trusting a new
test, mutate the code it covers and confirm it fails, with a diagnostic that names the real
defect.** If the mutation stays green, the test is decorative and should be rewritten or deleted.

Watch for the failure mode where the _mutation itself_ silently doesn't apply — an edit whose
pattern matched nothing looks exactly like a non-binding test. Confirm the mutation landed
(`git diff`) before concluding anything from a green run.

The two specs added with this harness were each verified this way:

| Mutation                                           | Expected failure                        |
| -------------------------------------------------- | --------------------------------------- |
| `test-providers.ts` → `export default []`          | all 5 component tests (no scheduler)    |
| `[attr.aria-pressed]` → `false`                    | 2 tests (selection state)               |
| `[attr.aria-label]` drops the `fullLabel` fallback | 1 test (accessible name)                |
| `handleFilterChange(option.id)` → `option.label`   | 1 test (emits id, not label)            |
| `isTransientHttpError` drops `status === 0`        | 1 test (network drop no longer retried) |
| `retry({ count })` → `count - 1`                   | 1 test (attempt count)                  |
| retry delay always retries, ignoring the predicate | 1 test (401 must not be retried)        |

## What to unit test, and what not to

Unit tests are for logic that can be exercised without a running app: pure functions and policies
(`shared/utils/`), service transformation logic, and component input → DOM/output behaviour.

Anything that needs a real route, a real session, or a real upstream response belongs in the E2E
suite instead. A unit test that mocks its way to a full page is slower to write, weaker evidence,
and breaks on refactors that changed no behaviour.
