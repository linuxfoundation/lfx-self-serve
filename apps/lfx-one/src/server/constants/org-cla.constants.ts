// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Maximum concurrent user-service lookups when resolving invalidator display names. */
export const ORG_CLA_INVALIDATOR_LOOKUP_BATCH = 8;

/** Overall time budget for invalidator display lookups on one acknowledgments read. */
export const ORG_CLA_INVALIDATOR_LOOKUP_BUDGET_MS = 3_000;

/** Bounded user-service page size used to require one exact invalidator match. */
export const ORG_CLA_INVALIDATOR_LOOKUP_PAGE_SIZE = 2;
