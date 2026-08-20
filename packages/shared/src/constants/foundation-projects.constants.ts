// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FoundationProjectsDetailGroupedResponse } from '../interfaces/analytics-data.interface';
import type { FoundationProjectRowView } from '../interfaces/dashboard-metric.interface';

/**
 * Maximum number of concurrent HTTP request subscriptions fired by the
 * foundation projects page. Each project issues 2 requests (committees +
 * mailing-lists), so this value caps concurrent request subscriptions, not
 * projects — a value of 8 keeps approximately 4 projects in flight at once.
 * Prevents large foundations (hundreds of projects) from flooding the BFF
 * with N × 2 simultaneous requests on initial load. Results accumulate
 * progressively — channel/group indicators light up row-by-row as each
 * project resolves.
 */
export const FOUNDATION_PROJECT_COUNT_FETCH_CONCURRENCY = 8;

/**
 * Maximum recursion depth when walking a foundation's descendant project tree to discover
 * nested sub-foundations (e.g. NeoNephos under Linux Foundation Europe) for the Foundation
 * Projects page (GH-1607). The FOUNDATION_TOTAL_PROJECTS_DETAIL Snowflake cube's
 * `FOUNDATION_SLUG` column does not roll up multi-level descendants, so the BFF walks the
 * project-service hierarchy directly instead. A depth of 3 covers every known foundation
 * shape (foundation → sub-foundation → project) with headroom for one extra level, while
 * still bounding worst-case fan-out against a pathological or misconfigured tree.
 */
export const FOUNDATION_DESCENDANT_TRAVERSAL_MAX_DEPTH = 3;

/**
 * Maximum number of sub-foundations {@link FOUNDATION_DESCENDANT_TRAVERSAL_MAX_DEPTH}'s walk
 * will discover in total, across the whole tree, before it stops recursing further branches.
 * The depth cap alone doesn't bound worst-case fan-out: selecting a true umbrella foundation
 * (e.g. The Linux Foundation itself) as the page's foundation context can have dozens of direct
 * `computeIsFoundation` children, each contributing its own Snowflake query and rendered table.
 * This caps the total Snowflake fan-out (and rendered sections) regardless of tree breadth.
 */
export const FOUNDATION_DESCENDANT_TRAVERSAL_MAX_NODES = 40;

/**
 * Max concurrent per-slug `FOUNDATION_TOTAL_PROJECTS_DETAIL` Snowflake queries fanned out across
 * a foundation's discovered sub-foundations. A wide foundation can have up to
 * {@link FOUNDATION_DESCENDANT_TRAVERSAL_MAX_NODES} sub-foundations; firing all of their detail
 * queries at once can overflow the shared Snowflake pool's waiting-client queue (see
 * `ORG_LENS_ACCOUNT_CONTEXT_FETCH_CONCURRENCY` for the same pool-exhaustion concern) and cause
 * otherwise-healthy queries to be rejected (GH-1607 review).
 */
export const FOUNDATION_PROJECT_DETAIL_FETCH_CONCURRENCY = 8;

/**
 * Empty-state fallback for the Foundation Projects page's grouped detail request —
 * mirrors {@link DEFAULT_FOUNDATION_PROJECTS_DETAIL}'s role for the flat drawer endpoint.
 */
export const DEFAULT_FOUNDATION_PROJECTS_DETAIL_GROUPED: FoundationProjectsDetailGroupedResponse = { groups: [], totalCount: 0 };

/**
 * All valid presence-filter pill IDs on the foundation projects page, in
 * display order. Source of truth for the {@link PresencePill} type, which
 * is derived from this tuple — so adding or removing an ID here updates the
 * type automatically and keeps the runtime validator (`onPillChange`) in
 * sync with the TypeScript union.
 */
export const PRESENCE_PILL_IDS = ['all', 'with-groups', 'without-groups', 'with-channels', 'without-channels'] as const;

/**
 * Fallback row view used when the precomputed `projectRowViews` map has no
 * entry for a given project slug (transient — e.g. a new project arriving
 * before the view-computed has rebuilt). Mirrors a fully-pending row with
 * all display labels set to `"Loading"`.
 */
export const DEFAULT_FOUNDATION_PROJECT_ROW_VIEW: FoundationProjectRowView = {
  lensReady: false,
  groupsPresence: 'pending',
  mailingListsPresence: 'pending',
  chatPresence: 'pending',
  groupsText: 'Loading',
  mailingListsText: 'Loading',
  chatText: 'Loading',
};
