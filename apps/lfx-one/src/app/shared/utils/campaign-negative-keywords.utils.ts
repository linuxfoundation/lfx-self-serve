// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS,
  CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES,
  CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE,
  CAMPAIGN_NEGATIVE_KEYWORDS_FAILURE_FALLBACK,
  CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
  CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNKNOWN,
  KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES,
} from '@lfx-one/shared/constants';
import type {
  CampaignNegativeKeywordMatchType,
  CampaignNegativeKeywordOutcome,
  CampaignNegativeKeywordOutcomeRow,
  CampaignNegativeKeywordResult,
  CampaignNegativeKeywordsBatchOutcome,
  CampaignNegativeKeywordsResult,
  NegativeKeywordCampaignPlatform,
} from '@lfx-one/shared/interfaces';

import { classifyCampaignWriteFailure } from './campaign-write-error.utils';

/**
 * Join each SENT negative keyword to the result at the same index.
 *
 * Positional by contract (`results[i]` answers `negativeKeywords[i]`, and the BFF never filters or
 * reorders them), so nothing here matches by text. An entry that is missing, or carries an outcome
 * this UI does not know, is UNCONFIRMED at its own position: the request reached the platform, so
 * "not added" cannot be claimed for it.
 */
export function negativeKeywordOutcomeRows(
  sent: readonly string[],
  matchType: CampaignNegativeKeywordMatchType,
  response: CampaignNegativeKeywordsResult | null | undefined,
  platform: NegativeKeywordCampaignPlatform = 'microsoft-ads'
): CampaignNegativeKeywordOutcomeRow[] {
  const results: unknown[] = Array.isArray(response?.results) ? response.results : [];
  return sent.map((text, index) => {
    const entry = results[index] as Partial<CampaignNegativeKeywordResult> | null | undefined;
    const outcome =
      typeof entry?.outcome === 'string' && Object.hasOwn(CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS, entry.outcome) ? entry.outcome : 'UNCONFIRMED';
    let detail = '';
    if (outcome === 'UNCONFIRMED') {
      detail = negativeKeywordUnconfirmedAdvice(platform);
    } else if (outcome === 'FAILED') {
      detail = negativeKeywordFailedDetail(platform, entry?.errorCode);
    }
    return { index, text, matchType, outcome, label: CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS[outcome], detail };
  });
}

/** What an UNCONFIRMED negative keyword tells the operator to do, naming the platform to check. */
export function negativeKeywordUnconfirmedAdvice(platform: NegativeKeywordCampaignPlatform = 'microsoft-ads'): string {
  if (platform === 'microsoft-ads') {
    return CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE;
  }
  return `This keyword may or may not have been added. Check the campaign's negative keywords in ${CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES[platform].label} before retrying.`;
}

/**
 * Why a FAILED negative keyword was not added. Microsoft names its own machine-readable code.
 * Reddit and X answer only NOT_SENT or REJECTED (campaign-service never returns their text), so
 * those are worded here; any other code is not shown, since it is wire data with no meaning here.
 */
function negativeKeywordFailedDetail(platform: NegativeKeywordCampaignPlatform, errorCode: unknown): string {
  const label = CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES[platform].label;
  const code = typeof errorCode === 'string' ? errorCode : '';
  if (platform === 'microsoft-ads') {
    return code !== '' ? `Microsoft Advertising error ${code}.` : 'Microsoft Advertising did not add it.';
  }
  if (code === 'NOT_SENT') {
    return `It was not sent to ${label}, so nothing changed.`;
  }
  if (code === 'REJECTED') {
    return `${label} refused it.`;
  }
  return `${label} did not add it.`;
}

/**
 * Classify a failed `POST /api/campaigns/:campaignId/negative-keywords`, which carries no
 * per-keyword results. No validator is sent, so there is no `conflict` state.
 *
 * - `failed` ONLY for a documented refusal (`KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES`: 400, 401,
 *   403, 404, 409) in the BFF's `{ error, code }` envelope, shown with the server's message: nothing
 *   was added.
 * - `unconfirmed` for everything else. The shared `classifyCampaignWriteFailure` already says so for
 *   a body that is not the BFF's envelope and for a message saying "unconfirmed" (keeping that
 *   message). Any OTHER failure it would call definite (a 5xx, a definite-sounding 503 included, a
 *   408, a 429) is unconfirmed here too, with `CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNKNOWN`: the add
 *   was dispatched, and any of the keywords may have been added.
 */
export function campaignNegativeKeywordsFailureOutcome(error: unknown): CampaignNegativeKeywordsBatchOutcome {
  const outcome = classifyCampaignWriteFailure(error, {
    unconfirmed: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
    failureFallback: CAMPAIGN_NEGATIVE_KEYWORDS_FAILURE_FALLBACK,
  });
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  if (outcome.state === 'failed' && !KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES.has(status)) {
    return { state: 'unconfirmed', message: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNKNOWN };
  }
  return outcome;
}

/**
 * "2 added, 1 already present, 1 not confirmed" for one request, in outcome order. Counts of
 * keywords only. When any keyword is unconfirmed the verify-first advice is appended, because the
 * summary is what the toast carries past the editor.
 */
export function summarizeNegativeKeywordOutcomes(
  rows: readonly CampaignNegativeKeywordOutcomeRow[],
  platform: NegativeKeywordCampaignPlatform = 'microsoft-ads'
): string {
  const parts = (Object.keys(CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS) as CampaignNegativeKeywordOutcome[])
    .map((outcome) => ({ outcome, count: rows.filter((row) => row.outcome === outcome).length }))
    .filter(({ count }) => count > 0)
    .map(({ outcome, count }) => `${count} ${CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS[outcome].toLowerCase()}`);
  if (parts.length === 0) {
    return '';
  }
  const summary = parts.join(', ') + '.';
  return rows.some((row) => row.outcome === 'UNCONFIRMED') ? `${summary} ${negativeKeywordUnconfirmedAdvice(platform)}` : summary;
}

/**
 * The key one campaign's negative-keyword request is held under: (project, brief, campaign), so a
 * request can never render against another project's or brief's campaign. The separator cannot
 * occur in a project slug, a brief id or a campaign id.
 */
export function campaignNegativeKeywordsKey(projectSlug: string, briefId: string, campaignId: string): string {
  return `${projectSlug}|${briefId}|${campaignId}`;
}
