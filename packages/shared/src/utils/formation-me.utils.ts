// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FORMATION_CHECKLIST_PATH,
  FORMATION_ITEM_QUERY_PARAM,
  FORMATION_ITEM_STATUS_LABELS,
  FORMATION_ITEM_STATUS_SEVERITY,
} from '../constants/formation.constants';
import { PENDING_ACTION_BUTTON_ICON, PENDING_ACTION_SEVERITY } from '../constants/pending-action.constants';
import type { FormationPendingActionView, PendingActionItem } from '../interfaces/components.interface';
import type { FormationItemStatus, MyFormationItemRow, MyFormationSummary } from '../interfaces/formation.interface';
import { formatIsoDateShortLabel } from './date-time.utils';

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
 * The row's one action is "View item" (#2732): it navigates to the project's checklist with this
 * item's panel open — `buildFormationPendingActionView` builds that link from
 * `formationProjectSlug` + `formationItemKey` — where the full item surface (notes, evidence link,
 * and status controls for whoever holds them) lives. Nothing on the row mutates the item, so
 * GH-1956 decision 3 (the assignee never sets a status from here) still holds. The earlier
 * in-dashboard drawer path, and the `can_write`/`can_set_status` flags it carried, are gone;
 * `MyFormationItemRow` keeps those on the wire for parity with the checklist response.
 */
export function buildFormationItemActions(items: MyFormationItemRow[]): PendingActionItem[] {
  return items.map((item) => ({
    type: 'FormationItem',
    badge: item.project_name,
    text: item.title,
    icon: PENDING_ACTION_BUTTON_ICON.FormationItem,
    severity: PENDING_ACTION_SEVERITY.FormationItem,
    buttonText: 'View item',
    ...(item.due_date ? { date: item.due_date } : {}),
    formationProjectUid: item.project_uid,
    formationProjectSlug: item.project_slug,
    formationItemKey: item.template_item_key,
    formationItemUid: item.item_uid,
    formationItemStatus: item.status,
    formationIsGating: item.is_gating,
  }));
}

const NOT_A_FORMATION_ROW: FormationPendingActionView = {
  isFormationItem: false,
  formationViewCommands: null,
  formationViewQueryParams: null,
  formationViewAriaLabel: null,
  formationStatusLabel: null,
  formationStatusSeverity: null,
  formationDueLabel: null,
};

/**
 * The per-row view both Pending Actions surfaces (the dashboard list and its "View all" drawer)
 * precompute for a FormationItem row (#2732) — see `FormationPendingActionView`. A formation row
 * missing the slug or key its link is built from is not linkable and is treated as a plain row.
 */
export function buildFormationPendingActionView(item: PendingActionItem): FormationPendingActionView {
  const slug = item.formationProjectSlug;
  const itemKey = item.formationItemKey;
  if (item.type !== 'FormationItem' || !slug || !itemKey) {
    return NOT_A_FORMATION_ROW;
  }
  const status = item.formationItemStatus;
  return {
    isFormationItem: true,
    formationViewCommands: [FORMATION_CHECKLIST_PATH],
    formationViewQueryParams: { project: slug, [FORMATION_ITEM_QUERY_PARAM]: itemKey },
    formationViewAriaLabel: `View ${item.text} on the formation checklist`,
    formationStatusLabel: status ? FORMATION_ITEM_STATUS_LABELS[status] : null,
    formationStatusSeverity: status ? FORMATION_ITEM_STATUS_SEVERITY[status] : null,
    formationDueLabel: formatIsoDateShortLabel(item.date),
  };
}
