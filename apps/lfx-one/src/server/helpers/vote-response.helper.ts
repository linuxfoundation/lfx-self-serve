// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IndexedVoteResponse, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from '../services/logger.service';
import { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { getEffectiveEmail, getUsernameFromAuth, stripAuthPrefix } from '../utils/auth-helper';
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
 * The single identity-keyed current-user `vote_response` row source (GH #2985): every read
 * that resolves "the indexed participation rows of the user behind this request" by identity
 * goes through here so My Votes and Pending Actions can never diverge again. The one
 * current-user read NOT routed here is `VoteService.createVoteResponse`'s post-cast index
 * poll — it matches a known `vote_response_uid` rather than resolving identity, and its
 * `filter_grants` reliance means it can never observe an email-only invitee's just-cast row
 * (a known gap, outside #2985's scope).
 *
 * Identity resolution mirrors the proven My Votes surface exactly: `getUsernameFromAuth`
 * + `stripAuthPrefix` + `getEffectiveEmail`, matched via `filters_or` on
 * `user_email` / `username` (whichever are present — raw email, no lowercasing beyond what
 * `getEffectiveEmail` already applies, matching `getMyVotes` verbatim). Returns `[]` when
 * the request carries neither identity.
 *
 * Deliberately NOT `filter_grants=direct`: the voting service only emits the invitee FGA
 * tuple when the invitee has a non-empty `Username` (upstream contract:
 * https://github.com/linuxfoundation/lfx-v2-voting-service/blob/main/docs/fga-contract.md),
 * so email-only invitees' rows are invisible to grant-based filtering even though they are
 * legitimate pending votes. The query service accepts identity `filters_or` without
 * `filter_grants` (the parameter is optional — `docs/architecture/backend/pagination.md`),
 * and this exact query shape already serves My Votes in production; also observed against
 * the dev query service during #2985.
 */
export async function fetchCurrentUserVoteResponses(
  req: Request,
  proxy: MicroserviceProxyService,
  options: FetchCurrentUserVoteResponsesOptions = {}
): Promise<IndexedVoteResponse[]> {
  const rawUsername = await getUsernameFromAuth(req);
  const username = rawUsername ? stripAuthPrefix(rawUsername) : null;
  const email = getEffectiveEmail(req);

  if (!username && !email) {
    return [];
  }

  logger.debug(req, 'fetch_current_user_vote_responses', 'Fetching vote_response rows for current user', {
    username,
    has_email: !!email,
    has_filters: !!options.filters?.length,
  });

  // vote_response uses 'user_email' not 'email'.
  const filtersOr: string[] = [];
  if (email) filtersOr.push(`user_email:${email}`);
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

  return rows;
}
