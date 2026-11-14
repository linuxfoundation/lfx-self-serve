// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  META_AD_SET_CONFLICT_MESSAGE,
  META_AD_SET_FAILURE_FALLBACK,
  META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE,
  META_AD_SET_PRE_SEND_REFUSAL_STATUSES,
  META_AD_SET_UNCONFIRMED_MESSAGE,
} from '@lfx-one/shared/constants';
import type { CampaignBudgetOutcome } from '@lfx-one/shared/interfaces';

import { classifyCampaignWriteFailure, isBffErrorEnvelope } from './campaign-write-error.utils';

/**
 * Classify a failed `POST /api/campaigns/:id/meta-ad-sets/:adSetId/status`, through the shared
 * `classifyCampaignWriteFailure` so the ad-set lever cannot drift from the budget and bid levers:
 *
 * - **412** in the BFF's envelope: `conflict` — the campaign changed since it was loaded and
 *   nothing was changed.
 * - Any other **4xx** in the envelope (a **409** included): `failed`, the BFF's message verbatim.
 *   campaign-service's 409s name the remedy ("pause it here first", "activate it in Meta Ads
 *   Manager", "the status WAS changed on Meta, but ...").
 * - An outcome nobody could confirm — `META_AD_SET_STATUS_UNCONFIRMED`, a response that is not the
 *   BFF's envelope (no answer, a gateway page) — is `unconfirmed`, stated in this UI's words: may
 *   or may not have been applied, reload to verify. The one exception keeps the BFF's own sentence:
 *   `META_AD_SET_PAUSE_RECORD_UNCONFIRMED`, where Meta's status is known and only the
 *   deliberate-pause RECORD is in doubt.
 * - Everything else (a definite 503 saying nothing was changed) is `failed`, verbatim.
 */
export function metaAdSetFailureOutcome(error: unknown): CampaignBudgetOutcome {
  const outcome = classifyCampaignWriteFailure(error, {
    conflict: META_AD_SET_CONFLICT_MESSAGE,
    unconfirmed: META_AD_SET_UNCONFIRMED_MESSAGE,
    failureFallback: META_AD_SET_FAILURE_FALLBACK,
  });
  if (outcome.state !== 'unconfirmed') {
    return outcome;
  }
  const body: unknown = error instanceof HttpErrorResponse ? error.error : undefined;
  const recordOnly = isBffErrorEnvelope(body) && (body as { code: string }).code === META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE;
  return { state: 'unconfirmed', message: recordOnly ? outcome.message : META_AD_SET_UNCONFIRMED_MESSAGE };
}

/**
 * Whether a failed ad-set write leaves the campaign row's version KNOWN, so the validator the row
 * already holds is still the one to send. Only two kinds of answer prove that:
 *
 * - a **412** in the BFF's envelope — a stale validator is refused before anything is sent;
 * - a **pre-send refusal** in the BFF's envelope — 400 (malformed), 401/403 (not allowed), 404 (no
 *   campaign or connection), 422 and 428 (no validator) are all answered before campaign-service
 *   takes the write lock.
 *
 * Everything else may have bumped the version: an unconfirmed outcome, a **409** (one says the
 * status WAS changed on Meta while the row moved; others settle or withdraw the deliberate-pause
 * record), a definite **503** (some settle the record after Meta's answer), any 5xx, and any
 * response that is not the BFF's envelope. Those leave the validator unknown.
 */
export function metaAdSetWriteLeftValidatorKnown(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || !isBffErrorEnvelope(error.error)) {
    return false;
  }
  return error.status === 412 || META_AD_SET_PRE_SEND_REFUSAL_STATUSES.has(error.status);
}
