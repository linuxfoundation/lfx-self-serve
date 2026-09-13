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
 * `GET /formations/{project_uid}/activity` is formation-scoped with no item filter — the
 * repository query filters on `formation_uid` alone (verified against
 * `linuxfoundation/lfx-v2-formation-service` @ `beaa6371ff94a1ae01f3e624922897cb34ee199b`). Finding
 * one item's entries means scanning the formation's whole feed newest-first until either the item
 * has enough history or the feed ends. Fetching a single page and filtering it is wrong — an
 * item's entries can start on any page — and unbounded paging is unacceptable for an interactive
 * drawer open, so this caps the scan at 5 pages of 100 (500 entries): each item mutation writes
 * exactly one entry and a template runs on the order of dozens of items, so 500 exceeds a whole
 * formation's realistic history — the bound exists to cap the pathological case at 5 sequential
 * upstream calls, not because 500 is expected to be hit. Confirm against observed prod volume and
 * report it (GH-2372's "report, do not fix" item) — the real fix is an upstream `item_uid` query
 * param, which would collapse this to one call.
 */
export const FORMATION_ACTIVITY_MAX_PAGES = 5;

export interface FormationActivityFetchResult {
  entries: FormationActivity[];
  /** True when the page bound was hit with more pages outstanding, or a later page failed to load. */
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
 * `template_upgraded`) — neither of those reach this mapper (filtered out before mapping, since
 * they carry no `item_uid`), so this only ever needs to read the two-key item shape. Reads
 * defensively regardless, since the field is `unknown` on the wire.
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
 * Scans a formation's activity feed, newest-first, for one item's entries — bounded at
 * {@link FORMATION_ACTIVITY_MAX_PAGES} pages of {@link FORMATION_ACTIVITY_PAGE_LIMIT}. Order is
 * preserved exactly as upstream serves it (`ORDER BY ulid DESC`); nothing here re-sorts.
 *
 * A page-1 failure propagates — the caller decides whether that means "the whole drawer fetch
 * fails" or "history degrades to unavailable" (GH-2372: the latter, since the item read has
 * already succeeded by the time this runs). A later-page failure does not: this is a deliberate
 * departure from `fetchAllQueryResources`'s `failOnPartial` default — silently presenting a
 * partial feed as an item's complete history is exactly the dishonesty this ticket forbids, so a
 * later-page failure returns what was gathered so far with `truncated: true` rather than throwing.
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
    let result: UpstreamFormationActivityPage;
    try {
      result = await fetchPage(cursor);
    } catch (error) {
      if (page === 1) throw error;
      logger.warning(req, 'fetch_item_formation_activity', 'Activity page failed after the first — returning partial history', {
        item_uid: itemUid,
        page,
        err: error,
      });
      truncated = true;
      break;
    }

    logger.debug(req, 'fetch_item_formation_activity', 'Fetched activity page', { item_uid: itemUid, page, entries: result.entries.length });

    const unmappedActions = new Set<string>();
    for (const raw of result.entries) {
      if (raw.item_uid !== itemUid) continue;
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
      // Last page — the full feed was scanned.
      return { entries, truncated };
    }
    cursor = result.next_cursor;

    if (page === FORMATION_ACTIVITY_MAX_PAGES) {
      truncated = true;
    }
  }

  return { entries, truncated };
}
