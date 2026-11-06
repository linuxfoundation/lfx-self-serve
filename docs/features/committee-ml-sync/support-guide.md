# Support Guide: Group ↔ Mailing List Sync

**Feature:** Automatic and manual membership sync between a Group and its linked Groups.io mailing list(s).
**Audience:** Support engineers, customer success, internal escalation handlers.
**Status:** Draft against in-review branches. Every button label, dialog header, and flag name below was verified against the open PRs linked from epic #4022 (see [Implementation Status](#implementation-status)). Re-verify against `main` once those PRs merge, before relying on this doc to resolve a live ticket.

## What Is This Feature?

A Group (Self Serve's term for what the backend calls a "committee" — see [Terminology](#terminology)) can be linked to one or more Groups.io mailing lists. Once linked, a manager can turn on automatic membership sync in one direction:

| Mode                 | `sync_mode` wire value | Behavior                                                                                                                     |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Group → Mailing List | `auto_c_to_ml`         | When someone joins/leaves the Group, they're automatically subscribed/unsubscribed on the linked mailing list.               |
| Mailing List → Group | `auto_ml_to_c`         | When someone joins/leaves the mailing list, they're automatically added/removed as a Group member.                           |
| Manual               | `manual`               | No automatic sync. Sync Now is not available for `manual` lists yet (see [Limitations](#limitations-and-known-constraints)). |

Only one linked list per Group can run an auto direction at a time — see [Limitations](#limitations-and-known-constraints).

### Terminology

Self Serve always displays "committee" as **Group** / **Groups** in the UI (`COMMITTEE_LABEL` in `packages/shared/src/constants/committees.constants.ts`). The underlying API, database records, and this doc's field names still say "committee" — when a ticket or log references `committee_id` or `sync_mode`, that's the same entity the user sees as "Group."

## Where to Find the Feature

**1. Mailing List view page → Sync Settings card**
Open a mailing list (`apps/lfx-one/.../mailing-list-view`). If the list is linked to a Group, a **Sync Settings** card shows an "Automatic membership sync" toggle (`sync-settings-toggle`). Turning it on reveals a direction picker (`sync-settings-direction`) and a **Sync Now** button (`sync-now-button`) — this button is currently a stub (shows a "Coming soon" toast); the real working Sync Now entry point is item 4 below. If another linked list for the same Group already has an active direction, a green "Active Group sync" notice (`active-committee-sync-notice`) appears and blocks setting a second one.

**2. Group detail page → Settings tab → Auto Sync button**
On a Group's **Settings** tab, next to the mailing list list, an **Auto Sync** button (`settings-auto-sync-btn`) opens a drawer titled "Auto Sync" (subtitled with the Group's name). The drawer hosts one Sync Settings card (same component as above) per mailing list associated with the Group, so a manager can review/change every linked list's sync mode from one place.

**3. Group detail page → Settings tab → Associated Mailing Lists dialog**
The **+ Add List** button next to the mailing lists section opens a dialog titled **"Associated Mailing Lists"** (not "Configure Mailing Lists" — the button and the dialog header differ from PCC's naming). This dialog only links/unlinks mailing lists to the Group; it does **not** set sync direction or committee filters — those aren't available here yet (see [Limitations](#limitations-and-known-constraints)). To remove a linked list, use the per-row "Remove mailing list" action on the Settings tab itself, outside this dialog.

**4. Sync Now preview/apply dialog**
The working entry point is the per-list **Sync Now** button (`settings-sync-now-ml-<uid>`) on the Group's **Settings** tab (added in PR #4911), not the Sync Settings card's own button in item 1 (currently a stub). Shows three tabs: **Adds**, **Removes**, **Conflicts** (mismatched-email rows that are informational only — nothing in Conflicts is auto-applied). Each row in Adds/Removes has a checkbox so the manager can skip specific entries. Applying can take minutes; the dialog shows an elapsed-seconds counter, not a progress bar, while ITX computes and applies the diff.

## Common User Scenarios

1. **"I turned on sync but nothing happened."**
   Auto sync is event-driven — it only fires when the _next_ join/leave event occurs, and that event triggers a full roster diff (not just the one member who joined/left), so it does end up reconciling existing gaps once something happens. If genuinely nothing has happened yet (no joins/leaves since the toggle was flipped), tell the user **Sync Now** can reconcile immediately instead of waiting — but only if the list already has an auto direction configured; Sync Now currently rejects `manual`/unset `sync_mode` (see [Limitations](#limitations-and-known-constraints)).

2. **"The direction picker won't let me pick a direction."**
   Check for the "Active Group sync" notice — only one mailing list per Group may run an auto direction. The manager must turn off sync on the other list first.

3. **"People are being removed from the mailing list unexpectedly."**
   First check whether this was a **manual Sync Now apply** or truly automatic. A manual Sync Now always lets the manager review and approve each removal before applying — it is not restricted by the list's visibility, for either sync direction. If the removal happened with no one touching Sync Now, it came from the _automatic_ Group→Mailing List (`auto_c_to_ml`) path, which only auto-removes on a **private** mailing list — a public list only ever auto-adds, never auto-removes. (The reverse direction, `auto_ml_to_c`, has no automatic removal in this service at all — ITX propagates Groups.io unsubscribe events to the Group directly, independent of this restriction.)
   Also check whether the removed person is still subscribed to another mailing list linked to the same Group — even one in `manual` mode. Automatic removal skips anyone still subscribed to a sibling list on the same Group, so they don't get dropped from one list while still belonging to another tied to the same committee. This is expected behavior, not a bug. If the removal still looks wrong after ruling out both of these, escalate to the `lfx-v2-mailing-list-service` / ITX maintainers rather than reading the sync code directly — don't point the user or support staff at backend source files.

4. **"Sync toggle / Auto Sync button isn't showing up at all."**
   - Frontend: `MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG` (LaunchDarkly key: `mailing-list-committee-sync-enabled`) — controls whether the UI shows the Sync Settings section at all. Check this flag first for a visibility complaint.
   - Backend: `AUTO_SYNC_ENABLED` env var on `lfx-v2-mailing-list-service` — the kill switch for issue #4878. This does **not** control UI visibility at all; it only gates whether backend `TriggerAutoSync` actually executes for the V2 Group→Mailing List webhook path. Manual **Sync Now** and ITX's reverse (Mailing List→Group) execution are unaffected by this flag. Fails **open** (enabled) unless explicitly set to `false`.
     If the UI is visible but auto sync silently isn't firing for Group→Mailing List, check this backend flag — but it is never the explanation for a missing toggle/button.

5. **"Sync Now says Conflicts but didn't fix anything."**
   This is expected — the Conflicts tab lists mismatched-email rows for the manager's awareness; it is never auto-applied. There's no action needed unless the user wants to manually reconcile those accounts.

6. **"Can I sync only people with a specific role in the Group?"**
   Not yet. Committee filters (role-scoped Group→Mailing List sync) are tracked as a future enhancement (#4026 acceptance criterion, blocked on backend design #4904) and are **not implemented** in Self Serve today, unlike PCC's equivalent feature. Don't tell users this is available.

7. **"I unlinked a mailing list but sync settings are still showing."**
   Unlinking (via the Settings tab's per-row remove action) clears the mailing list's association with the Group. If a stale Sync Settings card still appears, that's a caching/refresh issue in the Settings tab or drawer, not a data problem — have the user refresh.

8. **"Apply Changes is grayed out in the Sync Now dialog."**
   The button is disabled whenever nothing is selected across the Adds/Removes tabs. Have the user check at least one row (or confirm they actually want to apply zero changes, in which case Cancel is correct).

## Sync Modes Reference

| `sync_mode` wire value | UI label             | Who triggers membership changes                                                                                                                |
| ---------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `manual`               | Manual (sync off)    | Nobody automatically — Sync Now currently requires an auto direction to already be set and will reject a `manual`/unset list (see scenario 1). |
| `auto_c_to_ml`         | Group → Mailing List | Group membership changes drive mailing list subscription                                                                                       |
| `auto_ml_to_c`         | Mailing List → Group | Mailing list subscription changes drive Group membership                                                                                       |

## Limitations and Known Constraints

- **One auto direction per Group.** Only one linked mailing list can have an active `auto_*` direction per Group at a time (enforced via `MailingListService.getMailingListsByCommittee`). Other linked lists must stay `manual`.
- **No idle reconciliation.** Auto sync only runs its full roster diff when a join/leave event fires — it does not reconcile on a schedule or on toggle. If no event has happened since enabling, nothing has synced yet; **Sync Now** reconciles immediately instead of waiting for the next event, but only on a list that already has an auto direction set (it rejects `manual`/unset `sync_mode`; see scenario 1).
- **No committee filters (role-scoped sync).** Unlike PCC, Self Serve cannot yet restrict Group→Mailing List sync to members with a specific committee role. Tracked under #4026/#4904, not implemented as of this writing.
- **Automatic removal is Group→Mailing List and private-list-only.** The realtime `auto_c_to_ml` auto-sync path (issue #4023) only auto-removes someone when the mailing list is private — a public list only ever auto-adds, never auto-removes. This restriction is specific to that automatic path: a manual **Sync Now** apply lets the manager approve removes regardless of visibility, for either sync direction, since a human is reviewing the diff. The reverse automatic direction (`auto_ml_to_c`) isn't implemented in this service at all — ITX propagates Groups.io unsubscribe events straight to the Group in real time, independent of this restriction.
- **Automatic removal also checks sibling lists on the same Group.** Before an automatic removal is applied, the service checks whether the person is still subscribed to any other mailing list linked to the same Group — including one in `manual` mode — and skips the removal if so, so they aren't dropped from one list while still belonging to a sibling tied to the same committee.
- **Conflicts are informational only.** The Sync Now dialog's Conflicts tab surfaces mismatched-email rows but never applies changes for them automatically.

## Implementation Status

For current status, check epic [#4022](https://github.com/linuxfoundation/lfx-self-serve/issues/4022) and its linked PRs rather than relying on a snapshot here — in-review UI, flag names, and dialog copy can still change before merge.

The link/unlink part of the Associated Mailing Lists dialog (item 3 above) is already on `main` — it predates this epic. The committee-filter acceptance criterion of #4026 (role-scoped Group→Mailing List sync) is still open.

Re-verify button labels, flag names, and dialog copy against `main` once the epic's PRs merge.

## Escalation Path

Before escalating to engineering, collect:

1. The Group's UID and name (not just the display name, since Group ≠ underlying committee name in some legacy records).
2. The mailing list's UID and Groups.io group name, and whether it's public or private.
3. The mailing list's current `sync_mode` value.
4. Whether `AUTO_SYNC_ENABLED` is confirmed on for the relevant environment (dev/staging/prod) — check the `lfx-v2-mailing-list-service` deployment env vars, not just the LaunchDarkly flag.
5. Any ITX sync job ID or error surfaced by the Sync Now dialog's error view, if the issue involves a failed preview or apply.

Escalate backend sync-logic issues (auto-sync not firing, incorrect diffs, apply failures) to the `lfx-v2-mailing-list-service` / ITX maintainers — ITX (`itx-service-groupsio`) is the engine that actually computes and applies sync diffs; `lfx-v2-mailing-list-service` only polls ITX's async jobs. Escalate UI/flag visibility issues to the Self Serve frontend team.
