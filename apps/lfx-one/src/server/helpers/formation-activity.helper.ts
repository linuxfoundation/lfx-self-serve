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

/**
 * `GET /formations/{project_uid}/activity` takes an `item_uid` filter (GH-2572, upstream
 * `lfx-v2-formation-service` v0.1.3 / GH-2375) — the caller passes it on every page, so a single
 * fetch here is already scoped to one item's own entries. A filtered read still pages, and usually
 * returns far fewer entries than a page holds, so the multi-page path stays: this caps it at 5
 * pages of 100 (500 entries) as a defensive bound on one item's history, not because a single
 * item's activity is expected to approach that.
 */
export const FORMATION_ACTIVITY_MAX_PAGES = 5;

export interface FormationActivityFetchResult {
  entries: FormationActivity[];
  /** True when the page bound was hit with more pages outstanding, or upstream returned a repeated cursor. */
  truncated: boolean;
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
 * Upstream's redacted before/after summary carries only `status`/`assignee` for item entries and a
 * richer, differently-shaped object for the two formation-level actions (`template_expanded`/
 * `template_upgraded`). This mapper only preserves the common `status`/`assignee` subset and drops
 * any extra keys from the formation-level payload, since the drawer doesn't render them today.
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
 * `fetchPage` call), newest-first, bounded at {@link FORMATION_ACTIVITY_MAX_PAGES} pages of
 * {@link FORMATION_ACTIVITY_PAGE_LIMIT}. Order is preserved exactly as upstream serves it
 * (`ORDER BY ulid DESC`); nothing here re-sorts. Formation-level entries (`template_expanded`,
 * `template_upgraded`) are never returned by a filtered read (GH-2572) and are no longer merged in.
 *
 * A failure on any page propagates — the caller decides whether that means "the whole drawer
 * fetch fails" or "history degrades to unavailable" (GH-2372: the latter, since the item read has
 * already succeeded by the time this runs). This is a deliberate departure from
 * `fetchAllQueryResources`'s `failOnPartial` default: silently presenting a partial feed as an
 * item's complete history is exactly the dishonesty this ticket forbids, so a later-page failure
 * is never swallowed into a `truncated: true` result — it throws just like a page-1 failure.
 */
export async function fetchItemFormationActivity(
  req: Request,
  fetchPage: (cursor: string | undefined) => Promise<UpstreamFormationActivityPage>,
  itemUid: string
): Promise<FormationActivityFetchResult> {
  const entries: FormationActivity[] = [];
  let cursor: string | undefined;
  let truncated = false;

  for (let page = 1; page <= FORMATION_ACTIVITY_MAX_PAGES; page++) {
    const result = await fetchPage(cursor);

    logger.debug(req, 'fetch_item_formation_activity', 'Fetched activity page', { item_uid: itemUid, page, entries: result.entries.length });

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
    // absorb by exhausting every page.
    if (result.next_cursor && result.next_cursor === cursor) {
      logger.warning(req, 'fetch_item_formation_activity', 'Upstream returned a repeated cursor — stopping early', { item_uid: itemUid, page });
      truncated = true;
      break;
    }

    if (!result.next_cursor) {
      // Last page — the item's filtered feed was scanned in full.
      return { entries, truncated };
    }
    cursor = result.next_cursor;

    if (page === FORMATION_ACTIVITY_MAX_PAGES) {
      truncated = true;
    }
  }

  return { entries, truncated };
}
