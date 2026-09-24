# Meeting details V2 — scaffold and naming convention

Plan ID **V2-02** · issue [#2874](https://github.com/linuxfoundation/lfx-self-serve/issues/2874) · epic [#1765](https://github.com/linuxfoundation/lfx-self-serve/issues/1765)

Where V1 and V2 code live, what each is called, what they share, and what "done" means for deleting
V1. Every Phase 1 issue builds inside the layout below.

## Naming convention

This follows the composer's precedent (`components/agenda-template-selector-v1/`): the outgoing tree
takes a `-v1` suffix and the new one takes the plain name.

| Tree | Directory                                | Component                     | Selector                         |
| ---- | ---------------------------------------- | ----------------------------- | -------------------------------- |
| V1   | `modules/meetings/meeting-join-v1/`      | `MeetingJoinComponent`        | `lfx-meeting-join`               |
| V2   | `modules/meetings/meeting-details/`      | `MeetingDetailsComponent`     | `lfx-meeting-details`            |
| Gate | `modules/meetings/meeting-details-gate/` | `MeetingDetailsGateComponent` | route target for `/meetings/:id` |

**Only V1's directory is renamed. Its files, class and selector are not.** The composer renamed
everything, but this epic has a stricter rule: `meeting-join.component.ts` stays byte-identical
(`spec.md` § The two rules). A directory move keeps all three files 100% identical, which git
records as a pure rename, so `git log --follow` still reaches V1's history. Renaming the class or
selector would edit V1 for no behavioural gain.

V2 takes the plain name `meeting-details` rather than `meeting-join` because V2 is a details page
that also joins, not a join page. The URL, `/meetings/:id`, does not change.

## Where V2 code lives

```text
modules/meetings/
├── meeting-details-gate/        # the flag gate (V2-01, #2873) — the only file that knows both trees
├── meeting-details/             # V2 page — the E1-01 shell replaces the scaffold body
│   └── components/              # V2-only components (created by the first Phase 1 PR that needs one)
├── meeting-join-v1/             # V1 page — untouched, deleted when V2 ships
└── components/                  # meetings-module components; V1 already uses several
```

- **V2-only components** go in `meeting-details/components/<name>/`. Their names drop any `v2`
  suffix; the directory already says which tree they belong to.
- **Shared app wrappers** (`app/shared/components/`: `button`, `card`, `tag`, `avatar`, `select`,
  `table`, `empty-state` and the rest listed in `spec.md` § Reuse before you create) are used by both
  trees. V1 already imports `button`, `card`, `tag`, `expandable-text`, `header` and
  `impersonation-banner`. The scaffold uses `empty-state`.
- **Meetings-module components** (`modules/meetings/components/`) that V1 imports, such as
  `meeting-organizer`, `meeting-registrants-display`, `rsvp-button-group`, `guest-form`,
  `meeting-summary-modal` and `transcript-modal`, are available to V2 as they are. A V2 need they
  cannot express is met by an **additive** input or variant whose default keeps V1's rendering
  unchanged. V1's specs must stay green, which is the "zero diff to V1 behaviour" test. Fork only
  when an additive change is impossible, and say in the PR what was tried.
- **Services and data.** V2 injects the same services V1 does (`MeetingService`, `UserService`,
  `ProjectContextService`, `PlausibleService`) and seeds from the same `MeetingJoinPageState`
  TransferState contract. It derives page state through `@lfx-one/shared/utils/meeting-view-model.utils`
  (E0-02), not by copying V1's inline `computed` signals. V1's orchestration lives inside its
  component and cannot be extracted without editing V1, so V2 composes the services and resolvers
  itself. It does not duplicate a fetch path.
- **Testids** follow `testid-contract.md` (E0-04). The scaffold's `meeting-details-scaffold` testid
  is temporary and retires with the scaffold body.

## Loading

The gate imports V2 statically but renders it inside `@defer (on immediate)`, so V2 is its own lazy
chunk (`meeting-details-component`). The ~100% of visitors on V1, including every anonymous
visitor, never download it. The gate's doc comment records the trade-off this creates for targeted
viewers and the follow-up that removes it (#2920).

## Definition of done for deleting V1

This feeds the rollout / retirement doc (V2-03, #2875). V1 can be deleted when all of these hold:

1. `MEETING_V2_ENABLED_FLAG` has served V2 to **100%** of signed-in traffic with no rollback for the
   agreed soak period. That requires #2920 first: SSR must make the same flag decision, or a
   percentage rollout ships the post-hydration swap to everyone.
2. Anonymous visitors are moved to V2 as a deliberate step. The gate hard-codes them to V1 today
   (R05), so this is a code change, not a targeting change.
3. Every state V1 renders has a V2 equivalent, checked against the state matrix #1766 defers,
   including the terminal-error and not-found paths V1's lookup currently owns.
4. E5-04's V2 E2E suite (content + robust) is green and binding (R07).

Then, in one PR:

- delete `meeting-join-v1/` and its spec,
- collapse `meeting-details-gate/` so the route loads `MeetingDetailsComponent` directly,
- drop the gate's read of `MEETING_V2_ENABLED_FLAG`. Leave the flag itself alone: the composer
  and other meetings surfaces read it too, and it retires only when the last of them has,
- update `docs/architecture/frontend/public-meeting-join.md`, which still describes V1.

Nothing in `meeting-details/` should need to change in that PR. If it does, V2 has taken a
dependency on V1 that this layout exists to prevent.
