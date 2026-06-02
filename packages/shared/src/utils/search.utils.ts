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
  /** Query matches the LFID username. */
  UsernameMatch = 3,
  /** Query matches only the email (incidental for a name search). */
  EmailMatch = 4,
  /** No contiguous match in any searchable field (upstream ngram/alias noise). */
  Incidental = 5,
}

/** Minimal user shape needed to rank a search result. */
type RankableUser = Pick<UserSearchResult, 'first_name' | 'last_name' | 'email' | 'username'>;

/**
 * Default cap on ranked results handed to a typeahead. Demoted upstream
 * ngram/alias noise sorts to the bottom and falls off this limit, while real
 * matches (which sort first) survive. Pass `{ limit: Infinity }` to opt out.
 */
const DEFAULT_RESULT_LIMIT = 10;

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
  const username = normalize(user.username);
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
  if (username.includes(q)) {
    return UserSearchRelevance.UsernameMatch;
  }
  if (email.includes(q)) {
    return UserSearchRelevance.EmailMatch;
  }
  return UserSearchRelevance.Incidental;
}

/**
 * Re-ranks user search results so name matches surface first and incidental
 * email/alias matches are demoted.
 *
 * The upstream query service matches `name` against `name_and_aliases` (which
 * folds in email and uses ngram subfields), so a query like "il" can match
 * inside unrelated emails. This client-side pass mitigates that by sorting
 * exact > name-prefix > name-substring > username > email > incidental.
 *
 * It **demotes** rather than drops: low-relevance rows sort to the bottom and
 * fall off `limit`, so real matches always win the visible slots — but a
 * legitimate hit on an upstream alias the client can't see (a field outside
 * name/username/email) is never hard-filtered out. Email queries (containing
 * `@`) need no special case: name fields won't match, so genuine email hits
 * naturally rank above the rest.
 *
 * Ordering is stable: results within the same tier keep their upstream order.
 *
 * @param results Upstream results to rank.
 * @param query  Raw user query (normalized internally).
 * @param options.limit Max results to return; defaults to {@link DEFAULT_RESULT_LIMIT}.
 *   Pass `Infinity` to return every ranked result.
 */
export function rankUserSearchResults<T extends RankableUser>(results: T[], query: string, options?: { limit?: number }): T[] {
  const q = normalize(query);
  if (!q) {
    return results;
  }

  const limit = options?.limit ?? DEFAULT_RESULT_LIMIT;

  const ranked = results
    .map((result, index) => ({ result, index, score: scoreUserSearchResult(result, q) }))
    .sort((a, b) => (a.score === b.score ? a.index - b.index : a.score - b.score))
    .map((entry) => entry.result);

  return ranked.slice(0, limit);
}
