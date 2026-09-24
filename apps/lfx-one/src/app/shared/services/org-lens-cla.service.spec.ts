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

describe('OrgLensClaService acknowledgment client', () => {
  const ORG = '0014100000Te2ovAAB';
  const SIGNATURE = 'signature-uuid-1';
  const acknowledgmentsBase = `/api/orgs/${encodeURIComponent(ORG)}/lens/cla-groups/${encodeURIComponent(SIGNATURE)}/acknowledgments`;

  let service: OrgLensClaService;
  let http: { post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { post: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    service = TestBed.inject(OrgLensClaService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('invalidateAcknowledgment POSTs to the encoded invalidate path', async () => {
    const acknowledgmentSignatureId = 'ack id/with chars';
    const request = { reason: 'other' as const };
    const receipt = { signatureId: acknowledgmentSignatureId };
    http.post.mockReturnValue(of(receipt));

    await expect(firstValueFrom(service.invalidateAcknowledgment(ORG, SIGNATURE, acknowledgmentSignatureId, request))).resolves.toEqual(receipt);
    expect(http.post).toHaveBeenCalledWith(`${acknowledgmentsBase}/${encodeURIComponent(acknowledgmentSignatureId)}/invalidate`, request);
  });
});

describe('OrgLensClaService activity log client', () => {
  const ORG = '0014100000Te2ovAAB';
  const SIGNATURE = 'signature-uuid-1';
  const activityBase = `/api/orgs/${encodeURIComponent(ORG)}/lens/cla-groups/${encodeURIComponent(SIGNATURE)}/activity`;

  let service: OrgLensClaService;
  let http: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { get: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    service = TestBed.inject(OrgLensClaService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('getActivityLog GETs the encoded activity path with no query params by default', async () => {
    const emptyPage = { signatureId: SIGNATURE, list: [], resultCount: 0, nextKey: null };
    http.get.mockReturnValue(of(emptyPage));

    await expect(firstValueFrom(service.getActivityLog(ORG, SIGNATURE))).resolves.toEqual(emptyPage);
    const [url, opts] = http.get.mock.calls[0];
    expect(url).toBe(activityBase);
    expect((opts?.params as { keys(): string[] } | undefined)?.keys() ?? []).toEqual([]);
  });

  it('getActivityLog forwards pageSize and nextKey as query params when supplied', async () => {
    const emptyPage = { signatureId: SIGNATURE, list: [], resultCount: 0, nextKey: null };
    http.get.mockReturnValue(of(emptyPage));

    await firstValueFrom(service.getActivityLog(ORG, SIGNATURE, { pageSize: 25, nextKey: 'cursor-page-2' }));

    const [url, opts] = http.get.mock.calls[0];
    expect(url).toBe(activityBase);
    const params = opts?.params as { get(name: string): string | null };
    expect(params.get('pageSize')).toBe('25');
    expect(params.get('nextKey')).toBe('cursor-page-2');
  });
});

describe('OrgLensClaService.setAutoCreateEcla', () => {
  const ORG = '0014100000Te2ovAAB';
  const SIGNATURE = 'signature-uuid-1';
  const url = `/api/orgs/${encodeURIComponent(ORG)}/lens/cla-groups/${encodeURIComponent(SIGNATURE)}/ecla-auto-create`;

  let service: OrgLensClaService;
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: http }] });
    service = TestBed.inject(OrgLensClaService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('PUTs the target state to the Auto ECLA BFF route on enable', async () => {
    http.put.mockReturnValue(of({ autoCreateEcla: true }));

    await expect(firstValueFrom(service.setAutoCreateEcla(ORG, SIGNATURE, true))).resolves.toEqual({ autoCreateEcla: true });
    expect(http.put).toHaveBeenCalledWith(url, { autoCreateEcla: true });
  });

  it('PUTs false explicitly rather than omitting the key, so the producer cannot read the request as no-change', async () => {
    http.put.mockReturnValue(of({ autoCreateEcla: false }));

    await firstValueFrom(service.setAutoCreateEcla(ORG, SIGNATURE, false));

    expect(http.put).toHaveBeenCalledWith(url, { autoCreateEcla: false });
  });
});
