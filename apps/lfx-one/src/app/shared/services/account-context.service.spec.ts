// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, PLATFORM_ID, Signal, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, NavigationEnd, Router, UrlSerializer } from '@angular/router';
import { ACCOUNT_COOKIE_KEY, ROLLUP_ACCOUNT_NAME } from '@lfx-one/shared/constants';
import { Account, OrgCanonicalRecord, OrgLensAccountContextResponse, OrgLensLookupOutcome, OrgRollUpFamily } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountContextService } from './account-context.service';
import { AnalyticsService } from './analytics.service';
import { CookieRegistryService } from './cookie-registry.service';
import { OrgClaOnlyAccessService } from './org-cla-only-access.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { OrgRollUpFamiliesService } from './org-roll-up-families.service';
import { OrgRollUpFlagService } from './org-roll-up-flag.service';

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
    claManagerOrgSet: WritableSignal<Set<string>>;
  };

  beforeEach(() => {
    cookies = new Map();
    grants = {
      writerSet: signal(new Set<string>()),
      auditorSet: signal(new Set<string>()),
      inheritedWriterSet: signal(new Set<string>()),
      inheritedAuditorSet: signal(new Set<string>()),
      isStaff: signal(false),
      claManagerOrgSet: signal(new Set<string>()),
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
        { provide: OrgRoleGrantsService, useValue: grants },
        {
          provide: OrgRollUpFamiliesService,
          useValue: { hasServerFamilies: signal(false), families: signal([]), unsettled: signal(false) },
        },
        { provide: OrgRollUpFlagService, useValue: { enabled: signal(true), unsettled: signal(false) } },
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

    it('is true for a CLA-only organization alone', () => {
      grants.claManagerOrgSet.set(new Set([UID_A]));
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

describe('AccountContextService — Snowflake enrichment platform boundary', () => {
  const UID_A = '0014100000MgaAAAAA';
  const seedA: Account = { accountId: 'acc-A', accountName: 'Alpha', membershipTier: '', uid: UID_A };

  const liveRow = (accountId: string, accountName: string): OrgLensAccountContextResponse =>
    ({
      accountId,
      accountName,
      logoUrl: null,
      cdevOrgId: null,
      membershipTierDisplayName: null,
    }) as unknown as OrgLensAccountContextResponse;

  const setup = (platformId: string, responses: unknown[] = []) => {
    const cookies = new Map<string, string>();
    const getOrgLensAccountContext = vi.fn();
    for (const response of responses) {
      getOrgLensAccountContext.mockReturnValueOnce(response);
    }
    getOrgLensAccountContext.mockReturnValue(of([]));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platformId },
        {
          provide: SsrCookieService,
          useValue: {
            get: (key: string) => cookies.get(key) ?? '',
            set: (key: string, value: string) => cookies.set(key, value),
            delete: (key: string) => cookies.delete(key),
          },
        },
        { provide: CookieRegistryService, useValue: { registerCookie: vi.fn() } },
        { provide: AnalyticsService, useValue: { getOrgLensAccountContext } },
        {
          provide: OrgRoleGrantsService,
          useValue: { writerSet: signal(new Set()), auditorSet: signal(new Set()), isStaff: signal(false), claManagerOrgSet: signal(new Set()) },
        },
        {
          provide: OrgRollUpFamiliesService,
          useValue: { hasServerFamilies: signal(false), families: signal([]), unsettled: signal(false) },
        },
        { provide: OrgRollUpFlagService, useValue: { enabled: signal(true), unsettled: signal(false) } },
        { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of(null)) } },
      ],
    });
    return { service: TestBed.inject(AccountContextService), getOrgLensAccountContext };
  };

  // The retired Org Lens rollout flag used to gate this fetch; with the flag gone it runs on every browser bootstrap.
  it('runs enrichment unconditionally in the browser', () => {
    const { service, getOrgLensAccountContext } = setup('browser');

    service.initializeUserOrganizations([seedA]);

    expect(getOrgLensAccountContext).toHaveBeenCalledTimes(1);
    expect(getOrgLensAccountContext).toHaveBeenCalledWith(['acc-A']);
  });

  // The flag defaulted to false on the server (no OpenFeature provider there), so enrichment never ran during SSR —
  // the platform guard preserves that boundary now that the flag is gone.
  it('skips enrichment on the server so SSR never blocks on Snowflake', () => {
    const { service, getOrgLensAccountContext } = setup('server');

    service.initializeUserOrganizations([seedA]);

    expect(getOrgLensAccountContext).not.toHaveBeenCalled();
    expect(service.selectedAccount().accountId).toBe('acc-A');
  });

  // Bootstrap (transfer-state seeds) and the later persona re-seed each trigger a fetch; the earlier response
  // must not overwrite the later one when it lands last. Both generations cover the same account so the
  // stale payload would clobber the fresh one without the generation guard (a stub selection with a
  // non-matching cookie uid would ignore enrichment entirely, which would not exercise the guard).
  it('drops a superseded enrichment response when the re-seed fetch answers first', () => {
    const bootstrap$ = new Subject<OrgLensAccountContextResponse[]>();
    const reseed$ = new Subject<OrgLensAccountContextResponse[]>();
    const { service } = setup('browser', [bootstrap$.asObservable(), reseed$.asObservable()]);

    service.initializeUserOrganizations([seedA]);
    service.initializeUserOrganizations([seedA]);

    reseed$.next([liveRow('acc-A', 'Alpha Fresh')]);
    reseed$.complete();
    expect(service.selectedAccount().accountName).toBe('Alpha Fresh');

    bootstrap$.next([liveRow('acc-A', 'Alpha Stale')]);
    bootstrap$.complete();

    expect(service.selectedAccount().accountName).toBe('Alpha Fresh');
    expect(service.availableAccounts()).toHaveLength(1);
    expect(service.availableAccounts()[0].accountName).toBe('Alpha Fresh');
  });

  // An empty persona re-seed (staff viewers carry no orgs) starts no fetch, but it still
  // supersedes the in-flight bootstrap enrichment: the late response must neither repopulate
  // `liveAccounts` nor touch the placeholder selection. Probed via `setAccount`, which merges
  // any live row for the id — a repopulated cache would surface the stale name here.
  it('invalidates an in-flight enrichment on an empty re-seed', () => {
    const bootstrap$ = new Subject<OrgLensAccountContextResponse[]>();
    const { service, getOrgLensAccountContext } = setup('browser', [bootstrap$.asObservable()]);

    service.initializeUserOrganizations([seedA]);
    service.initializeUserOrganizations([]);

    expect(getOrgLensAccountContext).toHaveBeenCalledTimes(1);
    expect(service.availableAccounts()).toHaveLength(0);

    bootstrap$.next([liveRow('acc-A', 'Alpha Stale')]);
    bootstrap$.complete();

    service.setAccount({ ...seedA, accountName: 'Seed Name' });
    expect(service.selectedAccount().accountName).toBe('Seed Name');
  });

  // Same supersession for an addressed selection: the empty re-seed preserves it (staff re-seed
  // behavior), and the late bootstrap response for the same account must not clobber the
  // canonical display fields with stale Snowflake ones.
  it('preserves an addressed selection when an empty re-seed beats a late bootstrap response', () => {
    const bootstrap$ = new Subject<OrgLensAccountContextResponse[]>();
    const { service, getOrgLensAccountContext } = setup('browser', [bootstrap$.asObservable()]);

    service.initializeUserOrganizations([seedA]);
    service.adoptFromAddress({ ...seedA, accountName: 'Canonical Name' });
    expect(service.isAddressedSelection()).toBe(true);

    service.initializeUserOrganizations([]);
    expect(service.selectedAccount().accountName).toBe('Canonical Name');

    bootstrap$.next([liveRow('acc-A', 'Alpha Stale')]);
    bootstrap$.complete();

    expect(getOrgLensAccountContext).toHaveBeenCalledTimes(1);
    expect(service.selectedAccount().accountName).toBe('Canonical Name');
    expect(service.availableAccounts()).toHaveLength(0);
  });
});

describe('AccountContextService — membership tier for the selected organization', () => {
  const UID_GRANT = '0014100000MgaAAAAA';
  const UID_OTHER = '0014100000MgbBBBBB';
  const UID_SEED = '0014100000MgcCCCCC';
  const grantOrg: Account = { accountId: UID_GRANT, accountName: 'Grant Org', membershipTier: '', uid: UID_GRANT, slug: 'grant-org' };
  const otherOrg: Account = { accountId: UID_OTHER, accountName: 'Other Org', membershipTier: '', uid: UID_OTHER, slug: 'other-org' };
  const seedOrg: Account = { accountId: UID_SEED, accountName: 'Seed Org', membershipTier: '', uid: UID_SEED };

  const tierRow = (accountId: string, tier: string | null): OrgLensAccountContextResponse =>
    ({
      accountId,
      accountName: 'Snowflake name',
      logoUrl: null,
      cdevOrgId: null,
      membershipTierDisplayName: tier,
    }) as unknown as OrgLensAccountContextResponse;

  const setup = (platformId = 'browser') => {
    const cookies = new Map<string, string>();
    const getOrgLensAccountContext = vi.fn().mockReturnValue(of([]));
    const httpGet = vi.fn().mockReturnValue(of(null));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platformId },
        {
          provide: SsrCookieService,
          useValue: {
            get: (key: string) => cookies.get(key) ?? '',
            set: (key: string, value: string) => cookies.set(key, value),
            delete: (key: string) => cookies.delete(key),
          },
        },
        { provide: CookieRegistryService, useValue: { registerCookie: vi.fn() } },
        { provide: AnalyticsService, useValue: { getOrgLensAccountContext } },
        {
          provide: OrgRoleGrantsService,
          useValue: {
            writerSet: signal(new Set([UID_GRANT])),
            auditorSet: signal(new Set()),
            inheritedWriterSet: signal(new Set()),
            inheritedAuditorSet: signal(new Set()),
            isStaff: signal(false),
            claManagerOrgSet: signal(new Set()),
          },
        },
        {
          provide: OrgRollUpFamiliesService,
          useValue: { hasServerFamilies: signal(false), families: signal([]), unsettled: signal(false) },
        },
        { provide: OrgRollUpFlagService, useValue: { enabled: signal(true), unsettled: signal(false) } },
        { provide: HttpClient, useValue: { get: httpGet } },
      ],
    });
    return { service: TestBed.inject(AccountContextService), getOrgLensAccountContext, cookies, httpGet };
  };

  it('fills the tier for an organization picked in the switcher', () => {
    const { service, getOrgLensAccountContext } = setup();
    getOrgLensAccountContext.mockReturnValue(of([tierRow(UID_OTHER, 'Gold Membership'), tierRow(UID_GRANT, 'Platinum Membership')]));

    service.setAccount(grantOrg);

    expect(getOrgLensAccountContext).toHaveBeenCalledWith([UID_GRANT]);
    expect(service.selectedAccount().membershipTier).toBe('Platinum Membership');
  });

  it('patches only the tier, never the name or slug the org list and canonical record set', () => {
    const { service, getOrgLensAccountContext } = setup();
    getOrgLensAccountContext.mockReturnValue(of([tierRow(UID_GRANT, 'Gold Membership')]));

    service.setAccount(grantOrg);

    expect(service.selectedAccount()).toEqual({ ...grantOrg, membershipTier: 'Gold Membership' });
  });

  it('fills the tier for an organization adopted from a deep link', () => {
    const { service, getOrgLensAccountContext } = setup();
    getOrgLensAccountContext.mockReturnValue(of([tierRow(UID_GRANT, 'Platinum Membership')]));

    service.adoptFromAddress(grantOrg);

    expect(service.isAdoptedFromAddress()).toBe(true);
    expect(service.selectedAccount().membershipTier).toBe('Platinum Membership');
  });

  it('fills the tier for a granted organization restored from the cookie beside a persona seed', () => {
    const { service, getOrgLensAccountContext, cookies } = setup();
    cookies.set(ACCOUNT_COOKIE_KEY, JSON.stringify({ uid: UID_GRANT }));
    getOrgLensAccountContext.mockImplementation((ids: string[]) => of(ids.includes(UID_GRANT) ? [tierRow(UID_GRANT, 'Associate Membership')] : []));

    service.initializeUserOrganizations([seedOrg]);

    expect(getOrgLensAccountContext).toHaveBeenCalledWith([UID_GRANT]);
    expect(service.selectedAccount().uid).toBe(UID_GRANT);
    expect(service.selectedAccount().membershipTier).toBe('Associate Membership');
  });

  it('fills the tier once the canonical record gives a uid-only stub its accountId', async () => {
    const { service, getOrgLensAccountContext, httpGet } = setup();
    getOrgLensAccountContext.mockReturnValue(of([tierRow(UID_GRANT, 'Silver Membership')]));
    httpGet.mockReturnValue(of({ uid: UID_GRANT, accountId: UID_GRANT, name: 'Grant Org' } as OrgCanonicalRecord));
    const stub: Account = { accountId: '', accountName: '', membershipTier: '', uid: UID_GRANT };

    service.adoptFromAddress(stub);
    expect(getOrgLensAccountContext).not.toHaveBeenCalled();
    await service.refreshCanonicalRecord(stub);

    expect(service.selectedAccount().membershipTier).toBe('Silver Membership');
  });

  it('keeps the tier across a switch away and back without asking again', () => {
    const { service, getOrgLensAccountContext } = setup();
    getOrgLensAccountContext.mockImplementation((ids: string[]) => of([tierRow(ids[0], ids[0] === UID_GRANT ? 'Platinum Membership' : 'Gold Membership')]));

    service.setAccount(grantOrg);
    service.setAccount(otherOrg);
    expect(service.selectedAccount().membershipTier).toBe('Gold Membership');
    service.setAccount(grantOrg);

    expect(service.selectedAccount().membershipTier).toBe('Platinum Membership');
    expect(getOrgLensAccountContext).toHaveBeenCalledTimes(2);
  });

  it('does not patch the current selection with a late answer for the previous one', () => {
    const { service, getOrgLensAccountContext } = setup();
    const grant$ = new Subject<OrgLensAccountContextResponse[]>();
    getOrgLensAccountContext.mockReturnValueOnce(grant$.asObservable()).mockReturnValue(of([tierRow(UID_OTHER, null)]));

    service.setAccount(grantOrg);
    service.setAccount(otherOrg);
    grant$.next([tierRow(UID_GRANT, 'Platinum Membership')]);
    grant$.complete();

    expect(service.selectedAccount().uid).toBe(UID_OTHER);
    expect(service.selectedAccount().membershipTier).toBe('');
  });

  it('shows no tier for an organization the warehouse has no tier for', () => {
    const { service, getOrgLensAccountContext } = setup();
    getOrgLensAccountContext.mockReturnValue(of([tierRow(UID_GRANT, null)]));

    service.setAccount(grantOrg);
    service.setAccount(otherOrg);
    service.setAccount(grantOrg);

    expect(service.selectedAccount().membershipTier).toBe('');
    expect(getOrgLensAccountContext).toHaveBeenCalledTimes(2);
  });

  it('asks again on the next selection when the lookup came back without a row', () => {
    const { service, getOrgLensAccountContext } = setup();
    getOrgLensAccountContext.mockReturnValueOnce(of([])).mockReturnValue(of([tierRow(UID_GRANT, 'Gold Membership')]));

    service.setAccount(grantOrg);
    expect(service.selectedAccount().membershipTier).toBe('');
    service.setAccount(grantOrg);

    expect(service.selectedAccount().membershipTier).toBe('Gold Membership');
  });

  it('leaves a persona seed to the seed enrichment, with no second lookup', () => {
    const { service, getOrgLensAccountContext } = setup();

    service.initializeUserOrganizations([seedOrg]);
    service.setAccount(seedOrg);

    expect(getOrgLensAccountContext).toHaveBeenCalledTimes(1);
    expect(getOrgLensAccountContext).toHaveBeenCalledWith([UID_SEED]);
  });

  it('never looks up a tier for the family roll-up', () => {
    const { service, getOrgLensAccountContext } = setup();

    service.setAccount({ accountId: `family-${UID_GRANT}`, accountName: 'All Organizations', membershipTier: '', uid: `family-${UID_GRANT}` });

    expect(getOrgLensAccountContext).not.toHaveBeenCalled();
  });

  it('makes no lookup during SSR', () => {
    const { service, getOrgLensAccountContext } = setup('server');

    service.setAccount(grantOrg);

    expect(getOrgLensAccountContext).not.toHaveBeenCalled();
  });
});

/**
 * lfx-self-serve#4125 / #4133 — the family roll-up selection. It is a view mode keyed on the
 * family's top Salesforce account id rather than a `b2b_org` row, so it has to survive the cookie
 * round-trip, address as `/org/family-{root}/…`, and never reach an `:orgUid` endpoint.
 *
 * Alpha is the top of the family and Bravo inherits from it, so the two are one family keyed on
 * Alpha — the shape the conglomerate case has in production. The families come from the server
 * (lfx-self-serve#4126); the stand-in below groups what the caller holds the way it does.
 */
describe('AccountContextService — family roll-up', () => {
  const UID_A = '0014100000MgaAAAAA';
  const UID_B = '0014100000MgbBBBBB';
  const ROOT = UID_A;
  const SEGMENT = `family-${ROOT}`;
  const seedA: Account = { accountId: UID_A, accountName: 'Alpha', membershipTier: '', uid: UID_A };
  const seedB: Account = { accountId: UID_B, accountName: 'Bravo', membershipTier: '', uid: UID_B };
  const COOKIE = 'lfx-selected-account';

  let cookies: Map<string, string>;
  let service: AccountContextService;
  let httpGet: ReturnType<typeof vi.fn>;
  let routerUrl: string;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let navigateSpy: ReturnType<typeof vi.fn>;
  let currentNavigation: unknown;
  let routerEvents: Subject<unknown>;
  /** Rows the Snowflake enrichment answers with; `toAccount` maps these and carries no `uid`. */
  let liveRows: OrgLensAccountContextResponse[];
  /** M3 CLA-only access: not part of a roll-up, but a real address the demotion may keep. */
  let claOnlyOrgUids: WritableSignal<Set<string>>;
  let grants: {
    writerSet: WritableSignal<Set<string>>;
    auditorSet: WritableSignal<Set<string>>;
    inheritedWriterSet: WritableSignal<Set<string>>;
    inheritedAuditorSet: WritableSignal<Set<string>>;
    isStaff: WritableSignal<boolean>;
    claManagerOrgSet: WritableSignal<Set<string>>;
    loaded: WritableSignal<boolean>;
    lookupOutcome: WritableSignal<OrgLensLookupOutcome>;
  };
  /** Each organization's Salesforce parent, as the server's family walk resolves it. */
  let familyParents: WritableSignal<Map<string, string>>;
  /** Family display names by top account id, as the server reports them. */
  let familyNames: WritableSignal<Map<string, string>>;
  /** Pins the server's answer outright, for tests about one specific answer. */
  let serverAnswer: WritableSignal<OrgRollUpFamily[] | null>;
  let serverFamilies: {
    hasServerFamilies: WritableSignal<boolean>;
    families: Signal<OrgRollUpFamily[]>;
    unsettled: WritableSignal<boolean>;
    answered: WritableSignal<boolean>;
    incomplete: WritableSignal<boolean>;
    loading: WritableSignal<boolean>;
  };
  /** The `org-lens-rollup-enabled` gate — on and settled unless a test says otherwise. */
  let rollUpFlag: { enabled: WritableSignal<boolean>; unsettled: WritableSignal<boolean> };

  /** Stands in for the roll-up set endpoint: groups what the caller holds (persona seeds and every grant set) under each organization's top parent. */
  const groupLikeServer = (): OrgRollUpFamily[] => {
    const seeds = (service as unknown as { userOrganizations: Signal<Account[]> }).userOrganizations();
    const held = new Set<string>(seeds.flatMap((account) => (account.uid ? [account.uid] : [])));
    for (const set of [grants.writerSet(), grants.auditorSet(), grants.inheritedWriterSet(), grants.inheritedAuditorSet()]) {
      set.forEach((uid) => held.add(uid));
    }
    const families = new Map<string, string[]>();
    for (const uid of held) {
      let rootUid = uid;
      for (let parent = familyParents().get(rootUid); parent; parent = familyParents().get(rootUid)) {
        rootUid = parent;
      }
      families.set(rootUid, [...(families.get(rootUid) ?? []), uid]);
    }
    return Array.from(families, ([rootUid, orgUids]) => ({ rootUid, name: familyNames().get(rootUid) ?? null, orgUids })).sort((a, b) =>
      a.rootUid.localeCompare(b.rootUid)
    );
  };

  beforeEach(() => {
    cookies = new Map();
    routerUrl = `/org/${SEGMENT}/people`;
    navigateByUrl = vi.fn();
    navigateSpy = vi.fn();
    currentNavigation = null;
    routerEvents = new Subject<unknown>();
    liveRows = [];
    claOnlyOrgUids = signal(new Set<string>());
    httpGet = vi.fn().mockReturnValue(of(null));
    grants = {
      writerSet: signal(new Set<string>()),
      auditorSet: signal(new Set<string>()),
      inheritedWriterSet: signal(new Set<string>()),
      inheritedAuditorSet: signal(new Set<string>()),
      isStaff: signal(false),
      claManagerOrgSet: signal(new Set<string>()),
      loaded: signal(true),
      lookupOutcome: signal<OrgLensLookupOutcome>('ok'),
    };
    familyParents = signal(new Map([[UID_B, UID_A]]));
    familyNames = signal(new Map([[UID_A, 'Alpha']]));
    serverAnswer = signal<OrgRollUpFamily[] | null>(null);
    serverFamilies = {
      hasServerFamilies: signal(true),
      families: computed(() => serverAnswer() ?? groupLikeServer()),
      unsettled: signal(false),
      answered: signal(true),
      incomplete: signal(false),
      loading: signal(false),
    };
    rollUpFlag = { enabled: signal(true), unsettled: signal(false) };
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
        { provide: AnalyticsService, useValue: { getOrgLensAccountContext: vi.fn(() => of(liveRows)) } },
        { provide: OrgRoleGrantsService, useValue: grants },
        { provide: OrgRollUpFamiliesService, useValue: serverFamilies },
        { provide: OrgRollUpFlagService, useValue: rollUpFlag },
        { provide: OrgClaOnlyAccessService, useValue: { claOnlyOrgUids } },
        { provide: UrlSerializer, useClass: DefaultUrlSerializer },
        {
          provide: Router,
          useValue: {
            get url() {
              return routerUrl;
            },
            parseUrl: (url: string) => TestBed.inject(UrlSerializer).parse(url),
            navigateByUrl,
            navigate: navigateSpy,
            getCurrentNavigation: () => currentNavigation,
            events: routerEvents.asObservable(),
          },
        },
        { provide: HttpClient, useValue: { get: httpGet } },
      ],
    });
    service = TestBed.inject(AccountContextService);
  });

  const familyOrgs = (rootUid: string): string[] | undefined => service.rollUpFamilies().find((family) => family.rootUid === rootUid)?.orgUids;

  it('groups persona seeds and grant sets by family, de-duplicated by uid', () => {
    service.initializeUserOrganizations([seedA]);
    expect(familyOrgs(ROOT)).toEqual([UID_A]);
    expect(service.canSelectRollUp()).toBe(false);

    // The same organization held by seed *and* grant is still one organization.
    grants.writerSet.set(new Set([UID_A]));
    expect(familyOrgs(ROOT)).toEqual([UID_A]);

    // An inherited grant adds a sibling the persona seeds never carried — the conglomerate case.
    grants.inheritedWriterSet.set(new Set([UID_B]));
    expect(familyOrgs(ROOT)?.sort()).toEqual([UID_A, UID_B].sort());
    expect(service.canSelectRollUp()).toBe(true);
    expect(service.canSelectRollUpFor(ROOT)).toBe(true);
    expect(service.rollUpFamilies()).toEqual([{ rootUid: ROOT, name: 'Alpha', orgUids: expect.any(Array) }]);
  });

  /**
   * lfx-self-serve#4126 — the server's families are the only grouping: it resolves each organization
   * to its family's top account, which the grant sets alone cannot.
   */
  describe('server-resolved families', () => {
    const UID_C = '0014100000MgcCCCCC';

    it("uses the server's families, which can group organizations no grant links", () => {
      grants.writerSet.set(new Set([UID_A, UID_C]));
      familyParents.set(new Map());
      expect(service.canSelectRollUpFor(UID_C)).toBe(false);

      serverAnswer.set([{ rootUid: UID_C, name: 'Charlie', orgUids: [UID_A, UID_C] }]);

      expect(service.rollUpFamilies().map((family) => family.rootUid)).toEqual([UID_C]);
      expect(service.canSelectRollUpFor(UID_C)).toBe(true);
      expect(service.selectRollUp(UID_C)).toBe(true);
      expect(service.selectedAccount().accountName).toBe('All Charlie Organizations');
    });

    // No client-side guess: a guess offers family keys the server may not use, and a restored
    // roll-up would demote and overwrite its cookie before the real answer lands.
    it('offers no roll-up while the server families are not usable', () => {
      grants.inheritedWriterSet.set(new Set([UID_B]));
      service.initializeUserOrganizations([seedA]);
      serverFamilies.hasServerFamilies.set(false);

      expect(service.rollUpFamilies()).toEqual([]);
      expect(service.canSelectRollUpFor(ROOT)).toBe(false);
    });

    it('renames a restored roll-up once its family lands, keeping the selection', () => {
      cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
      serverFamilies.hasServerFamilies.set(false);
      serverFamilies.unsettled.set(true);
      service.initializeUserOrganizations([seedA, seedB]);
      TestBed.tick();
      expect(service.selectedAccount().accountName).toBe(ROLLUP_ACCOUNT_NAME);

      serverFamilies.hasServerFamilies.set(true);
      serverFamilies.unsettled.set(false);
      TestBed.tick();

      expect(service.selectedAccount()).toEqual(expect.objectContaining({ uid: SEGMENT, accountName: 'All Alpha Organizations' }));
      expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: SEGMENT });
    });

    // A partial answer can name a provisional top account; a pick made on it would demote once
    // Retry finds the real one. A selection made before the outage is held, not demoted.
    it('offers no new pick from a partial answer, but keeps a restored roll-up', () => {
      cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
      serverFamilies.unsettled.set(true);
      service.initializeUserOrganizations([seedA, seedB]);
      TestBed.tick();

      expect(service.eligibleRollUpFamilies()).toEqual([]);
      expect(service.canSelectRollUpFor(ROOT)).toBe(false);
      expect(service.isRollUp()).toBe(true);
      expect(service.selectedAccount().accountName).toBe('All Alpha Organizations');
    });

    // Retry reloads the grants; until the families answer that reload, the previous answer describes
    // grants that were replaced. A family it names may have shrunk or gone, so it admits no new pick.
    it('offers no new pick from an answer to an earlier grants load', () => {
      service.initializeUserOrganizations([seedA, seedB]);
      TestBed.tick();
      expect(service.canSelectRollUpFor(ROOT)).toBe(true);

      serverFamilies.unsettled.set(true);

      expect(service.rollUpFamilies()).not.toEqual([]);
      expect(service.eligibleRollUpFamilies()).toEqual([]);
      expect(service.selectRollUp(ROOT)).toBe(false);
    });

    // The families land after the grants. Judging a family's size in between would demote a
    // caller whose family is simply not known yet, and overwrite the roll-up cookie.
    it('holds a restored roll-up while the families are unsettled, and demotes once they settle smaller', () => {
      cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
      serverFamilies.hasServerFamilies.set(false);
      serverFamilies.unsettled.set(true);
      service.initializeUserOrganizations([seedA]);
      grants.inheritedWriterSet.set(new Set());

      expect(service.grantsUnsettled()).toBe(true);
      TestBed.tick();
      expect(service.isRollUp()).toBe(true);

      serverAnswer.set([{ rootUid: ROOT, name: 'Alpha', orgUids: [UID_A] }]);
      serverFamilies.hasServerFamilies.set(true);
      serverFamilies.unsettled.set(false);
      TestBed.tick();

      expect(service.isRollUp()).toBe(false);
      expect(service.selectedAccount().uid).toBe(UID_A);
    });
  });

  /**
   * The `org-lens-rollup-enabled` dark-launch gate (#4132). LaunchDarkly answers for an anonymous
   * context before the signed-in viewer, so "not known yet" is held like unsettled grants, and only
   * a settled "off" withdraws the roll-up.
   */
  describe('org-lens-rollup-enabled flag', () => {
    it('offers no roll-up while the flag is off, though the families are known', () => {
      service.initializeUserOrganizations([seedA, seedB]);
      expect(service.canSelectRollUpFor(ROOT)).toBe(true);

      rollUpFlag.enabled.set(false);

      expect(service.rollUpFamilies()).not.toEqual([]);
      expect(service.eligibleRollUpFamilies()).toEqual([]);
      expect(service.canSelectRollUp()).toBe(false);
      expect(service.selectRollUp(ROOT)).toBe(false);
      expect(service.selectRollUp(ROOT, { admitWhilePending: true })).toBe(false);
    });

    it('admits a roll-up address while the flag has not answered, but offers no new pick', () => {
      rollUpFlag.enabled.set(false);
      rollUpFlag.unsettled.set(true);
      service.initializeUserOrganizations([seedA, seedB]);

      expect(service.canSelectRollUpFor(ROOT)).toBe(false);
      expect(service.selectRollUp(ROOT)).toBe(false);
      expect(service.selectRollUp(ROOT, { admitWhilePending: true })).toBe(true);
      expect(service.isRollUp()).toBe(true);
    });

    it('holds a restored roll-up while the flag has not answered, and demotes once it settles off', () => {
      cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
      rollUpFlag.enabled.set(false);
      rollUpFlag.unsettled.set(true);
      service.initializeUserOrganizations([seedA, seedB]);
      TestBed.tick();

      expect(service.isRollUp()).toBe(true);
      expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: SEGMENT });

      rollUpFlag.unsettled.set(false);
      TestBed.tick();

      expect(service.isRollUp()).toBe(false);
      expect([UID_A, UID_B]).toContain(service.selectedAccount().uid);
      expect(JSON.parse(cookies.get(COOKIE) as string).uid).not.toBe(SEGMENT);
    });

    // An outage must not keep a withdrawn roll-up selected: a flag settled off waits only for the
    // grants to answer, not for a good answer.
    it('demotes a restored roll-up when the flag settles off during a families outage', () => {
      cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
      serverFamilies.unsettled.set(true);
      grants.lookupOutcome.set('failed');
      rollUpFlag.enabled.set(false);
      rollUpFlag.unsettled.set(true);
      service.initializeUserOrganizations([seedA, seedB]);
      TestBed.tick();
      expect(service.isRollUp()).toBe(true);

      rollUpFlag.unsettled.set(false);
      TestBed.tick();

      expect(service.grantsUnsettled()).toBe(true);
      expect(service.isRollUp()).toBe(false);
      expect([UID_A, UID_B]).toContain(service.selectedAccount().uid);
    });

    // A grants request that fails outright never starts the families request, so `answered` never
    // turns true; the flag-off demotion must not wait on it.
    it('demotes a restored roll-up when the flag settles off and a cold grants request failed', () => {
      cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
      grants.lookupOutcome.set('failed');
      serverFamilies.hasServerFamilies.set(false);
      serverFamilies.unsettled.set(true);
      serverFamilies.answered.set(false);
      rollUpFlag.enabled.set(false);
      rollUpFlag.unsettled.set(true);
      service.initializeUserOrganizations([seedA, seedB]);
      TestBed.tick();
      expect(service.isRollUp()).toBe(true);

      rollUpFlag.unsettled.set(false);
      TestBed.tick();

      expect(service.isRollUp()).toBe(false);
      expect([UID_A, UID_B]).toContain(service.selectedAccount().uid);
      expect(JSON.parse(cookies.get(COOKIE) as string).uid).not.toBe(SEGMENT);
    });

    it('holds a roll-up address with the flag off until the grants have answered at all', () => {
      grants.loaded.set(false);
      rollUpFlag.enabled.set(false);

      expect(service.selectRollUp(ROOT, { admitWhilePending: true })).toBe(true);

      grants.loaded.set(true);
      service.initializeUserOrganizations([seedA, seedB]);
      TestBed.tick();

      expect(service.isRollUp()).toBe(false);
    });

    // On a cold visit the grants answer before the families do: demoting then would fall back to
    // whichever organization sorts first, not one in the family the address named.
    it('holds a roll-up address with the flag off until the families have answered, then demotes into its family', () => {
      const UID_Z = '0014100000MgzZZZZZ';
      const seedZ: Account = { accountId: UID_Z, accountName: 'Zulu', membershipTier: '', uid: UID_Z };
      cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
      grants.writerSet.set(new Set([UID_B, UID_Z]));
      serverFamilies.hasServerFamilies.set(false);
      serverFamilies.unsettled.set(true);
      serverFamilies.answered.set(false);
      rollUpFlag.enabled.set(false);
      service.initializeUserOrganizations([seedZ, seedB]);
      TestBed.tick();

      expect(service.isRollUp()).toBe(true);

      serverFamilies.hasServerFamilies.set(true);
      serverFamilies.unsettled.set(false);
      serverFamilies.answered.set(true);
      TestBed.tick();

      expect(service.isRollUp()).toBe(false);
      expect(service.selectedAccount().uid).toBe(UID_B);
    });

    it('keeps a restored roll-up once the flag settles on', () => {
      cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
      rollUpFlag.enabled.set(false);
      rollUpFlag.unsettled.set(true);
      service.initializeUserOrganizations([seedA, seedB]);
      TestBed.tick();

      rollUpFlag.unsettled.set(false);
      rollUpFlag.enabled.set(true);
      TestBed.tick();

      expect(service.isRollUp()).toBe(true);
      expect(service.selectedAccount()).toEqual(expect.objectContaining({ uid: SEGMENT, accountName: 'All Alpha Organizations' }));
    });

    // With the flag off the families feed nothing on screen, so the switcher must not carry their
    // incomplete-list notice or keep its Retry busy on their refetch.
    it('reports the families incomplete or loading only while the flag is on', () => {
      serverFamilies.incomplete.set(true);
      serverFamilies.loading.set(true);
      expect(service.rollUpFamiliesIncomplete()).toBe(true);
      expect(service.rollUpFamiliesLoading()).toBe(true);

      rollUpFlag.enabled.set(false);

      expect(service.rollUpFamiliesIncomplete()).toBe(false);
      expect(service.rollUpFamiliesLoading()).toBe(false);
    });
  });

  /**
   * One roll-up per family, never one across families: a caller whose organizations reach two
   * families gets two roll-ups, each offered only where they hold two or more organizations.
   */
  describe('per-family grouping', () => {
    const UID_C = '0014100000MgcCCCCC';
    const UID_D = '0014100000MgdDDDDD';
    const UID_E = '0014100000MgeEEEEE';

    beforeEach(() => {
      familyParents.set(
        new Map([
          [UID_B, UID_A],
          [UID_D, UID_C],
        ])
      );
      familyNames.set(
        new Map([
          [UID_A, 'Alpha'],
          [UID_C, 'Charlie'],
        ])
      );
    });

    it('offers one roll-up per family the caller holds two or more organizations in', () => {
      grants.writerSet.set(new Set([UID_A, UID_C, UID_E]));
      grants.inheritedAuditorSet.set(new Set([UID_B, UID_D]));

      expect(service.rollUpFamilies().map((family) => family.rootUid)).toEqual([UID_A, UID_C, UID_E]);
      expect(service.eligibleRollUpFamilies().map((family) => family.rootUid)).toEqual([UID_A, UID_C]);
      expect(service.canSelectRollUpFor(UID_C)).toBe(true);
      // A one-organization family is the organization, not a roll-up.
      expect(service.canSelectRollUpFor(UID_E)).toBe(false);
      expect(service.selectRollUp(UID_E)).toBe(false);
    });

    it('selects one family at a time and counts only that family', () => {
      grants.writerSet.set(new Set([UID_A, UID_C]));
      grants.inheritedAuditorSet.set(new Set([UID_B, UID_D]));

      expect(service.selectRollUp(UID_C)).toBe(true);
      expect(service.selectedRollUpRootUid()).toBe(UID_C);
      expect(service.selectedUrlSegment()).toBe(`family-${UID_C}`);
      expect(service.selectedAccount().accountName).toBe('All Charlie Organizations');
      expect(service.rollUpOrganizationCount()).toBe(2);
    });

    it('demotes into the same family before an unrelated organization', () => {
      service.initializeUserOrganizations([{ accountId: UID_E, accountName: 'Echo', membershipTier: '', uid: UID_E }]);
      grants.writerSet.set(new Set([UID_C]));
      grants.inheritedAuditorSet.set(new Set([UID_D]));

      expect(service.rollUpFallbackOrganization(UID_C)?.uid).toBe(UID_C);
      expect(service.rollUpFallbackOrganization(null)?.uid).toBe(UID_E);
    });
  });

  it('refuses the selection for a caller holding one organization', () => {
    service.initializeUserOrganizations([seedA]);
    expect(service.selectRollUp(ROOT)).toBe(false);
    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_A);
  });

  it('selects, addresses as /org/family-{root} and persists the family key', () => {
    service.initializeUserOrganizations([seedA, seedB]);
    expect(service.selectRollUp(ROOT)).toBe(true);
    expect(service.isRollUp()).toBe(true);
    expect(service.selectedUrlSegment()).toBe(SEGMENT);
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: SEGMENT });
  });

  // The whole point of widening the cookie round-trip: a refresh must not drop the caller back
  // into a single company.
  it('restores the roll-up from the cookie on the next bootstrap', () => {
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA, seedB]);
    expect(service.isRollUp()).toBe(true);
    expect(service.selectedAccount().accountName).toBe('All Alpha Organizations');
  });

  /**
   * A conglomerate's siblings arrive as inherited grants, which load after the persona seeds. A
   * restore that trusted the count at that instant would demote the caller to one company and
   * overwrite the cookie that said otherwise.
   */
  it('restores optimistically while the grant sets are still loading', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);
    expect(service.isRollUp()).toBe(true);
  });

  it('demotes a restored roll-up once the grants confirm a single organization', () => {
    grants.loaded.set(true);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);
    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_A);
  });

  // A caller whose organizations are all inherited grants has no persona seeds at all; the restore
  // must happen before the empty-seeds bail-out or it is lost.
  it('restores for a caller with no persona seeds', () => {
    grants.inheritedWriterSet.set(new Set([UID_A, UID_B]));
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([]);
    expect(service.isRollUp()).toBe(true);
  });

  // `/api/orgs/uid/all` is not a thing: the sentinel names a set, and that endpoint takes an SFID.
  it('never asks for a canonical record for the sentinel', async () => {
    service.initializeUserOrganizations([seedA, seedB]);
    service.selectRollUp(ROOT);
    httpGet.mockClear();
    await service.refreshCanonicalRecord(service.selectedAccount());
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('leaves roll-up mode when a concrete organization is selected', () => {
    service.initializeUserOrganizations([seedA, seedB]);
    service.selectRollUp(ROOT);
    service.setAccount(seedB);
    expect(service.isRollUp()).toBe(false);
    expect(service.selectedUrlSegment()).toBe(UID_B);
  });

  // Regression, PR #4415 review: `availableAccounts()` swaps each seed for its enriched Snowflake
  // row, and `toAccount` carries no `uid` — counting that list dropped every enriched organization
  // and hid the roll-up the moment enrichment succeeded.
  it('keeps counting organizations after Snowflake enrichment replaces the seeds', () => {
    // Enrichment answers for both seeds. `toAccount` maps these without a `uid`, so
    // `availableAccounts()` — which prefers the live row — yields two uid-less accounts.
    liveRows = [
      { accountId: UID_A, accountName: 'Alpha Inc', logoUrl: null, cdevOrgId: null, membershipTierDisplayName: 'Gold' },
      { accountId: UID_B, accountName: 'Bravo Inc', logoUrl: null, cdevOrgId: null, membershipTierDisplayName: 'Silver' },
    ] as OrgLensAccountContextResponse[];

    service.initializeUserOrganizations([seedA, seedB]);

    // Guard the premise: the enriched list really has lost the uids.
    expect(service.availableAccounts().every((account) => !account.uid)).toBe(true);
    // The count must come from the persona seeds, so it survives that.
    expect(familyOrgs(ROOT)).toHaveLength(2);
    expect(service.canSelectRollUp()).toBe(true);
  });

  // Regression, PR #4415 review: the optimistic restore pinned the selection, so every later
  // bootstrap returned early and nothing re-judged eligibility once the grants landed.
  it('demotes an optimistically restored roll-up when the grants settle against it', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);
    expect(service.isRollUp()).toBe(true);

    grants.loaded.set(true);
    TestBed.tick();

    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_A);
  });

  it('keeps an optimistically restored roll-up when the grants confirm it', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);

    grants.inheritedWriterSet.set(new Set([UID_B]));
    grants.loaded.set(true);
    TestBed.tick();

    expect(service.isRollUp()).toBe(true);
  });

  // The Events family keys on `:accountId`; a falsy one is filtered out by those consumers.
  it('carries the sentinel in accountId as well as uid', () => {
    service.initializeUserOrganizations([seedA, seedB]);
    service.selectRollUp(ROOT);
    expect(service.getAccountId()).toBe(SEGMENT);
  });

  /**
   * Regression, PR #4415 review 2. `OrgRoleGrantsService.refresh()` sets `loaded` true in its
   * `catchError` branch as well, after clearing every grant set — its own comment calls the grants
   * "unknown, not empty" and raises `lookupOutcome: 'failed'`. Reading that as settled demoted a
   * genuine conglomerate admin on a transient outage AND persisted the concrete uid over their
   * `all` cookie, so the choice did not come back once the outage cleared.
   */
  it('keeps the roll-up when the grants lookup failed rather than answered empty', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);
    expect(service.isRollUp()).toBe(true);

    // The outage: loaded flips true, every grant set is empty, outcome is 'failed'.
    grants.loaded.set(true);
    grants.lookupOutcome.set('failed');
    TestBed.tick();

    expect(service.isRollUp()).toBe(true);
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: SEGMENT });
  });

  // A partial roll-up expansion is a lower bound for the same reason.
  it('keeps the roll-up while the grants lookup is only partial', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    grants.lookupOutcome.set('partial');
    TestBed.tick();

    expect(service.isRollUp()).toBe(true);
  });

  /**
   * Regression, PR #4415 review 3. Eligibility counts inherited grants, but the demotion fallback
   * only looked at persona seeds — so a caller holding one inherited organization and no seed was
   * dropped to the placeholder with their cookie cleared, rather than onto the organization they
   * still held.
   */
  it('demotes onto a granted organization when the caller has no persona seeds', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([]);
    expect(service.isRollUp()).toBe(true);

    grants.inheritedWriterSet.set(new Set([UID_B]));
    grants.loaded.set(true);
    TestBed.tick();

    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_B);
  });

  /**
   * Regression, PR #4415 review 3. Demotion changed the selection but left the address at
   * a roll-up address, so page consumers rendered one organization's data under a combined-view URL.
   */
  it('re-points the address off the roll-up when it demotes, keeping the page', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    const [tree, extras] = navigateByUrl.mock.calls[0];
    expect(TestBed.inject(UrlSerializer).serialize(tree)).toBe(`/org/${UID_A}/people`);
    expect(extras).toEqual({ replaceUrl: true });
  });

  // The roster selection names a person in the family, not in the organization it demotes to.
  it('drops the per-organization query state when it demotes, keeping the rest', () => {
    routerUrl = `/org/${SEGMENT}/people?employees=jdoe&tab=board`;
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(UrlSerializer).serialize(navigateByUrl.mock.calls[0][0])).toBe(`/org/${UID_A}/people?tab=board`);
  });

  it('leaves the address alone when demoting away from an Org Lens page', () => {
    routerUrl = '/profile';
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  // Demotion is always about the caller now, so it updates the cookie like any other switch.
  it('updates the saved choice when the caller no longer holds two organizations', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    expect(service.isRollUp()).toBe(false);
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: UID_A });
  });

  // Regression, PR #4415 review 4 (cursor). The guards admit `/org/Family-{root}/people` — the match
  // guard normalizes before testing and the roll-up branch returns without canonicalizing — so an
  // un-normalized check left a mixed-case address on its combined-view URL after demotion.
  it('re-points a mixed-case roll-up address', () => {
    routerUrl = `/org/Family-${ROOT}/people`;
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(UrlSerializer).serialize(navigateByUrl.mock.calls[0][0])).toBe(`/org/${UID_A}/people`);
  });

  /**
   * Regression, PR #4415 review 4 (Copilot). `router.url` mid-navigation is the address being
   * *left*, not the one being entered, so correcting then would miss an arrival at a roll-up address and
   * could cancel the viewer's own navigation away from one.
   */
  it('waits for the router to be idle before re-pointing', async () => {
    currentNavigation = { id: 1 };
    routerUrl = '/';
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    // Nothing yet: a navigation is in flight, and `router.url` is still the address being left.
    expect(navigateByUrl).not.toHaveBeenCalled();

    // The navigation settles on the roll-up page.
    currentNavigation = null;
    routerUrl = `/org/${SEGMENT}/people`;
    routerEvents.next(new NavigationEnd(1, `/org/${SEGMENT}/people`, `/org/${SEGMENT}/people`));
    await Promise.resolve();

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(UrlSerializer).serialize(navigateByUrl.mock.calls[0][0])).toBe(`/org/${UID_A}/people`);
  });

  // The settled navigation may have re-selected the roll-up (a roll-up address the guard adopted
  // while this demotion was queued), in which case there is nothing left to correct.
  it('abandons the deferred re-point when the settled navigation is back in roll-up mode', async () => {
    currentNavigation = { id: 1 };
    routerUrl = '/';
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    // Eligibility returns (a late inherited grant) and something re-selects the roll-up — the
    // roll-up address the guard adopted while this demotion sat queued.
    grants.inheritedWriterSet.set(new Set([UID_B]));
    expect(service.selectRollUp(ROOT)).toBe(true);

    currentNavigation = null;
    routerUrl = `/org/${SEGMENT}/people`;
    routerEvents.next(new NavigationEnd(2, `/org/${SEGMENT}/people`, `/org/${SEGMENT}/people`));
    await Promise.resolve();

    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  /**
   * lfx-self-serve#4415 review 9. `orgPathParamGuard` used to decide this itself, and got two
   * things wrong that `demoteFromRollUp` already had right: it could reuse the roll-up as its own
   * fallback (`orgUrlSegment` answers the sentinel, so the re-point no-opped and the caller stayed
   * on roll-up), and it left the result unpinned where a persona re-seed could replace it.
   */
  /**
   * Cursor on PR #4415. `selected_uid` is a pin hint naming a `b2b_org` row for the org-items page
   * to include. The roll-up names none, and both the selection and the cookie can hold the
   * sentinel, so sending it was at best ignored and at worst rejected at the request boundary —
   * failing the list and leaving the panel with the roll-up row and nothing to switch to.
   */
  /**
   * Copilot on PR #4415. The grant-only stub carried `uid` but no `accountId`, and the pages key on
   * `accountId` — Events filters out a null one before its `switchMap`. Demoting off the roll-up
   * with that page open therefore fired no new request, leaving the combined results on screen
   * under the concrete organization's address.
   */
  it('carries accountId on a grant-only demotion target, not just uid', () => {
    service.selectRollUp(ROOT, { admitWhilePending: true });
    service.initializeUserOrganizations([]);
    grants.writerSet.set(new Set([UID_B]));

    const next = service.demoteAddressedRollUp(ROOT);

    expect(next?.uid).toBe(UID_B);
    expect(next?.accountId).toBe(UID_B);
  });

  // The same rule outside the addressed family: the caller's only organization sits in another one.
  it('carries accountId on a grant-only demotion target from another family', () => {
    const UID_C = '0014100000MgcCCCCC';
    service.selectRollUp(ROOT, { admitWhilePending: true });
    service.initializeUserOrganizations([]);
    grants.writerSet.set(new Set([UID_C]));

    const next = service.demoteAddressedRollUp(ROOT);

    expect(next?.uid).toBe(UID_C);
    expect(next?.accountId).toBe(UID_C);
  });

  /**
   * Cursor on PR #4415. With the grants settled below the minimum and no persona seeds, the stored
   * sentinel fell through to the placeholder path and stayed in the cookie — so the next bootstrap
   * restored the combined view during its unsettled window and flickered before demoting again.
   */
  it('replaces an ineligible roll-up cookie with a held organization when there are no seeds', () => {
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    grants.inheritedWriterSet.set(new Set([UID_B]));

    service.initializeUserOrganizations([]);

    expect(service.selectedAccount().uid).toBe(UID_B);
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: UID_B });
    // The stub has no display fields, so the canonical fetch has to be the thing that fills them.
    expect(httpGet).toHaveBeenCalled();
  });

  it('clears an ineligible roll-up cookie when there is nothing to fall back to', () => {
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));

    service.initializeUserOrganizations([]);

    expect(cookies.get(COOKIE)).toBeUndefined();
  });

  describe('orgListPinUid', () => {
    it('answers null while the roll-up is selected', () => {
      service.initializeUserOrganizations([seedA, seedB]);
      service.selectRollUp(ROOT);

      expect(service.selectedAccount().uid).toBe(SEGMENT);
      expect(service.orgListPinUid()).toBeNull();
    });

    it('answers the selected organization when one is selected', () => {
      service.initializeUserOrganizations([seedA, seedB]);

      expect(service.orgListPinUid()).toBe(UID_A);
    });
  });

  describe('demoteAddressedRollUp', () => {
    it('never answers with the roll-up itself', () => {
      service.initializeUserOrganizations([seedA, seedB]);
      service.selectRollUp(ROOT);
      expect(service.isRollUp()).toBe(true);

      const next = service.demoteAddressedRollUp(ROOT);

      expect(next).not.toBeNull();
      expect(next?.uid).not.toBe(SEGMENT);
      expect(service.isRollUp()).toBe(false);
    });

    it('writes the concrete choice when the caller no longer qualifies', () => {
      cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
      service.initializeUserOrganizations([seedA, seedB]);
      service.selectRollUp(ROOT);
      // The caller holds one organization now.
      service.initializeUserOrganizations([seedA]);

      service.demoteAddressedRollUp(ROOT);

      expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: UID_A });
    });

    // Pinned like a resolver hit, so a persona re-seed cannot replace it before the address lands.
    it('pins the result as an address selection', () => {
      service.initializeUserOrganizations([seedA, seedB]);
      service.selectRollUp(ROOT);

      const next = service.demoteAddressedRollUp(ROOT);

      expect(next?.uid).toBe(UID_A);
      expect(service.isAdoptedFromAddress()).toBe(true);

      // The re-seed that used to clear it.
      service.initializeUserOrganizations([seedA, seedB]);
      expect(service.selectedAccount().uid).toBe(UID_A);
    });

    /**
     * Copilot on PR #4415. `orgUrlSegment(current)` proves the current selection is *addressable*,
     * not that this caller holds it. A stale concrete selection of A, with the settled grants
     * naming only B and no persona seeds, was therefore pinned and persisted as the demotion
     * target — over the one organization they do have.
     */
    it('falls back to a held organization, not a stale addressable selection', () => {
      // On A from an earlier navigation; the grants now name only B, and there are no seeds.
      service.adoptFromAddress({ accountId: UID_A, accountName: 'Alpha', membershipTier: '', uid: UID_A, slug: 'alpha-inc' });
      grants.inheritedWriterSet.set(new Set([UID_B]));
      service.initializeUserOrganizations([]);

      const next = service.demoteAddressedRollUp(ROOT);

      expect(next?.uid).toBe(UID_B);
      expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: UID_B });
    });

    // A link to family A lands in A while the caller still holds an organization there, not in
    // whichever unrelated company they were viewing before.
    it('prefers an organization in the addressed family over an unrelated current selection', () => {
      const UID_X = '0014100000MgxXXXXX';
      const seedX: Account = { accountId: UID_X, accountName: 'Xray', membershipTier: '', uid: UID_X };
      service.initializeUserOrganizations([seedX]);
      service.setAccount(seedX);
      grants.inheritedWriterSet.set(new Set([UID_B]));

      expect(service.demoteAddressedRollUp(ROOT)?.uid).toBe(UID_B);
    });

    // A CLA-only organization is not part of a roll-up but is a real address (M3: the EasyCLA tab),
    // so the caller stays on it rather than being bounced to the not-found dead end.
    it('keeps a CLA-only organization the caller is already addressing', () => {
      claOnlyOrgUids.set(new Set([UID_A]));
      service.adoptFromAddress({ accountId: UID_A, accountName: 'Alpha', membershipTier: '', uid: UID_A, slug: 'alpha-inc' });
      service.initializeUserOrganizations([]);

      expect(service.demoteAddressedRollUp(ROOT)?.uid).toBe(UID_A);
    });

    /**
     * Copilot on PR #4415. The addressing case above kept a CLA-only organization, but the
     * fallback that picks one did not look at `claOnlyOrgUids` at all — so a caller sitting on
     * roll-up whose Org Lens grants had lapsed, with only a CLA-manager company left, demoted
     * to `null` and landed on `/org/not-found` while still holding a page they could open.
     */
    it('falls back to a CLA-only organization rather than the not-found dead end', () => {
      // On the roll-up itself, so there is no concrete selection to keep; nothing but CLA-only left.
      service.selectRollUp(ROOT, { admitWhilePending: true });
      service.initializeUserOrganizations([]);
      claOnlyOrgUids.set(new Set([UID_A]));

      expect(service.demoteAddressedRollUp(ROOT)?.uid).toBe(UID_A);
    });

    // A held grant outranks a CLA-only company: the roll-up combines the former, never the latter.
    it('prefers a granted organization over a CLA-only one', () => {
      service.selectRollUp(ROOT, { admitWhilePending: true });
      service.initializeUserOrganizations([]);
      grants.writerSet.set(new Set([UID_B]));
      claOnlyOrgUids.set(new Set([UID_A]));

      expect(service.demoteAddressedRollUp(ROOT)?.uid).toBe(UID_B);
    });

    // A staff viewer reaches every organization with no grant of their own.
    it('keeps the current organization for a staff viewer', () => {
      grants.isStaff.set(true);
      service.adoptFromAddress({ accountId: UID_A, accountName: 'Alpha', membershipTier: '', uid: UID_A, slug: 'alpha-inc' });
      service.initializeUserOrganizations([]);

      expect(service.demoteAddressedRollUp(ROOT)?.uid).toBe(UID_A);
    });

    it('answers null when there is nothing addressable to fall back to', () => {
      service.initializeUserOrganizations([]);
      expect(service.demoteAddressedRollUp(ROOT)).toBeNull();
    });
  });

  /**
   * Regression, PR #4415 review 10 (high). On a cold a roll-up address deep link the grants have not
   * answered, so a caller with no persona seeds had nothing to be demoted to and the guard's only
   * answer was `/org/not-found`: a dead end later grants cannot repair, since reconciliation stops
   * once the roll-up is deselected.
   */
  it('admits a cold roll-up visit it cannot yet decide, rather than stranding the caller', () => {
    grants.loaded.set(false);
    service.initializeUserOrganizations([]);

    expect(service.selectRollUp(ROOT, { admitWhilePending: true })).toBe(true);
    expect(service.demoteAddressedRollUp(ROOT)).toBeNull();
  });

  /**
   * Regression, PR #4415 review 12. The admission above and the reconciliation effect asked the same
   * question differently: the effect checked only "pending or eligible", so it demoted the visit it
   * had just been admitted, queued `/org/not-found`, and — because reconciliation returns early once
   * the roll-up is deselected — the later grants could never undo it. The earlier specs missed it by
   * never flushing the effect while the answer was still unknown.
   */
  it('survives an effect flush while the fallback is still undecidable', () => {
    grants.loaded.set(false);
    service.initializeUserOrganizations([]);
    service.selectRollUp(ROOT, { admitWhilePending: true });

    // The flush that used to strand the caller.
    TestBed.tick();

    expect(service.isRollUp()).toBe(true);
    expect(navigateSpy).not.toHaveBeenCalled();

    // Grants finally answer, and only then does the demotion run.
    grants.inheritedWriterSet.set(new Set([UID_B]));
    grants.loaded.set(true);
    TestBed.tick();

    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_B);
  });

  it('demotes that caller as soon as the grants name an organization', () => {
    grants.loaded.set(false);
    service.initializeUserOrganizations([]);
    service.selectRollUp(ROOT, { admitWhilePending: true });

    grants.inheritedWriterSet.set(new Set([UID_B]));
    grants.loaded.set(true);
    TestBed.tick();

    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_B);
  });

  // Settled grants with nothing in them is a real answer, so the dead end is still correct.
  it('still refuses when the grants have settled on nothing', () => {
    grants.loaded.set(true);
    service.initializeUserOrganizations([]);

    expect(service.selectRollUp(ROOT, { admitWhilePending: true })).toBe(false);
  });

  /**
   * Regression, PR #4415 review 11. The effect-driven demotion applied its fallback with a bare
   * `setAccount`, leaving it unpinned — so for a grant-only caller an empty persona re-seed between
   * the demotion and the router settling reset the selection to the placeholder, and the deferred
   * re-point then read that placeholder and redirected to `/org/not-found` despite the grant.
   */
  it('pins the effect-driven demotion fallback against an empty re-seed', () => {
    currentNavigation = { id: 1 };
    routerUrl = '/';
    grants.inheritedWriterSet.set(new Set([UID_B]));
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: SEGMENT }));
    service.initializeUserOrganizations([]);
    expect(service.isRollUp()).toBe(true);

    // Grants settle on one organization: demotion fires, the re-point is deferred behind the
    // in-flight navigation.
    grants.loaded.set(true);
    TestBed.tick();
    expect(service.selectedAccount().uid).toBe(UID_B);

    // The persona refresh lands, with nothing in it — this used to blank the selection.
    service.initializeUserOrganizations([]);
    expect(service.selectedAccount().uid).toBe(UID_B);

    // So the deferred re-point addresses the organization, not the dead end.
    currentNavigation = null;
    routerUrl = `/org/${SEGMENT}/people`;
    routerEvents.next(new NavigationEnd(1, `/org/${SEGMENT}/people`, `/org/${SEGMENT}/people`));

    return Promise.resolve().then(() => {
      expect(navigateSpy).not.toHaveBeenCalled();
      expect(navigateByUrl).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(UrlSerializer).serialize(navigateByUrl.mock.calls[0][0])).toBe(`/org/${UID_B}/people`);
    });
  });
});
