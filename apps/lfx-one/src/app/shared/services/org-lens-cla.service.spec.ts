// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgClaManagerAddRequest } from '@lfx-one/shared/interfaces';

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

describe('OrgLensClaService manager client', () => {
  const ORG = '0014100000Te2ovAAB';
  const SIGNATURE = 'signature-uuid-1';
  const managersBase = `/api/orgs/${encodeURIComponent(ORG)}/lens/cla-groups/${encodeURIComponent(SIGNATURE)}/managers`;

  let service: OrgLensClaService;
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    service = TestBed.inject(OrgLensClaService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('getManagers issues a GET to the managers BFF route', async () => {
    const list = { signatureId: SIGNATURE, managers: [] };
    http.get.mockReturnValue(of(list));

    await expect(firstValueFrom(service.getManagers(ORG, SIGNATURE))).resolves.toEqual(list);
    expect(http.get).toHaveBeenCalledWith(managersBase);
  });

  it('addManager POSTs the add payload to the managers BFF route', async () => {
    const request: OrgClaManagerAddRequest = { firstName: 'Ada', lastName: 'Porter', email: 'ada.porter@example.org' };
    const manager = { lfUsername: 'aporter', name: 'Ada Porter', email: request.email };
    http.post.mockReturnValue(of(manager));

    await expect(firstValueFrom(service.addManager(ORG, SIGNATURE, request))).resolves.toEqual(manager);
    expect(http.post).toHaveBeenCalledWith(managersBase, request);
  });

  it('removeManager DELETEs with an encoded LF username path segment', async () => {
    const lfUsername = 'a+b/c';
    http.delete.mockReturnValue(of(undefined));

    await expect(firstValueFrom(service.removeManager(ORG, SIGNATURE, lfUsername))).resolves.toBeUndefined();
    expect(http.delete).toHaveBeenCalledWith(`${managersBase}/${encodeURIComponent(lfUsername)}`);
  });
});
