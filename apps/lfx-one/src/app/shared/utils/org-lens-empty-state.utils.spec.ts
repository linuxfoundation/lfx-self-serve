// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { classifySectionError, sectionEmptyState } from './org-lens-empty-state.utils';

function httpError(status: number, body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body });
}

// FR-015: denial is decided by the gate's stated refusal code, never by HTTP status alone. This is the
// #2090 regression class — "a broken access lookup must never read as a plain access denial" — at the
// section boundary, so every cell below is one a status-only classifier would get wrong.
describe('classifySectionError', () => {
  it('reads an explicit FORBIDDEN refusal as denied', () => {
    expect(classifySectionError(httpError(403, { code: 'FORBIDDEN' }))).toBe('denied');
  });

  it('reads a 403 without the gate code as a load failure, not a permission verdict', () => {
    expect(classifySectionError(httpError(403, {}))).toBe('failed');
    expect(classifySectionError(httpError(403, '<html>proxy page</html>'))).toBe('failed');
    expect(classifySectionError(httpError(403, { code: 'SOMETHING_ELSE' }))).toBe('failed');
  });

  it('reads the gate\u2019s "could not check" codes as unverifiable whatever the status', () => {
    expect(classifySectionError(httpError(503, { code: 'ROLE_GRANTS_UNAVAILABLE' }))).toBe('unverifiable');
    expect(classifySectionError(httpError(503, { code: 'ACCESS_CHECK_UNAVAILABLE' }))).toBe('unverifiable');
    // The code wins over a status that would otherwise suggest a denial.
    expect(classifySectionError(httpError(403, { code: 'ROLE_GRANTS_UNAVAILABLE' }))).toBe('unverifiable');
  });

  it('does not let inherited object keys pass as refusal codes', () => {
    expect(classifySectionError(httpError(500, { code: 'constructor' }))).toBe('failed');
    expect(classifySectionError(httpError(500, { code: 'toString' }))).toBe('failed');
  });

  it('reads anything that is not an HTTP response as a load failure', () => {
    expect(classifySectionError(new Error('network'))).toBe('failed');
    expect(classifySectionError(undefined)).toBe('failed');
  });
});

describe('sectionEmptyState', () => {
  it('maps each non-records outcome to its registry state and records to none', () => {
    expect(sectionEmptyState('records')).toBeNull();
    expect(sectionEmptyState('empty')).toBe('section-empty');
    expect(sectionEmptyState('failed')).toBe('section-could-not-load');
    expect(sectionEmptyState('denied')).toBe('section-no-access');
    expect(sectionEmptyState('unverifiable')).toBe('section-could-not-verify');
  });
});
