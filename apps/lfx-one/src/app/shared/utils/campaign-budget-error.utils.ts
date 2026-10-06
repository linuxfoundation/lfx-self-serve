// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  CAMPAIGN_BUDGET_CONFLICT_MESSAGE,
  CAMPAIGN_BUDGET_FAILURE_FALLBACK,
  CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED,
  CAMPAIGN_BUDGET_UNANSWERED_STATUSES,
  ERROR_CODES,
  MAX_PLAIN_TEXT_BODY_LENGTH,
} from '@lfx-one/shared/constants';
import type { CampaignBudgetOutcome } from '@lfx-one/shared/interfaces';

/**
 * Classify a failed `PATCH /api/campaigns/:campaignId/budget` for the Optimize tab.
 *
 * - **412** is a stale validator: `conflict`, and the operator is told to refresh the list.
 * - **Unconfirmed** is any answer whose message says so — the BFF's own
 *   `CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED` for a write nobody answered, or campaign-service's 503
 *   "the campaign budget change is unconfirmed …" — and any transport-shaped failure with no
 *   message at all. The change may already be applied, so it must never read as a plain failure.
 * - Everything else is `failed`, carrying the server's message VERBATIM: a 400 naming a platform
 *   minimum, a 409 (shared budget, pacing mismatch, currency, provenance …), a definite 503.
 *
 * Deliberately not built on `extractErrorMessage` / `serverAuthoredMessage`. Those drop every
 * status-labelled 5xx body and every message over 200 characters, and campaign-service's budget
 * refusals are both: its 409s run long, and its definite-vs-unconfirmed 503s are told apart only
 * by their wording. Dropping either would hide exactly what the operator has to act on.
 */
export function campaignBudgetFailureOutcome(error: unknown): CampaignBudgetOutcome {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  if (status === 412) {
    return { state: 'conflict', message: CAMPAIGN_BUDGET_CONFLICT_MESSAGE };
  }

  const message = error instanceof HttpErrorResponse ? readCampaignWriteErrorMessage(error.error) : undefined;
  if (message !== undefined && isUnconfirmedWriteMessage(message)) {
    return { state: 'unconfirmed', message };
  }
  if (message === undefined && CAMPAIGN_BUDGET_UNANSWERED_STATUSES.has(status)) {
    return { state: 'unconfirmed', message: CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED };
  }
  return { state: 'failed', message: message ?? CAMPAIGN_BUDGET_FAILURE_FALLBACK };
}

/** Whether a status is a definite refusal: a 4xx other than 408 (a timeout says nothing). */
export function isDefiniteRefusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408;
}

/**
 * Whether a message says the outcome is unknown, in the BFF's wording or campaign-service's.
 *
 * Shared by every Optimize-tab write (budget, bid, negative keywords): each BFF unconfirmed
 * constant says "could not be confirmed" (or "could not be read"), and campaign-service's own
 * 503s say "unconfirmed".
 */
export function isUnconfirmedWriteMessage(message: string): boolean {
  if (message === CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED) {
    return true;
  }
  const lower = message.toLowerCase();
  return lower.includes('unconfirmed') || lower.includes('could not be confirmed') || lower.includes('confirmation could not be read');
}

/**
 * The message an error body carries, exactly as written, or `undefined` when it carries none.
 * Shared by the Optimize tab's write classifiers (budget, bid, negative keywords).
 *
 * The BFF answers `{ error, code }` (`BaseApiError.toResponse`); `message` is read too for a body
 * that did not come through that envelope. A `VALIDATION_ERROR` from the BFF's own field checks
 * names the wire key at the top ("Validation failed for budget") and the readable reason in
 * `errors[]`, so the reason is preferred there. A plain-text body is taken only when it reads as
 * one sentence, never a proxy's HTML page or a JSON document.
 */
export function readCampaignWriteErrorMessage(body: unknown): string | undefined {
  if (typeof body === 'string') {
    const text = body.trim();
    if (text === '' || /^[<{[]/.test(text) || text.includes('\n') || text.length > MAX_PLAIN_TEXT_BODY_LENGTH) {
      return undefined;
    }
    return text;
  }
  if (!body || typeof body !== 'object' || body instanceof Error) {
    return undefined;
  }

  const { error, message, code, errors } = body as { error?: unknown; message?: unknown; code?: unknown; errors?: unknown };
  if (code === ERROR_CODES.VALIDATION_ERROR && Array.isArray(errors)) {
    const reason = errors.map((entry) => (entry && typeof entry === 'object' ? (entry as { message?: unknown }).message : undefined)).find(isNonBlank);
    if (reason !== undefined) {
      return reason.trim();
    }
  }
  const top = [error, message].find(isNonBlank);
  return top === undefined ? undefined : top.trim();
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
