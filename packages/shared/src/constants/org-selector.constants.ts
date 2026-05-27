// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NAV_SEARCH_DEBOUNCE_MS } from './lens.constants';

/** Debounce for org-selector typeahead — kept in lockstep with the project-selector. */
export const ORG_SELECTOR_DEBOUNCE_MS = NAV_SEARCH_DEBOUNCE_MS;

/** Hard cap on the role-grants `per_page` (spec SC-005b); orgs beyond this fall to no-badge. */
export const ORG_ROLE_GRANTS_HARD_CAP = 500;

/** Page size used by the MOCK_ORG_ITEMS dev branch so the e2e can exercise scroll-pagination. */
export const ORG_SELECTOR_MOCK_PAGE_SIZE = 8;

/** Process-wide LRU cap on uid↔sfid resolver caches (per direction). */
export const ORG_IDENTITY_CACHE_MAX_ENTRIES = 10_000;

/** TTL for uid↔sfid resolver cache entries — org renames are rare so 24h is safe. */
export const ORG_IDENTITY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
