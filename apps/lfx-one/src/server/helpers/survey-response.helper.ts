// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { QueryServiceResponse, SurveyResponseRecord } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import type { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { logger } from '../services/logger.service';
import { resolveUserIdentity } from '../utils/auth-helper';
import { fetchAllQueryResources } from './query-service.helper';

export interface FetchCurrentUserSurveyResponsesOptions {
  /** Query-service `tags` merged alongside the identity `filters_or` (e.g. `project_uid:` scoping). */
  tags?: string[];
  /** Fail closed on mid-pagination errors — pending-action callers can't risk silently missing a row. */
  failOnPartial?: boolean;
}

/**
 * Identity-resolved unanswered `survey_response` rows for the current user — the single source
 * behind survey pending actions, matched the same way as My Surveys (`survey.service.ts`).
 */
export async function fetchCurrentUserSurveyResponses(
  req: Request,
  proxy: MicroserviceProxyService,
  options: FetchCurrentUserSurveyResponsesOptions = {}
): Promise<SurveyResponseRecord[]> {
  const { email, username } = await resolveUserIdentity(req);

  if (!email && !username) {
    logger.debug(req, 'fetch_current_user_survey_responses', 'No email or username in auth context, skipping survey response fetch');
    return [];
  }

  // Survey rows index the invitee as `email` (not `user_email`); either field identifies the user.
  const filtersOr: string[] = [];
  if (email) {
    filtersOr.push(`email:${email}`);
  }
  if (username) {
    filtersOr.push(`username:${username}`);
  }

  const responses = await fetchAllQueryResources<SurveyResponseRecord>(
    req,
    (pageToken) =>
      proxy.proxyRequest<QueryServiceResponse<SurveyResponseRecord>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'survey_response',
        filters_or: filtersOr,
        ...(options.tags?.length && { tags: options.tags }),
        ...(pageToken && { page_token: pageToken }),
      }),
    { failOnPartial: options.failOnPartial }
  );

  // Unanswered = `response_datetime` empty: the row exists from invitation time and is only
  // stamped on submit (same definition as `getMySurveys`).
  return responses.filter((r) => !r.response_datetime || r.response_datetime.trim() === '');
}
