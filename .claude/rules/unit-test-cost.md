---
description: Unit-test cost — pure function first, then an empty-template subclass for state, and a full render only for DOM behaviour
paths:
  - '**/*.spec.ts'
  - '**/*.spec-helper.ts'
---

# Unit-test cost

Write the cheapest test that proves the behaviour. A full render of a large component costs hundreds of milliseconds per test, and a pure function costs well under one (#5980).

1. **Pure function first.** Rule logic (validation, payloads, draft mapping) is a plain function in `packages/shared/src/utils/` or beside the component, tested as table rows.
2. **Empty-template subclass for state.** Form validity, computed signals, payloads and draft state are asserted on a test-only subclass of the real component with `template: ''`. Mark the test with the helper's option, for example `STATE_ONLY` in `implementation-tab.spec-helper.ts`.
3. **Full render only for DOM.** Text, aria, focus, child bindings and anything reading `nativeElement` or `debugElement`.

Never `TestBed.overrideTemplate` the component under test, because it recompiles on every test. Keep every "is not rendered" assertion on the full render, because with no DOM it is trivially true.

The recipe and its traps: [`docs/architecture/testing/unit-testing.md`](../../docs/architecture/testing/unit-testing.md) § "Choose the cheapest test that proves the behaviour".
