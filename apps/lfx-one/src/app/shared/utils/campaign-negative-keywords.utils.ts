// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS,
  CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE,
  CAMPAIGN_NEGATIVE_KEYWORDS_FAILURE_FALLBACK,
  CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
} from '@lfx-one/shared/constants';
import type {
  CampaignNegativeKeywordMatchType,
  CampaignNegativeKeywordOutcome,
  CampaignNegativeKeywordOutcomeRow,
  CampaignNegativeKeywordResult,
  CampaignNegativeKeywordsBatchOutcome,
  CampaignNegativeKeywordsResult,
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
  response: CampaignNegativeKeywordsResult | null | undefined
): CampaignNegativeKeywordOutcomeRow[] {
  const results: unknown[] = Array.isArray(response?.results) ? response.results : [];
  return sent.map((text, index) => {
    const entry = results[index] as Partial<CampaignNegativeKeywordResult> | null | undefined;
    const outcome =
      typeof entry?.outcome === 'string' && Object.hasOwn(CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS, entry.outcome) ? entry.outcome : 'UNCONFIRMED';
    let detail = '';
    if (outcome === 'UNCONFIRMED') {
      detail = CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE;
    } else if (outcome === 'FAILED') {
      detail =
        typeof entry?.errorCode === 'string' && entry.errorCode !== ''
          ? `Microsoft Advertising error ${entry.errorCode}.`
          : 'Microsoft Advertising did not add it.';
    }
    return { index, text, matchType, outcome, label: CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS[outcome], detail };
  });
}

/**
 * Classify a failed `POST /api/campaigns/:campaignId/negative-keywords`, which carries no
 * per-keyword results, through the shared `classifyCampaignWriteFailure`. No validator is sent, so
 * there is no `conflict` state.
 *
 * - Any **4xx** except 408 in the BFF's `{ error, code }` envelope was refused before anything was
 *   added, whatever its wording says. A 4xx without the envelope came from a proxy: `unconfirmed`.
 * - **Unconfirmed**: a message saying so (the BFF's `CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED`
 *   for a confirmation it could not read, or campaign-service's "the negative keywords are
 *   unconfirmed ..."), or any response that is not the BFF's `{ error, code }` envelope (a lost
 *   connection, a proxy's timeout text, a gateway's HTML page). Any of the keywords may have been
 *   added.
 * - Everything else is `failed`, with the server's message VERBATIM (a definite 503).
 */
export function campaignNegativeKeywordsFailureOutcome(error: unknown): CampaignNegativeKeywordsBatchOutcome {
  return classifyCampaignWriteFailure(error, {
    unconfirmed: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
    failureFallback: CAMPAIGN_NEGATIVE_KEYWORDS_FAILURE_FALLBACK,
  });
}

/**
 * "2 added, 1 already present, 1 not confirmed" for one request, in outcome order. Counts of
 * keywords only. When any keyword is unconfirmed the verify-first advice is appended, because the
 * summary is what the toast carries past the editor.
 */
export function summarizeNegativeKeywordOutcomes(rows: readonly CampaignNegativeKeywordOutcomeRow[]): string {
  const parts = (Object.keys(CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS) as CampaignNegativeKeywordOutcome[])
    .map((outcome) => ({ outcome, count: rows.filter((row) => row.outcome === outcome).length }))
    .filter(({ count }) => count > 0)
    .map(({ outcome, count }) => `${count} ${CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS[outcome].toLowerCase()}`);
  if (parts.length === 0) {
    return '';
  }
  const summary = parts.join(', ') + '.';
  return rows.some((row) => row.outcome === 'UNCONFIRMED') ? `${summary} ${CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE}` : summary;
}
