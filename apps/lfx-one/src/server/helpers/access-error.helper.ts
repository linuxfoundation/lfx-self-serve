// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Cursor](https://cursor.com)

import { AccessErrorResult } from '@lfx-one/shared/interfaces';

// Spec 025 — maps upstream member-service settings failures to clean, user-facing
// API errors for the Org Lens Access write endpoints (mirrors key-contact-error.helper.ts).
class AccessErrorMapping {
  public static readonly fallbackMessage = "Couldn't save right now. Please try again.";
  public static readonly notFoundMessage = 'This user no longer has access — it may have already changed. Reload the page to see the current access list.';
  public static readonly conflictMessage = 'This access list was changed elsewhere — reload and try again.';
  public static readonly rawUpstreamNoise = /status\s+\d{3}|errorCode|[A-Za-z_]+__c\/|^\s*[[{]/i;
}

// Split on the first ":" and keep the trimmed message body; reject upstream noise.
function cleanMessage(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const colonIdx = raw.indexOf(':');
  const cleaned = (colonIdx >= 0 ? raw.slice(colonIdx + 1) : raw).trim();
  if (!cleaned || AccessErrorMapping.rawUpstreamNoise.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

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

/** Maps upstream org-access mutation failures to the BFF response envelope. */
export function mapAccessUpstreamError(error: unknown): AccessErrorResult {
  const status = extractStatus(error);
  const rawMessage = extractMessage(error);

  switch (status) {
    case 409:
      // Concurrent modification or business conflict (e.g. last-Admin) — surface as a reload-and-retry.
      return { status: 409, message: cleanMessage(rawMessage, AccessErrorMapping.conflictMessage), conflict: true };
    case 412:
      return { status: 409, message: AccessErrorMapping.conflictMessage, conflict: true };
    case 404:
      return { status: 404, message: AccessErrorMapping.notFoundMessage, conflict: false };
    case 400:
      return { status: 400, message: cleanMessage(rawMessage, 'The request was invalid. Check the details and try again.'), conflict: false };
    // Explicit upstream 5xx range: never echo the raw upstream message — collapse to the generic
    // fallback so server-internal noise can't leak to the client.
    case 500:
    case 502:
    case 503:
    case 504:
      return { status: 502, message: AccessErrorMapping.fallbackMessage, conflict: false };
    default:
      // Pass through unmapped client errors (e.g. 422 validation, 429 rate-limit) with a cleaned
      // message so the failure class isn't misreported as a server error; collapse genuine 5xx and
      // unknown statuses to the generic 502 so server-internal noise can't leak to the client.
      if (typeof status === 'number' && status >= 400 && status < 500) {
        return { status, message: cleanMessage(rawMessage, AccessErrorMapping.fallbackMessage), conflict: false };
      }
      return { status: 502, message: AccessErrorMapping.fallbackMessage, conflict: false };
  }
}
