// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { UserSearchResult } from '../interfaces';

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
  /** Query matches only the email (incidental for a name search). */
  EmailMatch = 3,
  /** No contiguous match in name or email (upstream ngram/alias noise). */
  Incidental = 4,
}

/** Minimal user shape needed to rank a search result. */
type RankableUser = Pick<UserSearchResult, 'first_name' | 'last_name' | 'email'>;

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Scores a single user against a query. The query is normalized (lowercased,
 * trimmed) internally, so it is safe to call with raw input.
 * Exposed for testing and reuse; callers normally use {@link rankUserSearchResults}.
 */
export function scoreUserSearchResult(user: RankableUser, query: string): UserSearchRelevance {
  const q = normalize(query);
  if (!q) {
    return UserSearchRelevance.Incidental;
  }

  const first = normalize(user.first_name);
  const last = normalize(user.last_name);
  const full = `${first} ${last}`.trim();
  const email = normalize(user.email);

  if (first === q || last === q || full === q) {
    return UserSearchRelevance.ExactName;
  }
  if (first.startsWith(q) || last.startsWith(q) || full.startsWith(q)) {
    return UserSearchRelevance.NamePrefix;
  }
  if (full.includes(q)) {
    return UserSearchRelevance.NameSubstring;
  }
  if (email.includes(q)) {
    return UserSearchRelevance.EmailMatch;
  }
  return UserSearchRelevance.Incidental;
}

/**
 * Re-ranks (and lightly filters) user search results so name matches surface
 * first and incidental email/alias matches are demoted.
 *
 * The upstream query service matches `name` against `name_and_aliases` (which
 * folds in email and uses ngram subfields), so a query like "il" can match
 * inside unrelated emails. This client-side pass mitigates that:
 *
 * - **Name queries** (no `@`): sorted exact > prefix > name-substring >
 *   email-match; results with no contiguous match in name or email are dropped
 *   as upstream noise. Email-only matches are kept but demoted below name hits.
 * - **Email queries** (contains `@`): treated as an explicit email lookup —
 *   nothing is dropped; results are only sorted by email relevance so the
 *   legitimate search is never hidden.
 *
 * Ordering is stable: results within the same tier keep their upstream order.
 */
export function rankUserSearchResults<T extends RankableUser>(results: T[], query: string): T[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return results;
  }

  const isEmailQuery = normalizedQuery.includes('@');

  const scored = results.map((result, index) => ({
    result,
    index,
    score: scoreUserSearchResult(result, normalizedQuery),
  }));

  // For name queries, drop pure-incidental matches (ngram/alias noise). For
  // email queries, keep everything — the user is searching by email on purpose.
  const retained = isEmailQuery ? scored : scored.filter((entry) => entry.score !== UserSearchRelevance.Incidental);

  return retained.sort((a, b) => (a.score === b.score ? a.index - b.index : a.score - b.score)).map((entry) => entry.result);
}
