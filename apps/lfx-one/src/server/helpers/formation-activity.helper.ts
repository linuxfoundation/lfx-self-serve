// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FormationActivity, FormationUser, UpstreamFormationActivityEntry, UpstreamFormationActivityPage } from '@lfx-one/shared/interfaces';
import { normalizeFormationActivityAction } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from '../services/logger.service';

/**
 * A new sibling to `formation-mapper.helper.ts` rather than an addition to it (GH-2372) — that
 * file's `deriveFormationSubStage` is owned by a parallel worktree (GH-2328); keeping activity
 * mapping here means neither branch touches the other's file.
 */

/** Upstream's own cap (`cmd/formation-api/design/design.go`'s `dsl.Maximum(100)`). */
export const FORMATION_ACTIVITY_PAGE_LIMIT = 100;

export interface FormationActivityFetchResult {
  entries: FormationActivity[];
}

/**
 * Maps upstream's bare-username actor onto {@link FormationUser}, same precedent as
 * `formation-mapper.helper.ts`'s item-owner mapping (`raw.assignee ? { username, name } : null`) —
 * except every entry needs an actor, so the system-authored case (`set_by === 'system'`, or the
 * literal username `"system"`) maps to a `FormationUser` naming itself rather than `null`, keeping
 * the field non-optional for template simplicity.
 */
function mapActor(raw: UpstreamFormationActivityEntry): FormationUser {
  if (raw.set_by === 'system' || raw.actor === 'system') {
    return { username: 'system', name: 'System' };
  }
  return { username: raw.actor, name: raw.actor };
}

/**
 * Upstream's redacted before/after summary carries only `status`/`assignee` for item entries. This
 * mapper preserves that subset and drops any unrecognized keys defensively.
 */
function toSnapshot(value: Record<string, unknown> | null | undefined): { status: string | null; assignee: string | null } | null {
  if (!value || typeof value !== 'object') return null;
  const status = typeof value['status'] === 'string' ? (value['status'] as string) : null;
  const assignee = typeof value['assignee'] === 'string' ? (value['assignee'] as string) : null;
  return { status, assignee };
}

/** Maps one upstream activity entry onto the canonical shape. Exported for the helper's own spec. */
export function mapUpstreamFormationActivity(raw: UpstreamFormationActivityEntry): FormationActivity {
  return {
    uid: raw.ulid,
    formation_item_uid: raw.item_uid ?? null,
    action: normalizeFormationActivityAction(raw.action),
    action_raw: raw.action ?? '',
    set_by: raw.set_by,
    actor: mapActor(raw),
    before: toSnapshot(raw.before),
    after: toSnapshot(raw.after),
    created_at: raw.at,
  };
}

/**
 * Pages through one item's already-filtered activity feed (the caller passes `item_uid` on every
 * `fetchPage` call), newest-first. Order is preserved exactly as upstream serves it
 * (`ORDER BY ulid DESC`); nothing here re-sorts. Formation-level entries (`template_expanded`,
 * `template_upgraded`) are never returned by a filtered read (GH-2572) and are no longer merged in.
 *
 * Unbounded by design (GH-2572): a filtered read's page count tracks one item's own history, not
 * the whole formation's, so the whole-feed-scan page cap this pager used to need is gone with it.
 * The repeated-cursor guard stays — a filtered read can still regress upstream into looping on the
 * same page — so it throws rather than looping forever. A failure on any page propagates — the
 * caller decides whether that means "the whole drawer fetch fails" or "history degrades to
 * unavailable" (GH-2372: the latter, since the item read has already succeeded by the time this
 * runs).
 */
export async function fetchItemFormationActivity(
  req: Request,
  fetchPage: (cursor: string | undefined) => Promise<UpstreamFormationActivityPage>,
  itemUid: string
): Promise<FormationActivityFetchResult> {
  const entries: FormationActivity[] = [];
  let cursor: string | undefined;

  do {
    const result = await fetchPage(cursor);

    logger.debug(req, 'fetch_item_formation_activity', 'Fetched activity page', { item_uid: itemUid, entries: result.entries.length });

    const unmappedActions = new Set<string>();
    for (const raw of result.entries) {
      const mapped = mapUpstreamFormationActivity(raw);
      if (mapped.action === null) unmappedActions.add(mapped.action_raw);
      entries.push(mapped);
    }
    if (unmappedActions.size > 0) {
      logger.debug(req, 'fetch_item_formation_activity', 'Upstream activity action has no canonical equivalent', {
        item_uid: itemUid,
        unmapped_actions: [...unmappedActions],
      });
    }

    // Repeated cursor would loop forever — an upstream regression, not a bound we should silently
    // absorb by re-requesting the same page indefinitely.
    if (result.next_cursor && result.next_cursor === cursor) {
      throw new Error(`formation activity returned a repeated cursor for item ${itemUid}`);
    }

    cursor = result.next_cursor || undefined;
  } while (cursor);

  return { entries };
}
