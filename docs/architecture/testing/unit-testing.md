# Unit Testing Architecture

Unit tests run under [Vitest](https://vitest.dev/) in **two halves**, because the two halves of
this app run in two different places. Server code under `src/server/` is plain Node; app code
under `src/app/` is Angular components and services that need templates compiled and a DOM to
render into. One runner configuration cannot serve both without giving each half an environment
it does not want, so there are two — wired to the same `yarn test`.

| Half   | Specs                     | Runner                                 | Environment | Config                                |
| ------ | ------------------------- | -------------------------------------- | ----------- | ------------------------------------- |
| Server | `src/server/**/*.spec.ts` | `vitest run`                           | `node`      | `vitest.config.ts`                    |
| App    | `src/app/**/*.spec.ts`    | `ng test` (`@angular/build:unit-test`) | `jsdom`     | `angular.json` + `tsconfig.spec.json` |

```bash
yarn test          # both halves (this is what CI runs)
yarn test:server   # server only — fast, no Angular compile
yarn test:app      # app only
```

`yarn test` runs the two halves **unconditionally** and exits with the worse of the two statuses,
rather than chaining them with `&&`. A failing server spec must not stop the app half from
running: the point of splitting them is that each half reports independently, and a CI log that
shows only the first failure sends you back for a second round to discover the second.

That lives in `scripts/run-tests.mjs` rather than in the `package.json` script, because
`yarn run` executes scripts in **Yarn's own portable shell, not `sh`**. That shell has no `$?`
and no `$(( ))` — it globs the `?` (`No matches found: "?"`) and then hands `process.exitCode`
a `NaN`, which fails the run for a reason that has nothing to do with the tests. A one-liner
that works when pasted into your terminal can still be broken under `yarn test`, so verify
changes to it **through `yarn test`**, not by running the pieces by hand.

Keep the two sets disjoint. A server spec picked up by the Angular builder pays for a browser
environment it never uses; an app spec picked up by `vitest.config.ts` fails on the missing
template compiler.

## The app-side builder

App specs go through the **`@angular/build:unit-test`** builder rather than a hand-rolled Vite +
Angular plugin setup. The builder is released by the Angular team alongside the framework and
carries the framework's compatibility contract — not a promise that the two resolve to the same
version (`@angular/build` is 20.3.13 here against a 20.3.15 framework; they are independent
packages) — and it reuses the application build (`buildTarget: lfx-one:build:development`) —
which is what makes `templateUrl`, `styleUrls`, and the `@lfx-one/shared/*` path aliases resolve
in specs exactly as they do in the app. Nothing about the module graph is re-described in a
second config file, so nothing about it can drift.

> The builder prints `NOTE: The "unit-test" builder is currently EXPERIMENTAL` on every run.
> That is expected. The API surface used here is small — `buildTarget`, `tsConfig`, `runner`,
> `providersFile`, `include` — and all of it is the documented shape.

### Why `apps/lfx-one` is on Vitest 3

The builder does not bundle Vitest — it imports Vitest's Node API from the workspace — so the
version it runs against is a real compatibility constraint, not a formality.
`@angular/build@20.3.13` declares `"vitest": "^3.1.1"`. Support for Vitest 4 first appears in
`@angular/build@21.x`, which is an Angular major upgrade and not something a test harness gets to
drag in. So `apps/lfx-one` pins **`vitest: ^3.2.4`**, satisfying the range the builder actually
declares.

The peer dependency is marked optional, so nothing fails the install if you ignore it — which is
exactly why this is written down. A green sample run on Vitest 4 is not evidence of
compatibility; it is evidence that the parts those two specs touch happen to line up.

`packages/shared` stays on Vitest 4 deliberately. It runs its own suite with plain `vitest run`,
has no Angular builder in the path, and therefore no reason to be held back by one. The two
workspaces resolve independently. **When this app moves to Angular 21, raise this pin back to
`^4` in the same change** — leaving it behind would pin the whole app to a runner two majors
old for no remaining reason.

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
