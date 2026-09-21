// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';

/**
 * Spec 053 — outcome of one section request, classified for the shared empty state (FR-014/FR-015).
 *
 * `denied` vs `unverifiable` is decided by the refusal's stated `code`, never by status alone: the
 * Org Lens read gate answers 403 `FORBIDDEN` when the caller lacks access and 503
 * `ROLE_GRANTS_UNAVAILABLE` when it could not check — and the second must never read as the first.
 */
export type OrgLensSectionOutcome = 'records' | 'empty' | 'denied' | 'unverifiable' | 'failed';

const UNVERIFIABLE_CODES: Record<string, true> = { ROLE_GRANTS_UNAVAILABLE: true, ACCESS_CHECK_UNAVAILABLE: true };

/** Classify a failed section request. */
export function classifySectionError(error: unknown): Exclude<OrgLensSectionOutcome, 'records' | 'empty'> {
  if (!(error instanceof HttpErrorResponse)) {
    return 'failed';
  }
  const body = error.error as { code?: unknown } | null | undefined;
  const code = body && typeof body === 'object' && typeof body.code === 'string' ? body.code : undefined;
  if (code && UNVERIFIABLE_CODES[code]) {
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
