// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES,
  KEYWORD_TARGETING_READ_ERROR_MESSAGES,
  KEYWORD_TARGETING_REMOVAL_ERROR_DETAILS,
  KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES,
  KEYWORD_TARGETING_REMOVAL_FAILED_FALLBACK,
  KEYWORD_TARGETING_REMOVAL_OUTCOME_LABELS,
  KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE,
  KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE,
  KEYWORD_TARGETING_X_MATCH_LABELS,
} from '@lfx-one/shared/constants';
import type {
  CampaignServiceKeywordTargeting,
  CampaignServiceKeywordTargetingRemovalResult,
  CampaignServiceKeywordTargetingRemovals,
  KeywordTargetingListItem,
  KeywordTargetingPlatform,
  KeywordTargetingRemovalBatchOutcome,
  KeywordTargetingRemovalOutcomeRow,
} from '@lfx-one/shared/interfaces';

import { isBffErrorEnvelope } from './campaign-write-error.utils';

/**
 * The targeting read as the panel lists it. Reddit keywords are named by their text, exactly as
 * read (upstream compares a removal verbatim, case and whitespace included). An X keyword is named
 * by its criterion id; one the read gave no id cannot be removed, so it is listed without a handle.
 */
export function keywordTargetingListItems(targeting: CampaignServiceKeywordTargeting | null): KeywordTargetingListItem[] {
  if (!targeting || !Array.isArray(targeting.keywords)) {
    return [];
  }
  const isX = targeting.platform === 'twitter-ads';
  return targeting.keywords
    .filter((entry) => entry && typeof entry.keyword === 'string')
    .map((entry, index) => {
      if (isX) {
        const criterionId = typeof entry.criterion_id === 'string' && entry.criterion_id !== '' ? entry.criterion_id : null;
        const matchType = typeof entry.match_type === 'string' ? entry.match_type : '';
        return {
          key: criterionId ?? `unaddressable-${index}`,
          keyword: entry.keyword,
          matchLabel: Object.hasOwn(KEYWORD_TARGETING_X_MATCH_LABELS, matchType) ? KEYWORD_TARGETING_X_MATCH_LABELS[matchType] : matchType,
          removalItem: criterionId !== null ? { criterionId } : null,
        };
      }
      return { key: entry.keyword, keyword: entry.keyword, matchLabel: '', removalItem: { keyword: entry.keyword } };
    });
}

/**
 * Join each SENT keyword to the removal result at the same index. Positional by contract
 * (`results[i]` answers `keywords[i]`; the BFF refuses a response that cannot be read that way), so
 * nothing here matches by text. A missing entry, or an outcome this UI does not know, is UNCONFIRMED
 * at its own position: the request reached the platform, so "not removed" cannot be claimed.
 */
export function keywordTargetingRemovalOutcomeRows(
  sent: readonly string[],
  response: CampaignServiceKeywordTargetingRemovals | null | undefined
): KeywordTargetingRemovalOutcomeRow[] {
  const results: unknown[] = Array.isArray(response?.results) ? response.results : [];
  return sent.map((keyword, index) => {
    const entry = results[index] as Partial<CampaignServiceKeywordTargetingRemovalResult> | null | undefined;
    const outcome =
      typeof entry?.outcome === 'string' && Object.hasOwn(KEYWORD_TARGETING_REMOVAL_OUTCOME_LABELS, entry.outcome) ? entry.outcome : 'UNCONFIRMED';
    let detail = '';
    if (outcome === 'UNCONFIRMED') {
      detail = KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE;
    } else if (outcome === 'FAILED') {
      const code = typeof entry?.error_code === 'string' ? entry.error_code : '';
      detail = Object.hasOwn(KEYWORD_TARGETING_REMOVAL_ERROR_DETAILS, code)
        ? KEYWORD_TARGETING_REMOVAL_ERROR_DETAILS[code]
        : KEYWORD_TARGETING_REMOVAL_FAILED_FALLBACK;
    }
    return { index, keyword, outcome, label: KEYWORD_TARGETING_REMOVAL_OUTCOME_LABELS[outcome], detail };
  });
}

/** "2 removed, 1 not confirmed." — counts only, in outcome order, with the reload advice when any is unconfirmed. */
export function summarizeKeywordTargetingRemovals(rows: readonly KeywordTargetingRemovalOutcomeRow[]): string {
  const parts = (Object.keys(KEYWORD_TARGETING_REMOVAL_OUTCOME_LABELS) as KeywordTargetingRemovalOutcomeRow['outcome'][])
    .map((outcome) => ({ outcome, count: rows.filter((row) => row.outcome === outcome).length }))
    .filter(({ count }) => count > 0)
    .map(({ outcome, count }) => `${count} ${KEYWORD_TARGETING_REMOVAL_OUTCOME_LABELS[outcome].toLowerCase()}`);
  if (parts.length === 0) {
    return '';
  }
  const summary = parts.join(', ') + '.';
  return rows.some((row) => row.outcome === 'UNCONFIRMED') ? `${summary} ${KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE}` : summary;
}

/**
 * Classify a removal that produced no per-keyword results, in FIXED words: no upstream text is
 * shown, whatever the body says.
 *
 * - `failed` ONLY for a documented refusal (`KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES`: 400, 401,
 *   403, 404, 409) in the BFF's `{ error, code }` envelope, worded by status. Nothing was removed.
 * - `unconfirmed` for everything else: the BFF's `KEYWORD_TARGETING_REMOVAL_UNCONFIRMED` code, any
 *   5xx (a definite-sounding 503 included: a removal is irreversible, and the UI does not read
 *   wording to decide), a timeout, a lost connection, or a body that is not the BFF's envelope.
 *   Any of the keywords may have been removed.
 */
export function classifyKeywordTargetingRemovalFailure(error: unknown, platform: KeywordTargetingPlatform): KeywordTargetingRemovalBatchOutcome {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  const body: unknown = error instanceof HttpErrorResponse ? error.error : undefined;
  const definite =
    isBffErrorEnvelope(body) &&
    (body as { code: string }).code !== KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE &&
    KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES.has(status);
  if (!definite) {
    return { state: 'unconfirmed', message: KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE };
  }
  const messages = KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES;
  let message = messages.forbidden;
  if (status === 409) {
    message = messages.conflict;
  } else if (status === 400) {
    message = platform === 'reddit-ads' ? messages.refusedReddit : messages.refused;
  } else if (status === 404) {
    message = messages.notFound;
  }
  return { state: 'failed', message };
}

/** The targeting read's failure in fixed words, by status. Upstream text is never shown. */
export function keywordTargetingReadErrorMessage(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  const messages = KEYWORD_TARGETING_READ_ERROR_MESSAGES;
  if (status === 409) {
    return messages.conflict;
  }
  if (status === 503) {
    return messages.unavailable;
  }
  if (status === 400) {
    return messages.refused;
  }
  if (status === 401 || status === 403) {
    return messages.forbidden;
  }
  return messages.other;
}
