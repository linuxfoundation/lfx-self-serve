// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_AUDIENCE_ERROR_KIND_BY_CODE, PLATFORM_AUDIENCE_ERROR_MESSAGES } from '@lfx-one/shared/constants';
import type { PlatformAudienceErrorKind } from '@lfx-one/shared/interfaces';

import { isBffErrorEnvelope } from './campaign-write-error.utils';

/**
 * Why a per-platform audience read failed, decided on the BFF's `code` and never on the status
 * alone: a bare 404 is also what a route switched off by a server flag answers, and calling that
 * "no connection" would send the operator to fix a connection that is fine.
 *
 * A response that is not the BFF's envelope (no answer at all, a gateway's 502/503/504 page) is
 * `unavailable` — worth retrying in a moment — and anything else is `failed`.
 */
export function platformAudienceErrorKind(error: unknown): PlatformAudienceErrorKind {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  const body: unknown = error instanceof HttpErrorResponse ? error.error : undefined;
  if (isBffErrorEnvelope(body)) {
    const code = (body as { code: string }).code;
    return Object.prototype.hasOwnProperty.call(PLATFORM_AUDIENCE_ERROR_KIND_BY_CODE, code) ? PLATFORM_AUDIENCE_ERROR_KIND_BY_CODE[code] : 'failed';
  }
  return status === 0 || status === 502 || status === 503 || status === 504 ? 'unavailable' : 'failed';
}

/** The panel's sentence for a failure kind, naming the platform. */
export function platformAudienceErrorMessage(kind: PlatformAudienceErrorKind, platformLabel: string): string {
  return PLATFORM_AUDIENCE_ERROR_MESSAGES[kind].split('{platform}').join(platformLabel);
}
