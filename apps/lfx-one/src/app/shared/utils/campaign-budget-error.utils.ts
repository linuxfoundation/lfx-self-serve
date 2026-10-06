// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CAMPAIGN_BUDGET_CONFLICT_MESSAGE, CAMPAIGN_BUDGET_FAILURE_FALLBACK, CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED } from '@lfx-one/shared/constants';
import type { CampaignBudgetOutcome } from '@lfx-one/shared/interfaces';

import { classifyCampaignWriteFailure } from './campaign-write-error.utils';

/**
 * Classify a failed `PATCH /api/campaigns/:campaignId/budget` for the Optimize tab, through the
 * shared `classifyCampaignWriteFailure`.
 *
 * - **412** is a stale validator: `conflict`, and the operator is told to refresh the list.
 * - Any other **4xx** except 408 is a definite refusal, its message VERBATIM: a 400 naming a
 *   platform minimum, a 409 (shared budget, pacing mismatch, currency, provenance …).
 * - **Unconfirmed** is any message that says so — the BFF's own `CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED`
 *   for a write nobody answered, or campaign-service's 503 "the campaign budget change is
 *   unconfirmed …" — and any response that is not the BFF's `{ error, code }` envelope (a lost
 *   connection, a proxy's timeout text, a gateway's HTML page). The change may already be applied,
 *   so it must never read as a plain failure.
 * - Everything else is `failed`, with the BFF's message verbatim (a definite 503).
 */
export function campaignBudgetFailureOutcome(error: unknown): CampaignBudgetOutcome {
  return classifyCampaignWriteFailure(error, {
    conflict: CAMPAIGN_BUDGET_CONFLICT_MESSAGE,
    unconfirmed: CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED,
    failureFallback: CAMPAIGN_BUDGET_FAILURE_FALLBACK,
  });
}
