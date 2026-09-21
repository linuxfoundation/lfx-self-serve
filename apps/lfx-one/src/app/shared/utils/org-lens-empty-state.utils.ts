// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ORG_LENS_UNVERIFIABLE_ACCESS_CODES } from '@lfx-one/shared/constants';
import { OrgLensEmptyStateName, OrgLensSectionOutcome } from '@lfx-one/shared/interfaces';

/** Classify a failed section request. */
export function classifySectionError(error: unknown): Exclude<OrgLensSectionOutcome, 'records' | 'empty'> {
  if (!(error instanceof HttpErrorResponse)) {
    return 'failed';
  }
  const body = error.error as { code?: unknown } | null | undefined;
  const code = body && typeof body === 'object' && typeof body.code === 'string' ? body.code : undefined;
  if (code && ORG_LENS_UNVERIFIABLE_ACCESS_CODES.has(code)) {
    return 'unverifiable';
  }
  // FR-015: denial is decided by the stated reason, never by status alone — a 403 without the gate's
  // `FORBIDDEN` code (a proxy page, an unrelated handler) is a load failure, not a permission verdict.
  return code === 'FORBIDDEN' ? 'denied' : 'failed';
}

/** Map a section outcome to the registry state it renders, or `null` when the section has records. */
export function sectionEmptyState(outcome: OrgLensSectionOutcome): OrgLensEmptyStateName | null {
  switch (outcome) {
    case 'empty':
      return 'section-empty';
    case 'failed':
      return 'section-could-not-load';
    case 'denied':
      return 'section-no-access';
    case 'unverifiable':
      return 'section-could-not-verify';
    default:
      return null;
  }
}
