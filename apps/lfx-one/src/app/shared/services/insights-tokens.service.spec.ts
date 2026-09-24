// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InsightsTokensService } from './insights-tokens.service';

describe('InsightsTokensService', () => {
  let service: InsightsTokensService;
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    service = TestBed.inject(InsightsTokensService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('lists tokens from the BFF', async () => {
    http.get.mockReturnValue(of([{ uid: 't-1' }]));

    expect(await firstValueFrom(service.getTokens())).toEqual([{ uid: 't-1' }]);
    expect(http.get).toHaveBeenCalledWith('/api/profile/insights-tokens');
  });

  it('logs and rethrows list errors so the caller can show a retry state', async () => {
    const error = new HttpErrorResponse({ status: 500 });
    http.get.mockReturnValue(throwError(() => error));

    await expect(firstValueFrom(service.getTokens())).rejects.toBe(error);
    expect(console.error).toHaveBeenCalled();
  });

  it('returns eligibility from the BFF', async () => {
    const eligibility = { canCreate: true, orgs: [{ uid: 'org-1', name: 'Acme' }], checkFailed: false };
    http.get.mockReturnValue(of(eligibility));

    expect(await firstValueFrom(service.getEligibility())).toEqual(eligibility);
    expect(http.get).toHaveBeenCalledWith('/api/profile/insights-tokens/eligibility');
  });

  it('fails closed with checkFailed when the eligibility call errors', async () => {
    http.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));

    expect(await firstValueFrom(service.getEligibility())).toEqual({ canCreate: false, orgs: [], checkFailed: true });
    expect(console.error).toHaveBeenCalled();
  });

  it('creates a token by name only', async () => {
    http.post.mockReturnValue(of({ token: { uid: 't-1' }, secret: 'lfi_x' }));

    await firstValueFrom(service.createToken('ci-pipeline'));
    expect(http.post).toHaveBeenCalledWith('/api/profile/insights-tokens', { name: 'ci-pipeline' });
  });

  it('revokes with an encoded uid', async () => {
    http.delete.mockReturnValue(of(undefined));

    await firstValueFrom(service.revokeToken('a/b'));
    expect(http.delete).toHaveBeenCalledWith('/api/profile/insights-tokens/a%2Fb');
  });
});
