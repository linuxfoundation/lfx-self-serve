// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { CAMPAIGN_BUDGET_UNANSWERED_STATUSES, ERROR_CODES, MAX_PLAIN_TEXT_BODY_LENGTH } from '@lfx-one/shared/constants';
import type { CampaignBudgetOutcome, CampaignNegativeKeywordsBatchOutcome, CampaignWriteFailureMessages } from '@lfx-one/shared/interfaces';

/**
 * Classify a failed Optimize-tab write (budget, bid, negative keywords). The ONE place the
 * failed-vs-unconfirmed decision is made, so the three levers cannot drift apart.
 *
 * In order:
 * 1. **412** in the BFF's envelope, with a `conflict` message: the row's validator is stale
 *    (`conflict`).
 * 2. Any other **4xx** except 408, in the BFF's envelope: a definite refusal (`failed`, message
 *    verbatim), decided before the wording is read — upstream's neutral bid 409 itself says
 *    something "could not be confirmed".
 * 3. A message that says the outcome is unknown (the BFF's unconfirmed constants, or
 *    campaign-service's "... is unconfirmed" 503s): `unconfirmed`, keeping its words.
 * 4. A body that is NOT the BFF's own JSON `{ error, code }` envelope: `unconfirmed`. The BFF
 *    answers every error through that envelope, so anything else — no answer at all (status 0), a
 *    proxy's "upstream request timeout" or "Bad Gateway" text, an HTML error page, a proxy's plain
 *    400/403/409/412, a 2xx that could not be parsed — came from something in front of it, and the
 *    write may already have applied. Steps 1 and 2 are gated on the envelope for this reason: a
 *    status alone does not prove the BFF refused the write.
 * 5. With `definiteFailureMarker`, a 503 whose message lacks it: `unconfirmed`.
 * 6. Everything else is `failed`, with the BFF's message verbatim (a definite 503, a BFF 500).
 */
export function classifyCampaignWriteFailure(error: unknown, messages: CampaignWriteFailureMessages & { conflict: string }): CampaignBudgetOutcome;
export function classifyCampaignWriteFailure(
  error: unknown,
  messages: CampaignWriteFailureMessages & { conflict?: undefined }
): CampaignNegativeKeywordsBatchOutcome;
export function classifyCampaignWriteFailure(error: unknown, messages: CampaignWriteFailureMessages): CampaignBudgetOutcome {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  const body: unknown = error instanceof HttpErrorResponse ? error.error : undefined;
  const fromBff = isBffErrorEnvelope(body);
  if (status === 412 && fromBff && messages.conflict !== undefined) {
    return { state: 'conflict', message: messages.conflict };
  }

  const message = readCampaignWriteErrorMessage(body);
  if (isDefiniteRefusal(status) && fromBff) {
    return { state: 'failed', message: message ?? messages.failureFallback };
  }
  if (message !== undefined && isUnconfirmedWriteMessage(message)) {
    return { state: 'unconfirmed', message };
  }
  if (!fromBff) {
    return { state: 'unconfirmed', message: messages.unconfirmed };
  }
  if (messages.definiteFailureMarker !== undefined && status === 503 && !(message ?? '').toLowerCase().includes(messages.definiteFailureMarker)) {
    return { state: 'unconfirmed', message: messages.unconfirmed };
  }
  if (message === undefined && CAMPAIGN_BUDGET_UNANSWERED_STATUSES.has(status)) {
    return { state: 'unconfirmed', message: messages.unconfirmed };
  }
  return { state: 'failed', message: message ?? messages.failureFallback };
}

/** Whether a status is a definite refusal: a 4xx other than 408 (a timeout says nothing). */
export function isDefiniteRefusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408;
}

/**
 * Whether a body is the BFF's own error envelope (`BaseApiError.toResponse` / `apiErrorHandler`):
 * a JSON object carrying a string `error` and a string `code`. Only that envelope can say a write
 * definitely failed; a body without it was written by a proxy or gateway in front of the BFF.
 */
export function isBffErrorEnvelope(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body instanceof Error) {
    return false;
  }
  const { error, code } = body as { error?: unknown; code?: unknown };
  return typeof error === 'string' && typeof code === 'string' && code.trim() !== '';
}

/**
 * Whether a message says the outcome is unknown, in the BFF's wording or campaign-service's.
 *
 * Each BFF unconfirmed constant says "could not be confirmed" (or "could not be read"), and
 * campaign-service's own 503s say "unconfirmed".
 */
export function isUnconfirmedWriteMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('unconfirmed') || lower.includes('could not be confirmed') || lower.includes('confirmation could not be read');
}

/**
 * The message an error body carries, exactly as written, or `undefined` when it carries none.
 *
 * The BFF answers `{ error, code }` (`BaseApiError.toResponse`); `message` is read too for a body
 * that did not come through that envelope. A `VALIDATION_ERROR` from the BFF's own field checks
 * names the wire key at the top ("Validation failed for budget") and the readable reason in
 * `errors[]`, so the reason is preferred there. A plain-text body is taken only when it reads as
 * one sentence, never a proxy's HTML page or a JSON document.
 *
 * Deliberately not built on `extractErrorMessage` / `serverAuthoredMessage`. Those drop every
 * status-labelled 5xx body and every message over 200 characters, and campaign-service's write
 * refusals are both: its 409s run long, and its definite-vs-unconfirmed 503s are told apart only
 * by their wording.
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
