// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PENDING_ACTION_BUTTON_ICON, PENDING_ACTION_SEVERITY } from '../constants/pending-action.constants';
import type { PendingActionItem } from '../interfaces/components.interface';
import type { FormationItemStatus, MyFormationItemRow, MyFormationSummary } from '../interfaces/formation.interface';

/** The "My formations" subtitle buckets, keyed by project — see {@link MyFormationSummary}. */
export type MyFormationBucketCounts = Pick<MyFormationSummary, 'assigned_to_do' | 'assigned_done' | 'assigned_skipped'>;

/**
 * True for every {@link FormationItemStatus} that still belongs on the caller's Pending Actions
 * list — i.e. every status except the two terminal ones (GH-1956 decision 3 — the assignee never
 * sets a status themselves, so nothing here transitions an item to `done`).
 */
export function isAssignedItemOpen(status: FormationItemStatus): boolean {
  return status !== 'done' && status !== 'skipped';
}

/**
 * Buckets a caller's assigned items on one formation into the "My formations" subtitle counts
 * (GH-1956). Takes every item assigned to the caller on the formation — not just the open ones
 * {@link isAssignedItemOpen} keeps for the Pending Actions response — so `assigned_done` has
 * something to count; `MyFormationWorkResponse.items` only ever carries the open subset. GH-2576
 * Phase 2 removed the earlier separate "with formation team" bucket (built for the retired
 * `awaiting_acceptance` status) — every non-terminal status now folds into `assigned_to_do`.
 */
export function summarizeMyFormationItems(items: { status: FormationItemStatus }[]): MyFormationBucketCounts {
  let assignedToDo = 0;
  let assignedDone = 0;
  let assignedSkipped = 0;

  for (const item of items) {
    if (item.status === 'done') {
      assignedDone += 1;
    } else if (item.status === 'skipped') {
      assignedSkipped += 1;
    } else {
      // not_started | in_progress | blocked
      assignedToDo += 1;
    }
  }

  return { assigned_to_do: assignedToDo, assigned_done: assignedDone, assigned_skipped: assignedSkipped };
}

/**
 * `2 to do · 1 done · 1 skipped` (GH-1956 decision "subtitle copy") — zero-count buckets are
 * dropped entirely rather than rendered as "0 done", so a formation with nothing yet completed
 * reads `2 to do`, not a padded string. Skipped is its own segment, not folded into "done" —
 * skipping is the escape hatch for a gate the project can't complete (see
 * `formation-checklist.utils.ts`'s readiness summary), not completion.
 */
export function formatMyFormationSubtitle(summary: MyFormationBucketCounts): string {
  const parts: string[] = [];
  if (summary.assigned_to_do > 0) parts.push(`${summary.assigned_to_do} to do`);
  if (summary.assigned_done > 0) parts.push(`${summary.assigned_done} done`);
  if (summary.assigned_skipped > 0) parts.push(`${summary.assigned_skipped} skipped`);
  return parts.join(' · ');
}

/**
 * Pure mapping from `MyFormationWorkResponse.items` to Pending Actions rows (GH-1956) — mirrors
 * `buildInvitationActions`'s split (server aggregator stays a thin caller, the row shape is
 * unit-testable here without standing up Express). Ordering (formation rows placed immediately
 * after invitations) is the caller's concern, not this function's.
 *
 * No "Mark done" button ever appears — GH-1956 decision 3: the assignee doesn't set status. Claim
 * and Block (this row's original two inline actions alongside Open) were removed entirely from both
 * Pending Actions surfaces (GH-2613 review, linuxfoundation/lfx-self-serve#2628) — both called
 * `POST .../items/{item_key}/status`, which the deployed v0.1.4 gateway additionally gates on
 * `team:formation` membership that no assignee structurally holds, so both rendered as controls that
 * would 403 deterministically. The row now offers Open only; `buttonText` ("Claim") is vestigial for
 * this row type — nothing in either drawer template reads it once `isFormationItem` is true.
 *
 * `formationCanWrite`/`formationCanSetStatus`/`formationItemAction` still carry
 * `item.can_write`/`item.can_set_status`/`item.action` through unchanged — they no longer gate
 * anything here (that was Claim/Block's job). The drawer opened via Open needs `canWrite` for its
 * assignment fields; `canSetStatus` is inert on this assigneeOnly surface today and is carried so
 * a future non-assigneeOnly host fails closed (GH-2705; see `MyFormationItemRow.can_set_status`).
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
    formationCanWrite: item.can_write,
    formationCanSetStatus: item.can_set_status,
    formationItemAction: item.action,
  }));
}
