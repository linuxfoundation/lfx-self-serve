// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PENDING_ACTION_BUTTON_ICON, PENDING_ACTION_SEVERITY } from '../constants/pending-action.constants';
import type { PendingActionItem } from '../interfaces/components.interface';
import type { FormationItemStatus, MyFormationItemRow, MyFormationSummary } from '../interfaces/formation.interface';

/** The three "My formations" subtitle buckets, keyed by project — see {@link MyFormationSummary}. */
export type MyFormationBucketCounts = Pick<MyFormationSummary, 'assigned_to_do' | 'assigned_with_team' | 'assigned_done'>;

/**
 * True for every {@link FormationItemStatus} that still belongs on the caller's Pending Actions
 * list — i.e. every status except the two terminal ones. `awaiting_acceptance` stays open: the
 * assignee's own work is done, but the row still surfaces so they can see the item is waiting on
 * the formation team (GH-1956 decision 3 — the assignee never sets a status themselves, so nothing
 * here transitions an item to `done`).
 */
export function isAssignedItemOpen(status: FormationItemStatus): boolean {
  return status !== 'done' && status !== 'skipped';
}

/**
 * Buckets a caller's assigned items on one formation into the three "My formations" subtitle
 * counts (GH-1956). Takes every item assigned to the caller on the formation — not just the open
 * ones {@link isAssignedItemOpen} keeps for the Pending Actions response — so `assigned_done` has
 * something to count; `MyFormationWorkResponse.items` only ever carries the open subset.
 */
export function summarizeMyFormationItems(items: { status: FormationItemStatus }[]): MyFormationBucketCounts {
  let assignedToDo = 0;
  let assignedWithTeam = 0;
  let assignedDone = 0;

  for (const item of items) {
    if (item.status === 'awaiting_acceptance') {
      assignedWithTeam += 1;
    } else if (item.status === 'done' || item.status === 'skipped') {
      assignedDone += 1;
    } else {
      // not_started | in_progress | blocked
      assignedToDo += 1;
    }
  }

  return { assigned_to_do: assignedToDo, assigned_with_team: assignedWithTeam, assigned_done: assignedDone };
}

/**
 * `2 to do · 1 with formation team · 1 done` (GH-1956 decision "subtitle copy") — zero-count
 * buckets are dropped entirely rather than rendered as "0 done", so a formation with nothing yet
 * completed reads `2 to do · 1 with formation team`, not a padded three-part string.
 */
export function formatMyFormationSubtitle(summary: MyFormationBucketCounts): string {
  const parts: string[] = [];
  if (summary.assigned_to_do > 0) parts.push(`${summary.assigned_to_do} to do`);
  if (summary.assigned_with_team > 0) parts.push(`${summary.assigned_with_team} with formation team`);
  if (summary.assigned_done > 0) parts.push(`${summary.assigned_done} done`);
  return parts.join(' · ');
}

/**
 * Pure mapping from `MyFormationWorkResponse.items` to Pending Actions rows (GH-1956) — mirrors
 * `buildInvitationActions`'s split (server aggregator stays a thin caller, the row shape is
 * unit-testable here without standing up Express). Ordering (formation rows placed immediately
 * after invitations) is the caller's concern, not this function's.
 *
 * No "Mark done" button ever appears — GH-1956 decision 3: the assignee doesn't set status. The
 * row always offers Claim / Block with note / Open; `buttonText` stays "Claim" even for an
 * `awaiting_acceptance` row (the template disables/relabels it client-side once claimed, keyed off
 * `formationItemStatus`), since it is the assignee's one inline action and not a status label.
 */
export function buildFormationItemActions(items: MyFormationItemRow[]): PendingActionItem[] {
  return items.map((item) => ({
    type: 'FormationItem',
    badge: item.project_name,
    text: item.title,
    icon: PENDING_ACTION_BUTTON_ICON.FormationItem,
    severity: PENDING_ACTION_SEVERITY.FormationItem,
    buttonText: 'Claim',
    buttonLink: item.action_href ?? undefined,
    ...(item.due_date ? { date: item.due_date } : {}),
    formationProjectUid: item.project_uid,
    formationItemKey: item.template_item_key,
    formationItemUid: item.item_uid,
    formationItemStatus: item.status,
    formationIsGating: item.is_gating,
  }));
}
