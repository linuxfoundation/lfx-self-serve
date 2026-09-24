// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR, INSIGHTS_TOKEN_ERROR_MESSAGES } from '@lfx-one/shared/constants';
import { InsightsTokensService } from '@services/insights-tokens.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
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
        { provide: DynamicDialogConfig, useValue: { data: { orgName: 'Acme' } } },
      ],
    });
    TestBed.overrideComponent(InsightsTokenCreateDialogComponent, { set: { template: '', imports: [] } });
    component = TestBed.createComponent(InsightsTokenCreateDialogComponent).componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('reads the org name from dialog data', () => {
    expect(component['orgName']).toBe('Acme');
  });

  it('only allows submitting a non-blank name', () => {
    expect(component['canSubmit']()).toBe(false);
    component['form'].controls.name.setValue('   ');
    expect(component['canSubmit']()).toBe(false);
    component['form'].controls.name.setValue('ci-pipeline');
    expect(component['canSubmit']()).toBe(true);
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

  it('falls back to a generic message for unknown errors and clears it on typing', () => {
    service.createToken.mockReturnValue(throwError(() => upstreamError()));
    component['form'].controls.name.setValue('ci-pipeline');

    component['submit']();
    expect(component['errorMessage']()).toBe(INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR);

    component['form'].controls.name.setValue('ci-pipeline-2');
    expect(component['errorMessage']()).toBeNull();
  });
});
