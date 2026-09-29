// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IndexedVoteResponse, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { maskIdentifierForLogs } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from '../services/logger.service';
import { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { getEffectiveEmail, getRawEffectiveEmail, getUsernameFromAuth, stripAuthPrefix } from '../utils/auth-helper';
import { fetchAllQueryResources } from './query-service.helper';

export interface FetchCurrentUserVoteResponsesOptions {
  /**
   * Extra `filters` clauses ANDed server-side against the identity disjunction
   * (e.g. `vote_uid:<uid>` for the single-response drawer read, `project_uid:<uid>`
   * for project-lens scoping).
   */
  filters?: string[];
  /**
   * Forwarded to the paginator. Pass `true` when completeness matters (a truncated
   * page set can silently miss a pending invitation); the caller is expected to
   * catch and degrade.
   */
  failOnPartial?: boolean;
}

/**
 * The single parent-vote keying rule for a `vote_response` row (GH #2985): `vote_uid` is the
 * parent's v2 UID (what `/votes/{uid}` expects) and `poll_id` its v1 alias. `vote_id` is NOT a
 * parent key — it is the response row's own v1 id. `vote_uid` wins when present, with an empty
 * string counting as absent (truthiness, matching the indexer-empty-field guards around it).
 * Shared by every surface that keys rows by parent vote (My Votes, Pending Actions, the
 * single-vote drawer read) so they can never diverge on how a legacy poll_id-only row is keyed.
 */
export function getParentVoteId(r: IndexedVoteResponse): string | undefined {
  return r.vote_uid || r.poll_id;
}

/**
 * The single identity-keyed current-user `vote_response` row source (GH #2985): every read
 * that resolves "the indexed participation rows of the user behind this request" by identity
 * goes through here so My Votes and Pending Actions can never diverge. The one current-user
 * read NOT routed here is `VoteService.createVoteResponse`'s post-cast index poll — it matches
 * a known `vote_response_uid` rather than resolving identity (see the known-gap note there).
 *
 * Identity resolution: `getUsernameFromAuth` + `stripAuthPrefix` + `getEffectiveEmail`, matched
 * via `filters_or` on `user_email` / `username` (whichever are present). The email is queried
 * twice when its raw casing differs from the lowercased effective value: the index stores the
 * invitee email exactly as entered (no upstream normalization) and the query service matches
 * `filters_or` with case-sensitive exact `term` clauses, so a mixed-case stored email only
 * matches its raw casing (GH #2985). The two clauses reproduce only the two casings resolved
 * for the effective identity (the impersonation target's stored email under Admin Mode, else
 * the caller's OIDC `email` claim) — an invitation entered in a THIRD casing is still missed:
 * the query-service contract has no case-insensitive filter operator for this helper to call,
 * so complete coverage needs canonical index-time normalization + reindex, tracked in #3063.
 * Returns `[]` when the request carries neither identity. Every fetched row is re-checked
 * against the resolved identity before being returned (defense in depth — `filters_or` match
 * semantics are upstream's contract); the re-check compares `user_email` case-insensitively
 * (the caller side is already lowercased) and `username` case-sensitively, so an upstream drift
 * toward analyzed matching fails closed on the username side rather than merging case-differing
 * identities. Drops are logged via `dropped_count`.
 *
 * Deliberately NOT `filter_grants=direct`: the voting service only emits the invitee FGA
 * tuple when the invitee has a non-empty `Username` (upstream contract:
 * https://github.com/linuxfoundation/lfx-v2-voting-service/blob/main/docs/fga-contract.md),
 * so email-only invitees' rows are invisible to grant-based filtering even though they are
 * legitimate pending votes. The query service accepts identity `filters_or` without
 * `filter_grants` (the parameter is optional — `docs/architecture/backend/pagination.md`).
 */
export async function fetchCurrentUserVoteResponses(
  req: Request,
  proxy: MicroserviceProxyService,
  options: FetchCurrentUserVoteResponsesOptions = {}
): Promise<IndexedVoteResponse[]> {
  const rawUsername = await getUsernameFromAuth(req);
  const username = rawUsername ? stripAuthPrefix(rawUsername) : null;
  const email = getEffectiveEmail(req);
  const rawEmail = getRawEffectiveEmail(req);

  if (!username && !email) {
    return [];
  }

  logger.debug(req, 'fetch_current_user_vote_responses', 'Fetching vote_response rows for current user', {
    username: maskIdentifierForLogs(username),
    has_email: !!email,
    has_filters: !!options.filters?.length,
  });

  // vote_response uses 'user_email' not 'email'. Two email clauses when the raw casing differs:
  // the query service's `term` clauses are case-sensitive and the index stores the invitee email
  // as entered, so the lowercased value alone can miss a mixed-case stored row (GH #2985).
  const filtersOr: string[] = [];
  if (email) filtersOr.push(`user_email:${email}`);
  if (rawEmail && rawEmail !== email) filtersOr.push(`user_email:${rawEmail}`);
  if (username) filtersOr.push(`username:${username}`);

  const rows = await fetchAllQueryResources<IndexedVoteResponse>(
    req,
    (pageToken) =>
      proxy.proxyRequest<QueryServiceResponse<IndexedVoteResponse>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'vote_response',
        ...(options.filters?.length && { filters: options.filters }),
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      }),
    { failOnPartial: options.failOnPartial }
  );

  logger.debug(req, 'fetch_current_user_vote_responses', 'Fetched vote_response rows', { row_count: rows.length });

  // Defense in depth: re-check each row against the resolved identity rather than trusting the
  // index's `filters_or` match semantics alone (exact-term vs analyzed matching is upstream's
  // contract). `user_email` compares case-insensitively (the caller side is already lowercased);
  // `username` compares case-sensitively — under the current exact-`term` contract the username
  // branch keeps nothing the email branch wouldn't, and if upstream ever drifts to analyzed
  // matching the exact compare fails closed: a case-differing username row is dropped rather
  // than risk merging distinct identities (LFID username case-uniqueness is not a contract this
  // repo can cite). A row that fails this check is not the caller's by definition.
  const ownedRows = rows.filter((r) => (!!email && r.user_email?.toLowerCase() === email) || (!!username && r.username === username));
  if (ownedRows.length < rows.length) {
    logger.debug(req, 'fetch_current_user_vote_responses', 'Dropped rows failing the identity re-check', {
      dropped_count: rows.length - ownedRows.length,
    });
  }

  return ownedRows;
}
