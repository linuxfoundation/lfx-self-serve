# 010 — Meeting details redesign (V2)

**Epic**: [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765) ·
**Meetings V2 epic**: [#1451](https://github.com/linuxfoundation/lfx-self-serve/issues/1451)

This directory is the in-repo spec home for the meeting details V2 redesign. It is created
minimally by E0-05 (#1769) because the design-token deviation table has to land somewhere
durable. **E0-01 (#1766) owns the full spec** — `spec.md`, `plan.md`, `data-model.md`,
`contracts/` and `tasks.md` are written there, following the shape of
[`specs/009-cla-manager-request`](../009-cla-manager-request).

## What the redesign is

V2 ships **side by side** with V1. `MEETING_V2_ENABLED_FLAG` decides which tree a viewer
renders; the existing `meeting-join` component is not deleted, rewritten or refactored in
place. The flag is UI-only and gates no endpoint, the code default is `false`, LaunchDarkly
targeting is the switch, an unready flag provider renders V1, and anonymous visitors always
get V1 during rollout.

## Contents

| File                                                         | Owner         | What it holds                                                        |
| ------------------------------------------------------------ | ------------- | -------------------------------------------------------------------- |
| [`design-token-deviations.md`](./design-token-deviations.md) | E0-05 (#1769) | Every V2 token, its `lfxColors` equivalent, and the convergence path |
| `spec.md`, `plan.md`, `tasks.md`, …                          | E0-01 (#1766) | The feature spec proper                                              |

## Related

- Gate: [#2873](https://github.com/linuxfoundation/lfx-self-serve/issues/2873) ·
  Scaffold: [#2874](https://github.com/linuxfoundation/lfx-self-serve/issues/2874) ·
  Rollout/retirement doc: [#2875](https://github.com/linuxfoundation/lfx-self-serve/issues/2875)
- View-model resolvers: [#2876](https://github.com/linuxfoundation/lfx-self-serve/issues/2876)
- Testid contract: [#1768](https://github.com/linuxfoundation/lfx-self-serve/issues/1768)
