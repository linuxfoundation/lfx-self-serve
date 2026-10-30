// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Account, OrgLensOrgScope } from '@lfx-one/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountContextService } from './account-context.service';
import { OrgLensOrgScopeService } from './org-lens-org-scope.service';

const scope = (accountId: string): OrgLensOrgScope => ({
  accountId,
  hasInsightsOrg: true,
  insightsOrgId: `insights-${accountId}`,
  insightsOrgName: `Org ${accountId}`,
  relatedOrgCount: 3,
});
const account = (uid: string): Account => ({ accountId: uid, accountName: uid, membershipTier: '', uid, slug: uid });

// Runs the account signal's effect, then lets the stream it feeds settle.
const flush = async (): Promise<void> => {
  TestBed.tick();
  await vi.waitFor(() => undefined);
};

describe('OrgLensOrgScopeService', () => {
  let service: OrgLensOrgScopeService;
  let http: HttpTestingController;
  let selectedAccount: WritableSignal<Account>;

  beforeEach(() => {
    selectedAccount = signal(account(''));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: AccountContextService, useValue: { selectedAccount } }],
    });
    service = TestBed.inject(OrgLensOrgScopeService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('reads an account once and serves later reads from cache', async () => {
    const first = firstValueFrom(service.getOrgScope('org-1'));
    http.expectOne('/api/orgs/org-1/lens/org-scope').flush(scope('org-1'));
    await expect(first).resolves.toEqual(scope('org-1'));

    await expect(firstValueFrom(service.getOrgScope('org-1'))).resolves.toEqual(scope('org-1'));
    http.expectNone('/api/orgs/org-1/lens/org-scope');
  });

  it('reads each account apart', async () => {
    const one = firstValueFrom(service.getOrgScope('org-1'));
    const two = firstValueFrom(service.getOrgScope('org-2'));
    http.expectOne('/api/orgs/org-1/lens/org-scope').flush(scope('org-1'));
    http.expectOne('/api/orgs/org-2/lens/org-scope').flush(scope('org-2'));

    await expect(one).resolves.toEqual(scope('org-1'));
    await expect(two).resolves.toEqual(scope('org-2'));
  });

  it('answers null for a failed read and asks again next time', async () => {
    const failed = firstValueFrom(service.getOrgScope('org-1'));
    http.expectOne('/api/orgs/org-1/lens/org-scope').flush('boom', { status: 500, statusText: 'Server Error' });
    await expect(failed).resolves.toBeNull();

    const retried = firstValueFrom(service.getOrgScope('org-1'));
    http.expectOne('/api/orgs/org-1/lens/org-scope').flush(scope('org-1'));
    await expect(retried).resolves.toEqual(scope('org-1'));
  });

  it('follows the selected account in current, requesting nothing without one', async () => {
    expect(service.current()).toBeNull();
    await flush();
    http.expectNone(() => true);

    selectedAccount.set(account('org-1'));
    await flush();
    http.expectOne('/api/orgs/org-1/lens/org-scope').flush(scope('org-1'));
    expect(service.current()).toEqual(scope('org-1'));

    selectedAccount.set(account('org-2'));
    await flush();
    http.expectOne('/api/orgs/org-2/lens/org-scope').flush(scope('org-2'));
    expect(service.current()).toEqual(scope('org-2'));

    selectedAccount.set(account('org-1'));
    await flush();
    http.expectNone('/api/orgs/org-1/lens/org-scope');
    expect(service.current()).toEqual(scope('org-1'));
  });

  it('clears current while a newly selected account loads, so the previous account never shows', async () => {
    selectedAccount.set(account('org-1'));
    await flush();
    http.expectOne('/api/orgs/org-1/lens/org-scope').flush({ ...scope('org-1'), hasInsightsOrg: false });
    expect(service.current()?.hasInsightsOrg).toBe(false);

    selectedAccount.set(account('org-2'));
    await flush();
    const pending = http.expectOne('/api/orgs/org-2/lens/org-scope');
    expect(service.current()).toBeNull();

    pending.flush(scope('org-2'));
    expect(service.current()).toEqual(scope('org-2'));
  });

  it('recovers current after a failed read when a picker asks, without an account switch', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    selectedAccount.set(account('org-1'));
    await flush();
    http.expectOne('/api/orgs/org-1/lens/org-scope').flush('boom', { status: 500, statusText: 'Server Error' });
    expect(service.current()).toBeNull();
    expect(error).toHaveBeenCalled();

    service.retryFailedRead();
    await flush();
    http.expectOne('/api/orgs/org-1/lens/org-scope').flush(scope('org-1'));
    expect(service.current()).toEqual(scope('org-1'));

    // A later retry after a successful read asks nothing.
    service.retryFailedRead();
    await flush();
    http.expectNone('/api/orgs/org-1/lens/org-scope');
    expect(service.current()).toEqual(scope('org-1'));
    error.mockRestore();
  });
});
