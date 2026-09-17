// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgLensClaService } from './org-lens-cla.service';

describe('OrgLensClaService.checkPermission', () => {
  const ORG = '0014100000Te2ovAAB';
  const PROJECT = 'a09410000182dD2AAI';

  let service: OrgLensClaService;
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() };
    http.post.mockReturnValue(of({ allowed: true }));
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    service = TestBed.inject(OrgLensClaService);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
    TestBed.resetTestingModule();
  });

  it('posts the typed action and reads allowed', async () => {
    await expect(firstValueFrom(service.checkPermission(ORG, 'sign', PROJECT))).resolves.toBe(true);

    expect(http.post).toHaveBeenCalledWith(`/api/orgs/${ORG}/lens/cla-groups/permissions/checks`, {
      action: 'sign',
      projectSfid: PROJECT,
    });
  });

  it('fails closed and logs when the hop errors', async () => {
    const error = new Error('timeout');
    http.post.mockReturnValue(throwError(() => error));

    await expect(firstValueFrom(service.checkPermission(ORG, 'approval-list-update', PROJECT))).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledWith('Organization Lens CLA permission check failed', error);
  });
});
