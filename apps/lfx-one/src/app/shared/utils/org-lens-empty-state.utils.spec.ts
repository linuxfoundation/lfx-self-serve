// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { classifySectionError, worstSectionOutcome } from './org-lens-empty-state.utils';

describe('worstSectionOutcome', () => {
  it('defaults to records for an empty list', () => {
    expect(worstSectionOutcome([])).toBe('records');
  });

  it('orders outcomes denied > unverifiable > failed > records', () => {
    expect(worstSectionOutcome(['records', 'failed'])).toBe('failed');
    expect(worstSectionOutcome(['records', 'failed', 'unverifiable'])).toBe('unverifiable');
    expect(worstSectionOutcome(['records', 'failed', 'unverifiable', 'denied'])).toBe('denied');
  });

  it('is unaffected by input order', () => {
    expect(worstSectionOutcome(['denied', 'records', 'failed'])).toBe('denied');
    expect(worstSectionOutcome(['failed', 'denied', 'records'])).toBe('denied');
  });

  it('returns records when every pipeline succeeded', () => {
    expect(worstSectionOutcome(['records', 'records', 'records'])).toBe('records');
  });
});

describe('classifySectionError', () => {
  it('classifies a non-HttpErrorResponse as failed', () => {
    expect(classifySectionError(new Error('boom'))).toBe('failed');
  });

  it('classifies a FORBIDDEN-coded error as denied', () => {
    const error = new HttpErrorResponse({ status: 403, error: { code: 'FORBIDDEN' } });
    expect(classifySectionError(error)).toBe('denied');
  });

  it('classifies an unverifiable-access code as unverifiable', () => {
    const error = new HttpErrorResponse({ status: 503, error: { code: 'ROLE_GRANTS_UNAVAILABLE' } });
    expect(classifySectionError(error)).toBe('unverifiable');
  });

  it('classifies a 403 without the FORBIDDEN code as a load failure, not a denial', () => {
    const error = new HttpErrorResponse({ status: 403, error: { code: 'SOME_PROXY_ERROR' } });
    expect(classifySectionError(error)).toBe('failed');
  });
});
