// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Page size for `/query/resources` paginated reads. The query service defaults to
 * 50 and caps at 1000 (lfx-v2-query-service design/types.go); 500 keeps the page
 * count low without sitting at the upstream maximum.
 */
export const QUERY_SERVICE_PAGE_SIZE = 500;
