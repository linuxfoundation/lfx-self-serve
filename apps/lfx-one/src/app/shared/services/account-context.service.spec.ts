// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Account, OrgCanonicalRecord } from '@lfx-one/shared/interfaces';
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

  // Spec 050: addresses resolve against the index, and member-service runs ahead of it during lag —
  // so the canonical record never touches the URL slug: not over an indexed value, not over an
  // indexed null, not into a gap, and not even to unset a disagreeing one (the resolver — the index —
  // would hand it straight back on the next navigation).
  describe('canonical record and the URL slug', () => {
    const canonicalOf = (slug: string | null | undefined): OrgCanonicalRecord => ({ uid: UID_B, accountId: UID_B, name: 'Bravo', slug }) as OrgCanonicalRecord;
    const http = (): { get: ReturnType<typeof vi.fn> } => TestBed.inject(HttpClient) as unknown as { get: ReturnType<typeof vi.fn> };

    it('keeps the indexed slug when the canonical record agrees', async () => {
      service.adoptFromAddress(addressedB);
      http().get.mockReturnValue(of(canonicalOf('bravo-llc')));

      await service.refreshCanonicalRecord(addressedB);

      expect(service.selectedAccount().slug).toBe('bravo-llc');
      expect(service.selectedUrlSegment()).toBe('bravo-llc');
    });

    it.each([
      ['another slug (a rename in flight)', 'bravo-renamed'],
      ['no slug (the slug was removed)', null],
      ['the same slug in another case', 'Bravo-LLC'],
    ])('keeps the indexed slug when the canonical record carries %s', async (_label, slug) => {
      service.adoptFromAddress(addressedB);
      http().get.mockReturnValue(of(canonicalOf(slug)));

      await service.refreshCanonicalRecord(addressedB);

      expect(service.selectedAccount().slug).toBe('bravo-llc');
      expect(service.selectedUrlSegment()).toBe('bravo-llc');
    });

    it('keeps an indexed null (SFID address) when the canonical record has a slug the index does not yet', async () => {
      service.adoptFromAddress({ ...addressedB, slug: null });
      http().get.mockReturnValue(of(canonicalOf('bravo-llc')));

      await service.refreshCanonicalRecord({ ...addressedB, slug: null });

      expect(service.selectedAccount().slug).toBeNull();
      expect(service.selectedUrlSegment()).toBe(UID_B);
    });

    // Spec 021 FR-009: the Org Profile rename hook patches display fields; the URL slug still waits
    // for the index (forgetting the old one would not help — the next resolve hands it straight back).
    it.each([
      ['a renamed slug', 'bravo-renamed'],
      ['the same slug in another case', 'Bravo-LLC'],
      ['no slug field', undefined],
    ])('does not change the URL slug from the Org Profile edit hook carrying %s', (_label, slug) => {
      service.adoptFromAddress(addressedB);

      service.updateCanonicalRecord({ ...canonicalOf(slug), name: 'Bravo Renamed' });

      expect(service.selectedAccount().accountName).toBe('Bravo Renamed');
      expect(service.selectedUrlSegment()).toBe('bravo-llc');
    });

    // A slug-only patch from the org list must not rebuild the selection from the Snowflake row:
    // a name the canonical record has since patched (a rename not yet in Snowflake) would flip back.
    it('setIndexedSlug keeps display fields the canonical record patched', async () => {
      service.initializeUserOrganizations([{ ...addressedB, accountName: 'Bravo (Snowflake)' }]);
      service.adoptFromAddress(addressedB);
      http().get.mockReturnValue(of({ ...canonicalOf('bravo-llc'), name: 'Bravo Renamed' }));
      await service.refreshCanonicalRecord(addressedB);
      expect(service.selectedAccount().accountName).toBe('Bravo Renamed');

      service.setIndexedSlug('bravo-llc-2');

      expect(service.selectedAccount().accountName).toBe('Bravo Renamed');
      expect(service.selectedUrlSegment()).toBe('bravo-llc-2');
    });

    it('ignores a record of another organization entirely', () => {
      service.adoptFromAddress(addressedB);

      service.updateCanonicalRecord({ uid: UID_A, accountId: UID_A, name: 'Alpha Renamed', slug: 'alpha-renamed' } as OrgCanonicalRecord);

      expect(service.selectedAccount().accountName).toBe('Bravo');
      expect(service.selectedUrlSegment()).toBe('bravo-llc');
    });

    // The FR-020 stub the path guard adopts when the resolver is unavailable is address-adopted, so
    // the org list never re-checks it; the guard's own resolve on the next navigation is what fills it.
    it('leaves a selection with no indexed slug on its SFID address', async () => {
      service.adoptFromAddress({ ...addressedB, slug: undefined });
      http().get.mockReturnValue(of(canonicalOf('bravo-llc')));

      await service.refreshCanonicalRecord({ ...addressedB, slug: undefined });

      expect(service.selectedAccount().slug).toBeUndefined();
      expect(service.selectedUrlSegment()).toBe(UID_B);
    });
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
