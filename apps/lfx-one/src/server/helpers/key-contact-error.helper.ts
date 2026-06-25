// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { KeyContactErrorResult } from '@lfx-one/shared/interfaces';

/** Maps upstream key-contact failures to clean user-facing API errors. */
class KeyContactErrorMapping {
  public static readonly fallbackMessage = "Couldn't save right now. Please try again.";
  public static readonly notFoundMessage = 'This contact no longer exists — it may have already been removed. Reload the page to see the current contacts.';
  public static readonly rawUpstreamNoise = /status\s+\d{3}|errorCode|[A-Za-z_]+__c\/|^\s*[[{]/i;
}

// Legacy FR-014 parity: split on first ":" and keep the trimmed message body.
function cleanMessage(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const colonIdx = raw.indexOf(':');
  const cleaned = (colonIdx >= 0 ? raw.slice(colonIdx + 1) : raw).trim();
  // Reject only when the post-colon text still looks like upstream noise.
  if (!cleaned || KeyContactErrorMapping.rawUpstreamNoise.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

/** Extracts a numeric status from MicroserviceError-like values when available. */
function extractStatus(error: unknown): number | undefined {
  const candidate = (error as { statusCode?: unknown; status?: unknown } | null | undefined) ?? undefined;
  if (candidate && typeof candidate.statusCode === 'number') return candidate.statusCode;
  if (candidate && typeof candidate.status === 'number') return candidate.status;
  return undefined;
}

function extractMessage(error: unknown): string | undefined {
  const candidate = error as { message?: unknown } | null | undefined;
  return candidate && typeof candidate.message === 'string' ? candidate.message : undefined;
}

/** Maps upstream key-contact mutation failures to the BFF response envelope. */
export function mapKeyContactUpstreamError(error: unknown): KeyContactErrorResult {
  const status = extractStatus(error);
  const rawMessage = extractMessage(error);

  switch (status) {
    case 409:
      return {
        status: 409,
        message: cleanMessage(rawMessage, 'A conflicting contact or capacity limit was reached.'),
        conflict: false,
      };
    case 412:
      return {
        status: 409,
        message: 'This contact was changed elsewhere — reload and try again.',
        conflict: true,
      };
    case 404:
      return {
        status: 404,
        message: KeyContactErrorMapping.notFoundMessage,
        conflict: false,
      };
    case 400:
      return {
        status: 400,
        message: cleanMessage(rawMessage, 'The request was invalid. Check the contact details and try again.'),
        conflict: false,
      };
    // Explicit upstream 5xx range: never echo the raw upstream message — collapse
    // to the generic fallback so server-internal noise can't leak to the client.
    case 500:
    case 502:
    case 503:
    case 504:
      return { status: 502, message: KeyContactErrorMapping.fallbackMessage, conflict: false };
    default:
      return { status: 502, message: KeyContactErrorMapping.fallbackMessage, conflict: false };
  }
}
