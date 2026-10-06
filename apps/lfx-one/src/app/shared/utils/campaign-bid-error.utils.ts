// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  CAMPAIGN_BID_CONFLICT_MESSAGE,
  CAMPAIGN_BID_DEFINITE_FAILURE_MARKER,
  CAMPAIGN_BID_FAILURE_FALLBACK,
  CAMPAIGN_BID_OUTCOME_UNCONFIRMED,
  CAMPAIGN_BUDGET_UNANSWERED_STATUSES,
} from '@lfx-one/shared/constants';
import type { CampaignBidOutcome } from '@lfx-one/shared/interfaces';

import { isDefiniteRefusal, isUnconfirmedWriteMessage, readCampaignWriteErrorMessage } from './campaign-budget-error.utils';

/**
 * Classify a failed `PATCH /api/campaigns/:campaignId/bid` for the Optimize tab.
 *
 * - **412** is a stale validator: `conflict`, and the operator is told to refresh the list.
 * - Any other **4xx** except 408 is a definite refusal (`failed`, message verbatim), decided before
 *   the wording is read: the neutral 409 says an ad group "could not be confirmed".
 * - **Unconfirmed** is any message that says so (the BFF's `CAMPAIGN_BID_OUTCOME_UNCONFIRMED`, or
 *   campaign-service's "the campaign bid change is unconfirmed ..."), any message-less
 *   transport-shaped failure, and ANY 503 that does not carry campaign-service's definite
 *   "... the campaign was not modified" wording. A 503 is how an unconfirmed bid and an unanswered
 *   gateway both arrive, so only an explicit statement that nothing changed earns `failed`.
 * - Everything else is `failed`, with the server's message VERBATIM: a 400 naming the platform's
 *   floor or ceiling, upstream's neutral 409 about a bidding setup that is not a manual per-click
 *   bid, a provenance or connection 409, a definite 503.
 */
export function campaignBidFailureOutcome(error: unknown): CampaignBidOutcome {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  if (status === 412) {
    return { state: 'conflict', message: CAMPAIGN_BID_CONFLICT_MESSAGE };
  }

  const message = error instanceof HttpErrorResponse ? readCampaignWriteErrorMessage(error.error) : undefined;
  // A 4xx other than 408 is a definite refusal, read before any wording: upstream's neutral 409
  // itself says an ad group "could not be confirmed", and that is not an unconfirmed WRITE.
  if (isDefiniteRefusal(status)) {
    return { state: 'failed', message: message ?? CAMPAIGN_BID_FAILURE_FALLBACK };
  }
  if (message !== undefined && isUnconfirmedWriteMessage(message)) {
    return { state: 'unconfirmed', message };
  }
  if (status === 503 && !(message ?? '').toLowerCase().includes(CAMPAIGN_BID_DEFINITE_FAILURE_MARKER)) {
    return { state: 'unconfirmed', message: CAMPAIGN_BID_OUTCOME_UNCONFIRMED };
  }
  if (message === undefined && CAMPAIGN_BUDGET_UNANSWERED_STATUSES.has(status)) {
    return { state: 'unconfirmed', message: CAMPAIGN_BID_OUTCOME_UNCONFIRMED };
  }
  return { state: 'failed', message: message ?? CAMPAIGN_BID_FAILURE_FALLBACK };
}
