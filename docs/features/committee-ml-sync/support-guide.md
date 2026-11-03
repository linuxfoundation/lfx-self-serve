# Support Guide: Group ↔ Mailing List Sync

**Feature:** Automatic and manual membership sync between a Group and its linked Groups.io mailing list(s).
**Audience:** Support engineers, customer success, internal escalation handlers.
**Status:** Draft against in-review branches. Every button label, dialog header, and flag name below was verified against the open PRs listed in [Implementation Status](#implementation-status). Re-verify against `main` once those PRs merge, before relying on this doc to resolve a live ticket.

## What Is This Feature?

A Group (Self Serve's term for what the backend calls a "committee" — see [Terminology](#terminology)) can be linked to one or more Groups.io mailing lists. Once linked, a manager can turn on automatic membership sync in one direction:

| Mode | Direction | Behavior |
|------|-----------|----------|
| Group → Mailing List | `AUTO_COMMITTEE_TO_MAILING_LIST` | When someone joins/leaves the Group, they're automatically subscribed/unsubscribed on the linked mailing list. |
| Mailing List → Group | `AUTO_MAILING_LIST_TO_COMMITTEE` | When someone joins/leaves the mailing list, they're automatically added/removed as a Group member. |
| Manual | `MANUAL` | No automatic sync. The manager uses **Sync Now** to review and apply differences on demand. |

Only one linked list per Group can run an auto direction at a time — see [Limitations](#limitations-and-known-constraints).

### Terminology

Self Serve always displays "committee" as **Group** / **Groups** in the UI (`COMMITTEE_LABEL` in `packages/shared/src/constants/committees.constants.ts`). The underlying API, database records, and this doc's field names still say "committee" — when a ticket or log references `committee_id` or `sync_mode`, that's the same entity the user sees as "Group."

## Where to Find the Feature

**1. Mailing List view page → Sync Settings card**
Open a mailing list (`apps/lfx-one/.../mailing-list-view`). If the list is linked to a Group, a **Sync Settings** card shows an "Automatic membership sync" toggle (`sync-settings-toggle`). Turning it on reveals a direction picker (`sync-settings-direction`) and a **Sync Now** button (`sync-now-button`). If another linked list for the same Group already has an active direction, a green "Active Group sync" notice (`active-committee-sync-notice`) appears and blocks setting a second one.

**2. Group detail page → Settings tab → Auto Sync button**
On a Group's **Settings** tab, next to the mailing list list, an **Auto Sync** button (`settings-auto-sync-btn`) opens a drawer titled "Auto Sync" (subtitled with the Group's name). The drawer hosts one Sync Settings card (same component as above) per mailing list associated with the Group, so a manager can review/change every linked list's sync mode from one place.

**3. Group detail page → Settings tab → Associated Mailing Lists dialog**
The **+ Add List** button next to the mailing lists section opens a dialog titled **"Associated Mailing Lists"** (not "Configure Mailing Lists" — the button and the dialog header differ from PCC's naming). This dialog only links/unlinks mailing lists to the Group; it does **not** set sync direction or committee filters — those aren't available here yet (see [Limitations](#limitations-and-known-constraints)). To remove a linked list, use the per-row "Remove mailing list" action on the Settings tab itself, outside this dialog.

**4. Sync Now preview/apply dialog**
Triggered from the Sync Settings card's "Sync Now" button. Shows three tabs: **Adds**, **Removes**, **Conflicts** (mismatched-email rows that are informational only — nothing in Conflicts is auto-applied). Each row in Adds/Removes has a checkbox so the manager can skip specific entries. Applying can take minutes; the dialog shows an elapsed-seconds counter, not a progress bar, while ITX computes and applies the diff.

## Common User Scenarios

1. **"I turned on sync but nothing happened."**
   Auto sync only reacts to new join/leave events going forward — it does not backfill existing membership gaps (see Limitations). Tell the user to use **Sync Now** to reconcile the current state once, then auto sync will keep it current.

2. **"The direction picker won't let me pick a direction."**
   Check for the "Active Group sync" notice — only one mailing list per Group may run an auto direction. The manager must turn off sync on the other list first.

3. **"People are being removed from the mailing list unexpectedly."**
   Removal propagation only runs for mailing lists marked **private** in Groups.io. If the list is public, removals never auto-propagate — only adds do. If the list genuinely is private, check `internal/service/realtime_auto_sync.go`'s cross-list guard: two private lists set to the same Group with the same auto direction will not remove a member who is still independently subscribed on the sibling list.

4. **"Sync toggle / Auto Sync button isn't showing up at all."**
   Two independent gates, both must be on:
   - Frontend: `MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG` (LaunchDarkly) — controls whether the UI shows the Sync Settings section at all.
   - Backend: `AUTO_SYNC_ENABLED` env var on `lfx-v2-mailing-list-service` — the kill switch for issue #4878. Fails **open** (enabled) unless explicitly set to `false`; check this before assuming a deploy issue.
   These are independent — the UI can be visible while the backend execution path is killed, or vice versa. Confirm both before escalating as a bug.

5. **"Sync Now says Conflicts but didn't fix anything."**
   This is expected — the Conflicts tab lists mismatched-email rows for the manager's awareness; it is never auto-applied. There's no action needed unless the user wants to manually reconcile those accounts.

6. **"Can I sync only people with a specific role in the Group?"**
   Not yet. Committee filters (role-scoped Group→Mailing List sync) are tracked as a future enhancement (#4026 acceptance criterion, blocked on backend design #4904) and are **not implemented** in Self Serve today, unlike PCC's equivalent feature. Don't tell users this is available.

7. **"I unlinked a mailing list but sync settings are still showing."**
   Unlinking (via the Settings tab's per-row remove action) clears the mailing list's association with the Group. If a stale Sync Settings card still appears, that's a caching/refresh issue in the Settings tab or drawer, not a data problem — have the user refresh.

8. **"Apply Changes is grayed out in the Sync Now dialog."**
   The button is disabled whenever nothing is selected across the Adds/Removes tabs. Have the user check at least one row (or confirm they actually want to apply zero changes, in which case Cancel is correct).

## Sync Modes Reference

| `sync_mode` value | UI label | Who triggers membership changes |
|---|---|---|
| `MANUAL` | Manual (sync off) | Nobody — manager must use Sync Now |
| `AUTO_COMMITTEE_TO_MAILING_LIST` | Group → Mailing List | Group membership changes drive mailing list subscription |
| `AUTO_MAILING_LIST_TO_COMMITTEE` | Mailing List → Group | Mailing list subscription changes drive Group membership |

## Limitations and Known Constraints

- **One auto direction per Group.** Only one linked mailing list can have an active `AUTO_*` direction per Group at a time (enforced via `MailingListService.getMailingListsByCommittee`). Other linked lists must stay `MANUAL` or use Sync Now.
- **No backfill.** Enabling auto sync does not reconcile existing membership gaps — it only reacts to events going forward. Sync Now is the only way to reconcile history.
- **No committee filters (role-scoped sync).** Unlike PCC, Self Serve cannot yet restrict Group→Mailing List sync to members with a specific committee role. Tracked under #4026/#4904, not implemented as of this writing.
- **Removal propagation is private-list-only.** Removing someone from a public mailing list never auto-propagates to or from the Group; only private lists support auto-removal, and a cross-list guard prevents removal when a sibling private list with the same direction still independently subscribes that member.
- **Conflicts are informational only.** The Sync Now dialog's Conflicts tab surfaces mismatched-email rows but never applies changes for them automatically.

## Implementation Status

As of 2026-11-03, this feature's PRs are **open and in review**, not yet merged to `main`:

- Backend: `lfx-v2-mailing-list-service` PR #101 (sync mode & job model, #4029), PR #104 (auto-sync execution, #4023), PR #106 (kill switch, #4878).
- Frontend: `lfx-self-serve` PR #4880 (Sync Settings card, #4024), PR #4899 (Auto Sync drawer, #4025), PR #4911 (Sync Now dialog, #4027).
- The "Associated Mailing Lists" link/unlink dialog (#4026, item 3 above) is the only piece already on `main` — it predates this epic.

Re-verify button labels, flag names, and dialog copy against `main` once these PRs merge, since in-review UI can still change during review.

## Escalation Path

Before escalating to engineering, collect:

1. The Group's UID and name (not just the display name, since Group ≠ underlying committee name in some legacy records).
2. The mailing list's UID and Groups.io group name, and whether it's public or private.
3. The mailing list's current `sync_mode` value.
4. Whether `AUTO_SYNC_ENABLED` is confirmed on for the relevant environment (dev/staging/prod) — check the `lfx-v2-mailing-list-service` deployment env vars, not just the LaunchDarkly flag.
5. Any ITX sync job ID or error surfaced by the Sync Now dialog's error view, if the issue involves a failed preview or apply.

Escalate backend sync-logic issues (auto-sync not firing, incorrect diffs, apply failures) to the `lfx-v2-mailing-list-service` / ITX maintainers — ITX (`itx-service-groupsio`) is the engine that actually computes and applies sync diffs; `lfx-v2-mailing-list-service` only polls ITX's async jobs. Escalate UI/flag visibility issues to the Self Serve frontend team.
