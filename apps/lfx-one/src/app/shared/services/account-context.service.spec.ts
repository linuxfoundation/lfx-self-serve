// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Account, OrgCanonicalRecord, OrgLensAccountContextResponse } from '@lfx-one/shared/interfaces';
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
  const seedA: Account = { accountId: UID_A, accountName: 'Alpha', membershipTier: '', uid: UID_A };
  const addressedB: Account = { accountId: UID_B, accountName: 'Bravo', membershipTier: '', uid: UID_B, slug: 'bravo-llc' };

  let cookies: Map<string, string>;
  let service: AccountContextService;
  let grants: {
    writerSet: WritableSignal<Set<string>>;
    auditorSet: WritableSignal<Set<string>>;
    inheritedWriterSet: WritableSignal<Set<string>>;
    inheritedAuditorSet: WritableSignal<Set<string>>;
    isStaff: WritableSignal<boolean>;
  };

  beforeEach(() => {
    cookies = new Map();
    grants = {
      writerSet: signal(new Set<string>()),
      auditorSet: signal(new Set<string>()),
      inheritedWriterSet: signal(new Set<string>()),
      inheritedAuditorSet: signal(new Set<string>()),
      isStaff: signal(false),
    };
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
        { provide: OrgRoleGrantsService, useValue: grants },
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

  // LFXV2-3029: an inherited (roll-up) grant is a held organization — the switcher lists those rows,
  // so it must be enabled for a caller holding nothing else, or their list never starts (spec 053).
  describe('hasOrgSelectorAccess', () => {
    it('is false with no grants, no seeded organizations and no LF-team entitlement', () => {
      expect(service.hasOrgSelectorAccess()).toBe(false);
    });

    it('is true for an inherited writer grant alone', () => {
      grants.inheritedWriterSet.set(new Set([UID_A]));

      expect(service.hasOrgSelectorAccess()).toBe(true);
    });

    it('is true for an inherited auditor grant alone', () => {
      grants.inheritedAuditorSet.set(new Set([UID_A]));

      expect(service.hasOrgSelectorAccess()).toBe(true);
    });

    it('is true for a direct writer or auditor grant alone', () => {
      grants.writerSet.set(new Set([UID_A]));
      expect(service.hasOrgSelectorAccess()).toBe(true);

      grants.writerSet.set(new Set());
      grants.auditorSet.set(new Set([UID_A]));
      expect(service.hasOrgSelectorAccess()).toBe(true);
    });

    it('is true for the LF-team entitlement alone', () => {
      grants.isStaff.set(true);
      expect(service.hasOrgSelectorAccess()).toBe(true);
    });

    it('is true for a persona-seeded organization alone', () => {
      service.initializeUserOrganizations([seedA]);
      expect(service.hasOrgSelectorAccess()).toBe(true);
    });
  });

  // lfx-self-serve#2570 (prod): the org-items default (or the guard's already-selected shortcut) pins
  // the current selection in place. A persona refresh with no seeds — what a grant-only staff viewer
  // gets — then leaves it alone instead of resetting an addressed page to the placeholder mid-render.
  describe('pinSelection', () => {
    it('keeps the current selection through an empty re-seed, without rebuilding it', () => {
      service.setAccount(addressedB);
      service.pinSelection('default');

      expect(service.isAddressedSelection()).toBe(true);
      service.initializeUserOrganizations([]);
      expect(service.selectedAccount()).toEqual(addressedB);
    });

    it('keeps the current selection through a re-seed that does not list it', () => {
      service.setAccount(addressedB);
      service.pinSelection('default');

      service.initializeUserOrganizations([seedA]);
      expect(service.selectedAccount()).toEqual(addressedB);
      expect(service.availableAccounts()).toEqual([seedA]);
    });

    it('does nothing on the placeholder, so seeding still selects normally', () => {
      service.pinSelection('default');
      expect(service.isAddressedSelection()).toBe(false);

      service.initializeUserOrganizations([seedA]);
      expect(service.selectedAccount()).toEqual(seedA);
    });

    it('is released when the user switches, like an adopted selection', () => {
      service.setAccount(addressedB);
      service.pinSelection('default');
      service.setAccount(seedA);

      expect(service.isAddressedSelection()).toBe(false);
      expect(service.isAdoptedFromAddress()).toBe(false);
    });

    // The two kinds: only an address pin is honoured by an org-items reload (`isAdoptedFromAddress`);
    // both hold against the persona re-seed (`isAddressedSelection`).
    it('a default pin is not an address pin', () => {
      service.setAccount(addressedB);
      service.pinSelection('default');

      expect(service.isAddressedSelection()).toBe(true);
      expect(service.isAdoptedFromAddress()).toBe(false);
    });

    it('an address pin from the guard shortcut counts like a resolver adoption', () => {
      service.setAccount(addressedB);
      service.pinSelection('address');

      expect(service.isAdoptedFromAddress()).toBe(true);
    });

    it('adoptFromAddress is an address pin', () => {
      service.adoptFromAddress(addressedB);
      expect(service.isAdoptedFromAddress()).toBe(true);
    });

    it('a later default pin does not downgrade an address pin on the same organization', () => {
      service.adoptFromAddress(addressedB);
      service.pinSelection('default');

      expect(service.isAdoptedFromAddress()).toBe(true);
    });

    // Deliberate (lfx-self-serve#2793): the default write produces `/org/A/…`, whose guard shortcut
    // pins 'address'. Keeping the default kind there would let a later org-items reload re-default
    // the selection to B while the address still names A — spec 050's silent substitution.
    it('the guard shortcut upgrades a default pin to an address pin, so an addressed page cannot drift', () => {
      service.setAccount(addressedB);
      service.pinSelection('default');
      service.pinSelection('address');

      expect(service.isAdoptedFromAddress()).toBe(true);
    });

    it('clearAccount releases both kinds', () => {
      service.setAccount(addressedB);
      service.pinSelection('address');
      service.clearAccount();

      expect(service.isAddressedSelection()).toBe(false);
      expect(service.isAdoptedFromAddress()).toBe(false);
    });

    // The "not a setAccount" half of the contract (ahmedomosanya on lfx-self-serve#2793): the guard
    // shortcut pins on every child navigation, so a pin that rebuilt the selection from the live
    // Snowflake row would revert a canonical-record rename each time. Seeded so the rebuild would
    // actually differ — the other cases run with no live rows, where `setAccount` is an identity.
    it('does not rebuild the selection from the live row, so a canonical-record rename survives the pin', async () => {
      const staleRow = {
        accountId: UID_B,
        accountName: 'Bravo (stale Snowflake name)',
        logoUrl: null,
        cdevOrgId: null,
        membershipTierDisplayName: 'Gold',
      } as unknown as OrgLensAccountContextResponse;
      (TestBed.inject(AnalyticsService) as unknown as { getOrgLensAccountContext: ReturnType<typeof vi.fn> }).getOrgLensAccountContext.mockReturnValue(
        of([staleRow])
      );
      (TestBed.inject(FeatureFlagService) as unknown as { getBooleanFlag: ReturnType<typeof vi.fn> }).getBooleanFlag.mockReturnValue(signal(true));
      service.initializeUserOrganizations([{ ...addressedB, accountName: 'Bravo' }]);
      expect(service.selectedAccount().accountName).toBe('Bravo (stale Snowflake name)');

      const http = TestBed.inject(HttpClient) as unknown as { get: ReturnType<typeof vi.fn> };
      http.get.mockReturnValue(of({ uid: UID_B, accountId: UID_B, name: 'Bravo Holdings', slug: 'bravo-llc' } as OrgCanonicalRecord));
      await service.refreshCanonicalRecord(service.selectedAccount());
      expect(service.selectedAccount().accountName).toBe('Bravo Holdings');

      service.pinSelection('address');
      expect(service.isAdoptedFromAddress()).toBe(true);
      expect(service.selectedAccount().accountName).toBe('Bravo Holdings');

      // The rebuild the pin must not do — proves the seeding above makes the difference observable.
      service.setAccount(service.selectedAccount());
      expect(service.selectedAccount().accountName).toBe('Bravo (stale Snowflake name)');
    });
  });
});
