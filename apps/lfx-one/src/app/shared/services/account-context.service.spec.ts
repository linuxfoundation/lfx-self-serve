// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Account } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountContextService } from './account-context.service';
import { AnalyticsService } from './analytics.service';
import { CookieRegistryService } from './cookie-registry.service';
import { FeatureFlagService } from './feature-flag.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

// Spec 050: the organization a `/org/{segment}/…` address names is adopted by the path-param guard
// before the persona refresh re-seeds organizations. That re-seed runs `initializeUserOrganizations`
// again — with empty seeds for a staff viewer — and used to reset the selection to the placeholder
// or a seed, i.e. the silent substitution deep links exist to remove (#2713 review).
describe('AccountContextService — address-adopted selection', () => {
  const UID_A = '0014100000MgaAAAAA';
  const UID_B = '0014100000MgbBBBBB';
  const seedA: Account = { accountId: UID_A, accountName: 'Alpha', accountSlug: '', membershipTier: '', uid: UID_A };
  const addressedB: Account = { accountId: UID_B, accountName: 'Bravo', accountSlug: '', membershipTier: '', uid: UID_B, slug: 'bravo-llc' };

  let cookies: Map<string, string>;
  let service: AccountContextService;

  beforeEach(() => {
    cookies = new Map();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SsrCookieService,
          useValue: {
            get: (key: string) => cookies.get(key) ?? '',
            set: (key: string, value: string) => cookies.set(key, value),
            delete: (key: string) => cookies.delete(key),
          },
        },
        { provide: CookieRegistryService, useValue: { registerCookie: vi.fn() } },
        { provide: AnalyticsService, useValue: { getOrgLensAccountContext: vi.fn().mockReturnValue(of([])) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn().mockReturnValue(signal(false)) } },
        { provide: OrgRoleGrantsService, useValue: { writerSet: signal(new Set()), auditorSet: signal(new Set()), isStaff: signal(false) } },
        { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of(null)) } },
      ],
    });
    service = TestBed.inject(AccountContextService);
  });

  it('survives a staff re-seed with no organizations, which otherwise resets to the placeholder', () => {
    service.adoptFromAddress(addressedB);
    service.initializeUserOrganizations([]);

    expect(service.selectedAccount()).toEqual(addressedB);
    expect(service.isAddressedSelection()).toBe(true);
    expect(service.selectedUrlSegment()).toBe('bravo-llc');
  });

  it('survives a re-seed that does not contain the addressed organization, keeping the resolved record (name, slug)', () => {
    service.adoptFromAddress(addressedB);
    service.initializeUserOrganizations([seedA]);

    expect(service.selectedAccount()).toEqual(addressedB);
    // The seeds still feed the selector rows.
    expect(service.availableAccounts()).toEqual([seedA]);
  });

  it('is released when the user switches to another organization, so seeding behaves as before', () => {
    service.adoptFromAddress(addressedB);
    service.setAccount(seedA);

    expect(service.isAddressedSelection()).toBe(false);
    service.initializeUserOrganizations([]);
    expect(service.selectedAccount().uid).toBeUndefined();
  });

  it('is released by clearAccount', () => {
    service.adoptFromAddress(addressedB);
    service.clearAccount();
    expect(service.isAddressedSelection()).toBe(false);
  });

  it('is not claimed by a plain setAccount, so a cookie-restored selection still defers to seeding', () => {
    service.setAccount(addressedB);
    expect(service.isAddressedSelection()).toBe(false);

    service.initializeUserOrganizations([]);
    expect(service.selectedAccount().uid).toBeUndefined();
  });
});
