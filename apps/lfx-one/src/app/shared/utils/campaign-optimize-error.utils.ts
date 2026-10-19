// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  CAMPAIGN_ACT_RESOLVE_FAILED_MESSAGE,
  CAMPAIGN_ACT_RESOLVE_INVALID_ID_MESSAGE,
  CAMPAIGN_ACT_RESOLVE_UNAVAILABLE_MESSAGE,
  CAMPAIGN_ADOPT_FAILURE_COPY,
  CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED,
  CAMPAIGN_ADOPT_UNCONFIRMED_TITLE,
  CAMPAIGN_SETTINGS_READ_CONFLICT_FALLBACK,
  CAMPAIGN_SETTINGS_READ_ERRORS,
  CAMPAIGN_SETTINGS_READ_FALLBACK,
} from '@lfx-one/shared/constants';
import type { CampaignAdoptFailure } from '@lfx-one/shared/interfaces';

import { classifyCampaignWriteFailure, isBffErrorEnvelope, readCampaignWriteErrorMessage } from './campaign-write-error.utils';

/**
 * What the live-settings drawer says when the readback fails. Mapped by status to a fixed sentence,
 * except a 409, whose reasons (unprovisioned, another ad account, unknown provenance, an unusable
 * connection) only campaign-service's own sentence tells apart; that sentence is taken only from the
 * BFF's `{ error, code }` envelope, never from a proxy's page.
 */
export function campaignSettingsReadErrorMessage(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  const body: unknown = error instanceof HttpErrorResponse ? error.error : undefined;
  if (status === 409) {
    return (isBffErrorEnvelope(body) ? readCampaignWriteErrorMessage(body) : undefined) ?? CAMPAIGN_SETTINGS_READ_CONFLICT_FALLBACK;
  }
  return Object.prototype.hasOwnProperty.call(CAMPAIGN_SETTINGS_READ_ERRORS, status) ? CAMPAIGN_SETTINGS_READ_ERRORS[status] : CAMPAIGN_SETTINGS_READ_FALLBACK;
}

/**
 * What the act dialog says when the campaign-ref resolve fails. A 404 is the BFF's own "route not
 * served here" (the resolve answers an unowned id with a 200 and no matches, never a 404).
 */
export function campaignActResolveErrorMessage(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  if (status === 404) {
    return CAMPAIGN_ACT_RESOLVE_UNAVAILABLE_MESSAGE;
  }
  if (status === 400) {
    return CAMPAIGN_ACT_RESOLVE_INVALID_ID_MESSAGE;
  }
  return CAMPAIGN_ACT_RESOLVE_FAILED_MESSAGE;
}

/**
 * Classify a failed `POST /api/campaigns/adopt` for the adopt dialog.
 *
 * Whether the adoption may have been recorded is decided by the shared `classifyCampaignWriteFailure`,
 * as for every other campaign write: a definite refusal only in the BFF's envelope, and anything
 * nobody answered (`CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED`, a proxy's page, no response) `unconfirmed`.
 * A definite refusal is then mapped by status to `CAMPAIGN_ADOPT_FAILURE_COPY`, so each documented
 * answer (400 malformed or unapproved, 404 proven absent, 409 slot taken / bound elsewhere / foreign
 * account / no usable connection, 503 not verifiable) says what to do next. A 400 or 409 also keeps
 * campaign-service's own sentence as `detail`, because only it says WHICH of those reasons applied.
 */
export function campaignAdoptFailure(error: unknown, platformLabel: string): CampaignAdoptFailure {
  const outcome = classifyCampaignWriteFailure(error, {
    unconfirmed: CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED,
    failureFallback: CAMPAIGN_ADOPT_FAILURE_COPY.default.message,
  });
  if (outcome.state === 'unconfirmed') {
    return { state: 'unconfirmed', title: CAMPAIGN_ADOPT_UNCONFIRMED_TITLE, message: outcome.message, detail: '' };
  }

  const status = error instanceof HttpErrorResponse ? error.status : 0;
  const key = String(status);
  const copy =
    key === '400' || key === '403' || key === '404' || key === '409' || key === '503' ? CAMPAIGN_ADOPT_FAILURE_COPY[key] : CAMPAIGN_ADOPT_FAILURE_COPY.default;
  const message = copy.message.replaceAll('{platform}', platformLabel);
  const detail = (key === '400' || key === '409') && outcome.message !== CAMPAIGN_ADOPT_FAILURE_COPY.default.message ? outcome.message : '';
  return { state: 'failed', title: copy.title, message, detail };
}
