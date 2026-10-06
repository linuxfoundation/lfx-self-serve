// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CAMPAIGN_BID_CONFLICT_MESSAGE,
  CAMPAIGN_BID_DEFINITE_FAILURE_MARKER,
  CAMPAIGN_BID_FAILURE_FALLBACK,
  CAMPAIGN_BID_OUTCOME_UNCONFIRMED,
} from '@lfx-one/shared/constants';
import type { CampaignBidOutcome } from '@lfx-one/shared/interfaces';

import { classifyCampaignWriteFailure } from './campaign-write-error.utils';

/**
 * Classify a failed `PATCH /api/campaigns/:campaignId/bid` for the Optimize tab, through the
 * shared `classifyCampaignWriteFailure`.
 *
 * - **412** is a stale validator: `conflict`, and the operator is told to refresh the list.
 * - Any other **4xx** except 408 is a definite refusal (`failed`, message verbatim), decided before
 *   the wording is read: the neutral 409 says an ad group "could not be confirmed".
 * - **Unconfirmed** is any message that says so (the BFF's `CAMPAIGN_BID_OUTCOME_UNCONFIRMED`, or
 *   campaign-service's "the campaign bid change is unconfirmed ..."), any response that is not the
 *   BFF's `{ error, code }` envelope, and ANY 503 that does not carry campaign-service's definite
 *   "... the campaign was not modified" wording. A 503 is how an unconfirmed bid and an unanswered
 *   gateway both arrive, so only an explicit statement that nothing changed earns `failed`.
 * - Everything else is `failed`, with the server's message VERBATIM: a 400 naming the platform's
 *   floor or ceiling, upstream's neutral 409 about a bidding setup that is not a manual per-click
 *   bid, a provenance or connection 409, a definite 503.
 */
export function campaignBidFailureOutcome(error: unknown): CampaignBidOutcome {
  return classifyCampaignWriteFailure(error, {
    conflict: CAMPAIGN_BID_CONFLICT_MESSAGE,
    unconfirmed: CAMPAIGN_BID_OUTCOME_UNCONFIRMED,
    failureFallback: CAMPAIGN_BID_FAILURE_FALLBACK,
    definiteFailureMarker: CAMPAIGN_BID_DEFINITE_FAILURE_MARKER,
  });
}
