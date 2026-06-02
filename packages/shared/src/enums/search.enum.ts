// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Relevance tiers for a user search result against a query.
 * Lower values rank higher (sort ascending).
 */
export enum UserSearchRelevance {
  /** Query equals a name field (first, last, or full name). */
  ExactName = 0,
  /** Query is a prefix of a name field. */
  NamePrefix = 1,
  /** Query appears as a substring of the full name. */
  NameSubstring = 2,
  /** Query matches the LFID username. */
  UsernameMatch = 3,
  /** Query matches only the email (incidental for a name search). */
  EmailMatch = 4,
  /** No contiguous match in any searchable field (upstream ngram/alias noise). */
  Incidental = 5,
}
