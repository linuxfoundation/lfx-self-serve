// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NAV_SEARCH_DEBOUNCE_MS } from './lens.constants';

/** Debounce for org-selector typeahead — kept in lockstep with the project-selector. */
export const ORG_SELECTOR_DEBOUNCE_MS = NAV_SEARCH_DEBOUNCE_MS;

/** Hard cap on the role-grants `per_page` (spec SC-005b); orgs beyond this fall to no-badge. */
export const ORG_ROLE_GRANTS_HARD_CAP = 500;

/** Spec 022 (FR-017) — page-through cap per direct-granted parent when paginating cascading children. */
export const ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP = 500;

/** Max concurrent query-service pagination loops when fetching cascading children, to avoid bursting hundreds of in-flight requests. */
export const ORG_CASCADING_CHILDREN_FETCH_CONCURRENCY = 8;

/** Max concurrent per-account Snowflake reads when warming the Org Lens account-context cache, so a many-account bootstrap can't exhaust the Snowflake connection pool. */
export const ORG_LENS_ACCOUNT_CONTEXT_FETCH_CONCURRENCY = 8;

/** Short TTL for the per-username access-aware org-universe memo — keeps typeahead requests off query-service/NATS while staying fresh enough for grant changes. */
export const ORG_ACCESS_AWARE_CACHE_TTL_MS = 30 * 1000;

/** LFXV2-2750 — `per_page` when paginating a foundation's `project_membership` roster (member-org enumeration). */
export const FOUNDATION_MEMBERSHIP_PAGE_SIZE = 500;

/** LFXV2-2750 — hard cap on foundation-auditor member-org rows appended to a single org-selector page. */
export const FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP = ORG_ROLE_GRANTS_HARD_CAP;

/** LFXV2-2750 — minimum typeahead term length before the foundation-auditor lookup runs (keeps the default dropdown on the grants-only fast path). */
export const FOUNDATION_AUDITOR_SEARCH_MIN_TERM_LENGTH = 2;

/**
 * LFXV2-2750 — max foundations whose member roster is pulled. Foundations are a small set (~56 today), so the
 * enumerate + batched `project:<uid>#auditor` check is cheap; this caps the roster pulls that follow.
 */
export const FOUNDATION_AUDITOR_MAX_FOUNDATIONS = 60;

/**
 * LFXV2-2750 — roster reads take the FIRST PAGE ONLY per foundation (no deep pagination). Deep-paginating every
 * audited foundation is what made the original eager design hang for minutes on broad-access callers.
 */
export const FOUNDATION_AUDITOR_ROSTER_PAGE_SIZE = 500;

/** LFXV2-2750 — in-process memo TTL for a caller's resolved member-org set, so a typeahead doesn't refetch rosters per keystroke. */
export const FOUNDATION_AUDITOR_MEMBER_CACHE_TTL_MS = 60 * 1000;

/**
 * LFXV2-2750 — chunk size for the batched upstream calls (the `project:<uid>#auditor` access-check POST and the
 * `b2b_org_uid:` tags GET), so a large audited-foundation set never sends one oversized request that could hit a
 * gateway URL-length limit or an access-check batch limit.
 */
export const FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE = 200;

/** LFXV2-2750 — max concurrent per-foundation roster reads during the M2M member-org pull. */
export const FOUNDATION_AUDITOR_ROSTER_FETCH_CONCURRENCY = 8;
