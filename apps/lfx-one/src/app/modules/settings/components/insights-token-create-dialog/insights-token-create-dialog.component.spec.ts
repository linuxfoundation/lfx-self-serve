// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR, INSIGHTS_TOKEN_ERROR_MESSAGES } from '@lfx-one/shared/constants';
import { InsightsTokensService } from '@services/insights-tokens.service';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InsightsTokenCreateDialogComponent } from './insights-token-create-dialog.component';

describe('InsightsTokenCreateDialogComponent', () => {
  let service: { createToken: ReturnType<typeof vi.fn> };
  let dialogRef: { close: ReturnType<typeof vi.fn> };
  let component: InsightsTokenCreateDialogComponent;

  const upstreamError = (upstreamCode?: string): HttpErrorResponse => new HttpErrorResponse({ status: 409, error: { upstreamCode } });

  beforeEach(() => {
    service = { createToken: vi.fn() };
    dialogRef = { close: vi.fn() };
    TestBed.configureTestingModule({
      imports: [InsightsTokenCreateDialogComponent],
      providers: [
        { provide: InsightsTokensService, useValue: service },
        { provide: DynamicDialogRef, useValue: dialogRef },
      ],
    });
    TestBed.overrideComponent(InsightsTokenCreateDialogComponent, { set: { template: '', imports: [] } });
    component = TestBed.createComponent(InsightsTokenCreateDialogComponent).componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('only allows submitting a non-blank name', () => {
    expect(component['canSubmit']()).toBe(false);
    component['form'].controls.name.setValue('   ');
    expect(component['canSubmit']()).toBe(false);
    component['form'].controls.name.setValue('ci-pipeline');
    expect(component['canSubmit']()).toBe(true);
  });

  it('counts the name in code points, like the server, so 100 emoji fit and 101 do not', () => {
    component['form'].controls.name.setValue('😀'.repeat(100));
    expect(component['tooLong']()).toBe(false);
    expect(component['canSubmit']()).toBe(true);
    expect(component['form'].valid).toBe(true);

    component['form'].controls.name.setValue('😀'.repeat(101));
    expect(component['tooLong']()).toBe(true);
    expect(component['canSubmit']()).toBe(false);
    expect(component['form'].controls.name.hasError('maxCodePoints')).toBe(true);
  });

  it('creates with the trimmed name and closes with the response', () => {
    const created = { token: { uid: 't-1' }, secret: 'lfi_x' };
    service.createToken.mockReturnValue(of(created));
    component['form'].controls.name.setValue('  ci-pipeline  ');

    component['submit']();

    expect(service.createToken).toHaveBeenCalledWith('ci-pipeline');
    expect(dialogRef.close).toHaveBeenCalledWith(created);
  });

  it.each(['token_name_taken', 'token_limit_reached', 'not_key_contact', 'eligibility_unavailable'] as const)(
    'maps upstream code %s to its inline message',
    (code) => {
      service.createToken.mockReturnValue(throwError(() => upstreamError(code)));
      component['form'].controls.name.setValue('ci-pipeline');

      component['submit']();

      expect(component['errorMessage']()).toBe(INSIGHTS_TOKEN_ERROR_MESSAGES[code]);
      expect(component['submitting']()).toBe(false);
      expect(dialogRef.close).not.toHaveBeenCalled();
    }
  );

  it.each(['toString', '__proto__', 'constructor'])('falls back for inherited key %s instead of mapping it', (code) => {
    service.createToken.mockReturnValue(throwError(() => upstreamError(code)));
    component['form'].controls.name.setValue('ci-pipeline');

    component['submit']();

    expect(component['errorMessage']()).toBe(INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR);
  });

  it('blocks a name with a control character and explains why', () => {
    component['form'].controls.name.setValue('weekly\treport');

    expect(component['hasControlCharacters']()).toBe(true);
    expect(component['canSubmit']()).toBe(false);
    expect(component['nameDescribedBy']()).toBe('insights-token-name-control');
  });

  it("shows the BFF's name-validation reason instead of the generic message", () => {
    const reason = 'Token name must be 1-100 characters with no control characters';
    const validationError = new HttpErrorResponse({
      status: 400,
      error: { error: 'Validation failed for name', code: 'VALIDATION_ERROR', errors: [{ field: 'name', message: reason, code: 'FIELD_VALIDATION_ERROR' }] },
    });
    service.createToken.mockReturnValue(throwError(() => validationError));
    component['form'].controls.name.setValue('ci-pipeline');

    component['submit']();

    expect(component['errorMessage']()).toBe(reason);
  });

  it('falls back to a generic message for unknown errors and clears it on typing', () => {
    service.createToken.mockReturnValue(throwError(() => upstreamError()));
    component['form'].controls.name.setValue('ci-pipeline');

    component['submit']();
    expect(component['errorMessage']()).toBe(INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR);

    component['form'].controls.name.setValue('ci-pipeline-2');
    expect(component['errorMessage']()).toBeNull();
  });
});
