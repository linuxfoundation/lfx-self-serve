# 011 — Meeting details redesign (V2)

**Epic**: [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765) ·
**Meetings V2 epic**: [#1451](https://github.com/linuxfoundation/lfx-self-serve/issues/1451)

This directory is the in-repo spec home for the meeting details V2 redesign. Start with
[`spec.md`](spec.md), which holds the governing rules and the work order.

## What the redesign is

V2 ships **side by side** with V1. `MEETING_V2_ENABLED_FLAG` decides which tree a viewer
renders; the existing `meeting-join` component is not deleted, rewritten or refactored in
place. The flag is UI-only and gates no endpoint, the code default is `false`, LaunchDarkly
targeting is the switch, a flag provider that is not ready yet renders V1, and anonymous visitors always
get V1 during rollout.

## Contents

| File                                                       | Plan ID | What it holds                                                        |
| ---------------------------------------------------------- | ------- | -------------------------------------------------------------------- |
| [`spec.md`](spec.md)                                       | E0-01   | Governing rules, rollout invariants, traps, work order               |
| [`state-matrix.md`](state-matrix.md)                       | E0-01   | Every state combination, what V1 renders, what V2 renders            |
| [`requirements.md`](requirements.md)                       | E0-01   | `FR-###` / `SC-###` and the plan-ID traceability table               |
| [`data-model.md`](data-model.md)                           | E0-01   | Payload field → axis mapping, view-scoped state, counts, identifiers |
| [`testid-contract.md`](testid-contract.md)                 | E0-04   | Every `data-testid` and `data-*` state attribute V2 renders          |
| [`design-token-deviations.md`](design-token-deviations.md) | E0-05   | Every V2 token, its `lfxColors` equivalent, and the convergence path |
| [`v2-scaffold.md`](v2-scaffold.md)                         | V2-02   | V1/V2 naming, where V2 code lives, V1-deletion definition of done    |
| [`rollout.md`](rollout.md)                                 | V2-03   | Branch, release, flag stages, rollback, and V1 / flag retirement     |
| [`checklists/requirements.md`](checklists/requirements.md) | E0-01   | Spec quality checklist                                               |

All work lands in the integration branch `feat/meeting-details-v2`; nothing reaches `main` until the
release PR #3249 merges. See `rollout.md`.

## Related

- Gate: [#2873](https://github.com/linuxfoundation/lfx-self-serve/issues/2873) ·
  Scaffold: [#2874](https://github.com/linuxfoundation/lfx-self-serve/issues/2874) ·
  Rollout/retirement doc: [#2875](https://github.com/linuxfoundation/lfx-self-serve/issues/2875) ·
  V1 retirement: [#3266](https://github.com/linuxfoundation/lfx-self-serve/issues/3266)
- View-model resolvers: [#2876](https://github.com/linuxfoundation/lfx-self-serve/issues/2876)
- Testid contract: [#1768](https://github.com/linuxfoundation/lfx-self-serve/issues/1768)
