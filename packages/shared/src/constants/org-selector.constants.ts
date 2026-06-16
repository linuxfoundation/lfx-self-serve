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
