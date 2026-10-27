// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, NavigationEnd, Router, UrlSerializer } from '@angular/router';
import { FEATURE_FLAG_READY_TIMEOUT_MS } from '@lfx-one/shared/constants';
import { Account, OrgCanonicalRecord, OrgLensAccountContextResponse, OrgLensLookupOutcome } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    claManagerOrgSet: WritableSignal<Set<string>>;
  };
  let claM3Flag: WritableSignal<boolean>;

  beforeEach(() => {
    cookies = new Map();
    claM3Flag = signal(false);
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
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => claM3Flag } },
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

    it('is true for a CLA-only organization alone while org-lens-cla-m3-enabled is on', () => {
      grants.claManagerOrgSet.set(new Set([UID_A]));
      claM3Flag.set(true);
      expect(service.hasOrgSelectorAccess()).toBe(true);
    });

    it('ignores CLA-only organizations while org-lens-cla-m3-enabled is off', () => {
      grants.claManagerOrgSet.set(new Set([UID_A]));
      expect(service.hasOrgSelectorAccess()).toBe(false);
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
        { provide: OrgRoleGrantsService, useValue: { writerSet: signal(new Set()), auditorSet: signal(new Set()), isStaff: signal(false) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
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

/**
 * lfx-self-serve#4125 / #4133 — the All Organizations roll-up selection. It is a view mode keyed on
 * a reserved sentinel rather than a `b2b_org` row, so it has to survive the cookie round-trip,
 * address as `/org/all/…`, and never reach an `:orgUid` endpoint.
 */
describe('AccountContextService — All Organizations roll-up', () => {
  const UID_A = '0014100000MgaAAAAA';
  const UID_B = '0014100000MgbBBBBB';
  const seedA: Account = { accountId: UID_A, accountName: 'Alpha', membershipTier: '', uid: UID_A };
  const seedB: Account = { accountId: UID_B, accountName: 'Bravo', membershipTier: '', uid: UID_B };
  const COOKIE = 'lfx-selected-account';

  let cookies: Map<string, string>;
  let service: AccountContextService;
  let httpGet: ReturnType<typeof vi.fn>;
  let rollUpFlag: WritableSignal<boolean>;
  let providerReady: WritableSignal<boolean>;
  let routerUrl: string;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let navigateSpy: ReturnType<typeof vi.fn>;
  let currentNavigation: unknown;
  let routerEvents: Subject<unknown>;
  let flagInitialized: WritableSignal<boolean>;
  /** Rows the Snowflake enrichment answers with; `toAccount` maps these and carries no `uid`. */
  let liveRows: OrgLensAccountContextResponse[];
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

  /** The roll-up suite's TestBed wiring, reusable so a test can rebuild the service (e.g. under fake timers). */
  const configureRollUpTestBed = (): void => {
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
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => rollUpFlag, providerReady, initialized: flagInitialized } },
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
  };

  beforeEach(() => {
    cookies = new Map();
    rollUpFlag = signal(true);
    providerReady = signal(true);
    routerUrl = '/org/all/people';
    navigateByUrl = vi.fn();
    navigateSpy = vi.fn();
    currentNavigation = null;
    routerEvents = new Subject<unknown>();
    flagInitialized = signal(true);
    liveRows = [];
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
    configureRollUpTestBed();
    service = TestBed.inject(AccountContextService);
  });

  // The whole surface is dark-launched until the BFF accepts the sentinel (#4127).
  it('offers nothing while the feature flag is off, however many organizations the caller holds', () => {
    rollUpFlag.set(false);
    service.initializeUserOrganizations([seedA, seedB]);
    expect(service.canSelectRollUp()).toBe(false);
    expect(service.selectRollUp()).toBe(false);
  });

  it('counts persona seeds and grant sets together, de-duplicated by uid', () => {
    service.initializeUserOrganizations([seedA]);
    expect(service.rollUpOrganizationCount()).toBe(1);
    expect(service.canSelectRollUp()).toBe(false);

    // The same organization held by seed *and* grant is still one organization.
    grants.writerSet.set(new Set([UID_A]));
    expect(service.rollUpOrganizationCount()).toBe(1);

    // An inherited grant adds a sibling the persona seeds never carried — the conglomerate case.
    grants.inheritedWriterSet.set(new Set([UID_B]));
    expect(service.rollUpOrganizationCount()).toBe(2);
    expect(service.canSelectRollUp()).toBe(true);
  });

  it('refuses the selection for a caller holding one organization', () => {
    service.initializeUserOrganizations([seedA]);
    expect(service.selectRollUp()).toBe(false);
    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_A);
  });

  it('selects, addresses as /org/all and persists the sentinel', () => {
    service.initializeUserOrganizations([seedA, seedB]);
    expect(service.selectRollUp()).toBe(true);
    expect(service.isRollUp()).toBe(true);
    expect(service.selectedUrlSegment()).toBe('all');
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: 'all' });
  });

  // The whole point of widening the cookie round-trip: a refresh must not drop the caller back
  // into a single company.
  it('restores the roll-up from the cookie on the next bootstrap', () => {
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA, seedB]);
    expect(service.isRollUp()).toBe(true);
    expect(service.selectedAccount().accountName).toBe('All Organizations');
  });

  /**
   * A conglomerate's siblings arrive as inherited grants, which load after the persona seeds. A
   * restore that trusted the count at that instant would demote the caller to one company and
   * overwrite the cookie that said otherwise.
   */
  it('restores optimistically while the grant sets are still loading', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);
    expect(service.isRollUp()).toBe(true);
  });

  it('demotes a restored roll-up once the grants confirm a single organization', () => {
    grants.loaded.set(true);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);
    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_A);
  });

  // A caller whose organizations are all inherited grants has no persona seeds at all; the restore
  // must happen before the empty-seeds bail-out or it is lost.
  it('restores for a caller with no persona seeds', () => {
    grants.inheritedWriterSet.set(new Set([UID_A, UID_B]));
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([]);
    expect(service.isRollUp()).toBe(true);
  });

  // `/api/orgs/uid/all` is not a thing: the sentinel names a set, and that endpoint takes an SFID.
  it('never asks for a canonical record for the sentinel', async () => {
    service.initializeUserOrganizations([seedA, seedB]);
    service.selectRollUp();
    httpGet.mockClear();
    await service.refreshCanonicalRecord(service.selectedAccount());
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('leaves roll-up mode when a concrete organization is selected', () => {
    service.initializeUserOrganizations([seedA, seedB]);
    service.selectRollUp();
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
    expect(service.rollUpOrganizationCount()).toBe(2);
    expect(service.canSelectRollUp()).toBe(true);
  });

  // Regression, PR #4415 review: the optimistic restore pinned the selection, so every later
  // bootstrap returned early and nothing re-judged eligibility once the grants landed.
  it('demotes an optimistically restored roll-up when the grants settle against it', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);
    expect(service.isRollUp()).toBe(true);

    grants.loaded.set(true);
    TestBed.tick();

    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_A);
  });

  it('keeps an optimistically restored roll-up when the grants confirm it', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);

    grants.inheritedWriterSet.set(new Set([UID_B]));
    grants.loaded.set(true);
    TestBed.tick();

    expect(service.isRollUp()).toBe(true);
  });

  // The Events family keys on `:accountId`; a falsy one is filtered out by those consumers.
  it('carries the sentinel in accountId as well as uid', () => {
    service.initializeUserOrganizations([seedA, seedB]);
    service.selectRollUp();
    expect(service.getAccountId()).toBe('all');
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
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);
    expect(service.isRollUp()).toBe(true);

    // The outage: loaded flips true, every grant set is empty, outcome is 'failed'.
    grants.loaded.set(true);
    grants.lookupOutcome.set('failed');
    TestBed.tick();

    expect(service.isRollUp()).toBe(true);
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: 'all' });
  });

  // A partial roll-up expansion is a lower bound for the same reason.
  it('keeps the roll-up while the grants lookup is only partial', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    grants.lookupOutcome.set('partial');
    TestBed.tick();

    expect(service.isRollUp()).toBe(true);
  });

  /**
   * Regression, PR #4415 review 3 (high). `AppComponent` calls `initializeUserOrganizations()`
   * before `featureFlagService.initialize()`, and `getBooleanFlag` answers false until the provider
   * streams real values — so the flag I added read as "feature off" at restore time and the saved
   * `{ uid: 'all' }` was overwritten with the first seed before LaunchDarkly had been asked.
   */
  it('does not treat an unresolved feature flag as a disabled one', () => {
    providerReady.set(false);
    flagInitialized.set(false);
    rollUpFlag.set(false); // what getBooleanFlag answers before the provider is ready
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));

    service.initializeUserOrganizations([seedA, seedB]);

    expect(service.isRollUp()).toBe(true);
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: 'all' });
  });

  it('demotes once the provider confirms the flag is genuinely off', () => {
    providerReady.set(false);
    flagInitialized.set(false);
    rollUpFlag.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA, seedB]);

    providerReady.set(true);
    TestBed.tick();

    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_A);
  });

  /**
   * Regression, PR #4415 review 3. Eligibility counts inherited grants, but the demotion fallback
   * only looked at persona seeds — so a caller holding one inherited organization and no seed was
   * dropped to the placeholder with their cookie cleared, rather than onto the organization they
   * still held.
   */
  it('demotes onto a granted organization when the caller has no persona seeds', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
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
   * `/org/all/…`, so page consumers rendered one organization's data under a combined-view URL.
   */
  it('re-points the address off /org/all when it demotes, keeping the page', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    const [tree, extras] = navigateByUrl.mock.calls[0];
    expect(TestBed.inject(UrlSerializer).serialize(tree)).toBe(`/org/${UID_A}/people`);
    expect(extras).toEqual({ replaceUrl: true });
  });

  it('leaves the address alone when demoting away from an Org Lens page', () => {
    routerUrl = '/profile';
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  /**
   * Regression, PR #4415 review 6. `initialized` is set once `OpenFeature.setContext()` resolves —
   * which happens even when the raw provider status is ERROR, with `providerReady` left false and
   * error recovery armed. Ending the wait on it meant a slow LaunchDarkly read exactly like a
   * disabled flag, and the demotion that followed took the caller's cookie with it.
   */
  it('keeps waiting when initialization finished but the provider never became ready', () => {
    providerReady.set(false);
    flagInitialized.set(true);
    rollUpFlag.set(false); // every flag reads its default while the provider is not READY
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));

    service.initializeUserOrganizations([seedA, seedB]);
    TestBed.tick();

    expect(service.isRollUp()).toBe(true);
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: 'all' });
  });

  /**
   * The flag being off makes the roll-up unavailable, not wrong for this caller. The live selection
   * must change so nothing renders under a roll-up the BFF cannot serve, but the saved choice is
   * theirs and is honoured again when the flag returns.
   */
  it('changes the live selection but keeps the saved choice when the flag is off', () => {
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA, seedB]);
    expect(service.isRollUp()).toBe(true);

    rollUpFlag.set(false);
    TestBed.tick();

    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_A);
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: 'all' });
  });

  // Losing organizations IS about the caller, so that demotion updates the cookie like any switch.
  it('updates the saved choice when the caller no longer holds two organizations', () => {
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    expect(service.isRollUp()).toBe(false);
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: UID_A });
  });

  // Regression, PR #4415 review 4 (cursor). The guards admit `/org/All/people` — the match guard
  // lowercases before testing and the roll-up branch returns without canonicalizing — so an
  // un-normalized check left a mixed-case address on its combined-view URL after demotion.
  it('re-points a mixed-case roll-up address', () => {
    routerUrl = '/org/All/people';
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(UrlSerializer).serialize(navigateByUrl.mock.calls[0][0])).toBe(`/org/${UID_A}/people`);
  });

  /**
   * Regression, PR #4415 review 4 (Copilot). `router.url` mid-navigation is the address being
   * *left*, not the one being entered, so correcting then would miss an arrival at `/org/all/…` and
   * could cancel the viewer's own navigation away from one.
   */
  it('waits for the router to be idle before re-pointing', async () => {
    currentNavigation = { id: 1 };
    routerUrl = '/';
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    // Nothing yet: a navigation is in flight, and `router.url` is still the address being left.
    expect(navigateByUrl).not.toHaveBeenCalled();

    // The navigation settles on the roll-up page.
    currentNavigation = null;
    routerUrl = '/org/all/people';
    routerEvents.next(new NavigationEnd(1, '/org/all/people', '/org/all/people'));
    await Promise.resolve();

    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(UrlSerializer).serialize(navigateByUrl.mock.calls[0][0])).toBe(`/org/${UID_A}/people`);
  });

  // The settled navigation may have re-selected the roll-up (a `/org/all` address the guard adopted
  // while this demotion was queued), in which case there is nothing left to correct.
  it('abandons the deferred re-point when the settled navigation is back in roll-up mode', async () => {
    currentNavigation = { id: 1 };
    routerUrl = '/';
    grants.loaded.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA]);

    grants.loaded.set(true);
    TestBed.tick();

    // Eligibility returns (a late inherited grant) and something re-selects the roll-up — the
    // `/org/all` address the guard adopted while this demotion sat queued.
    grants.inheritedWriterSet.set(new Set([UID_B]));
    expect(service.selectRollUp()).toBe(true);

    currentNavigation = null;
    routerUrl = '/org/all/people';
    routerEvents.next(new NavigationEnd(2, '/org/all/people', '/org/all/people'));
    await Promise.resolve();

    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  /**
   * Regression, PR #4415 review 8. `rollUpFlagResolved` is `providerReady() || wait elapsed`, so
   * once the provider never becomes READY the constructor's timer is the ONLY thing that closes the
   * pending window — and it is the fix for review 4's fail-open, where `/org/all` stayed admitted
   * for the whole session while LaunchDarkly was unreachable. No spec drove that timer, so dropping
   * or mis-arming it would have reinstated the fail-open silently.
   */
  describe('the fail-closed timeout on the flag wait', () => {
    // The timer is armed in the service constructor, which the outer `beforeEach` has already run —
    // so the clock has to be faked before that, and the service rebuilt against it.
    beforeEach(() => {
      vi.useFakeTimers();
      TestBed.resetTestingModule();
      configureRollUpTestBed();
      service = TestBed.inject(AccountContextService);
    });
    afterEach(() => vi.useRealTimers());

    it('closes the pending window when the provider never becomes ready', () => {
      providerReady.set(false);
      flagInitialized.set(false);
      rollUpFlag.set(false);
      cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));

      service.initializeUserOrganizations([seedA, seedB]);
      expect(service.isRollUp()).toBe(true);

      vi.advanceTimersByTime(FEATURE_FLAG_READY_TIMEOUT_MS);
      TestBed.tick();

      expect(service.isRollUp()).toBe(false);
    });

    // Closing the window is about availability, not about this caller, so the choice survives it.
    it('keeps the saved choice when the window closes without a ready provider', () => {
      providerReady.set(false);
      flagInitialized.set(false);
      rollUpFlag.set(false);
      cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
      service.initializeUserOrganizations([seedA, seedB]);

      vi.advanceTimersByTime(FEATURE_FLAG_READY_TIMEOUT_MS);
      TestBed.tick();

      expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: 'all' });
    });
  });

  /**
   * Regression, PR #4415 review 8 (cursor/Copilot). `persist: false` guarded only the demotion's own
   * write. The grant-only fallback hydrates through `refreshCanonicalRecord`, and
   * `applyCanonicalRecord` persists unconditionally — so the concrete uid reached the cookie a
   * moment later anyway, for exactly the inherited-grants caller this path exists for.
   */
  it('keeps the saved choice through canonical hydration after an unavailability demotion', async () => {
    // No persona seeds; two organizations, both inherited grants — the caller this path exists for.
    httpGet.mockReturnValue(of({ uid: UID_A, accountId: UID_A, name: 'Alpha Inc', logoUrl: null, parentUid: null }));
    grants.inheritedWriterSet.set(new Set([UID_A, UID_B]));
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([]);
    expect(service.isRollUp()).toBe(true);

    rollUpFlag.set(false);
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_A);
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: 'all' });
  });

  // An indexed slug landing after the demotion must not write the concrete uid either.
  it('keeps the saved choice when an indexed slug arrives afterwards', () => {
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA, seedB]);
    rollUpFlag.set(false);
    TestBed.tick();

    service.setIndexedSlug('alpha-inc');

    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: 'all' });
  });

  // The hold ends the moment the caller chooses for themselves.
  it('releases the hold on a deliberate organization switch', () => {
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([seedA, seedB]);
    rollUpFlag.set(false);
    TestBed.tick();

    service.setAccount(seedB);

    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: UID_B });
  });

  /**
   * lfx-self-serve#4415 review 9. `orgPathParamGuard` used to decide this itself, and got three
   * things wrong that `demoteFromRollUp` already had right: it persisted over the saved choice
   * whatever the reason, it could reuse the roll-up as its own fallback (`orgUrlSegment` answers the
   * sentinel, so the re-point no-opped and the caller stayed on `/org/all`), and it left the result
   * unpinned where a persona re-seed could replace it.
   */
  describe('demoteAddressedRollUp', () => {
    it('never answers with the roll-up itself', () => {
      service.initializeUserOrganizations([seedA, seedB]);
      service.selectRollUp();
      expect(service.isRollUp()).toBe(true);

      grants.inheritedWriterSet.set(new Set([UID_B]));
      rollUpFlag.set(false);

      const next = service.demoteAddressedRollUp();

      expect(next).not.toBeNull();
      expect(next?.uid).not.toBe('all');
      expect(service.isRollUp()).toBe(false);
    });

    it('keeps the saved choice when the roll-up is merely unavailable', () => {
      cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
      service.initializeUserOrganizations([seedA, seedB]);
      rollUpFlag.set(false);

      service.demoteAddressedRollUp();

      expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: 'all' });
    });

    it('writes the concrete choice when the caller no longer qualifies', () => {
      cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
      service.initializeUserOrganizations([seedA, seedB]);
      service.selectRollUp();
      // Flag still on; the caller simply holds one organization now.
      service.initializeUserOrganizations([seedA]);

      service.demoteAddressedRollUp();

      expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: UID_A });
    });

    // Pinned like a resolver hit, so a persona re-seed cannot replace it before the address lands.
    it('pins the result as an address selection', () => {
      service.initializeUserOrganizations([seedA, seedB]);
      service.selectRollUp();
      rollUpFlag.set(false);

      const next = service.demoteAddressedRollUp();

      expect(next?.uid).toBe(UID_A);
      expect(service.isAdoptedFromAddress()).toBe(true);

      // The re-seed that used to clear it.
      service.initializeUserOrganizations([seedA, seedB]);
      expect(service.selectedAccount().uid).toBe(UID_A);
    });

    it('answers null when there is nothing addressable to fall back to', () => {
      service.initializeUserOrganizations([]);
      expect(service.demoteAddressedRollUp()).toBeNull();
    });
  });

  // Review 9: the bootstrap fall-through reached with a sentinel cookie and the flag resolved off
  // must not write the default selection over the stored choice either.
  it('keeps the saved choice when bootstrap defaults past an unavailable roll-up', () => {
    rollUpFlag.set(false);
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));

    service.initializeUserOrganizations([seedA, seedB]);

    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_A);
    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: 'all' });
  });

  /**
   * Regression, PR #4415 review 10. The demotion re-points the address; that navigation runs
   * `orgPathParamGuard`, which adopts through `adoptFromAddress` → `setAccount`. An ordinary write
   * clears the hold, so the demotion's own follow-up wrote the concrete uid over `{ uid: 'all' }` a
   * moment after taking the hold — for the inherited-grants caller it exists for.
   */
  it('survives the address adoption its own re-point sets off', () => {
    grants.inheritedWriterSet.set(new Set([UID_A, UID_B]));
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([]);
    expect(service.isRollUp()).toBe(true);

    rollUpFlag.set(false);
    TestBed.tick();
    const demotedTo = service.selectedAccount().uid as string;

    // What the guard does on the re-pointed navigation.
    service.adoptFromAddress({ accountId: demotedTo, accountName: 'Alpha Inc', membershipTier: '', uid: demotedTo, slug: 'alpha-inc' });

    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: 'all' });
  });

  // A different organization is the caller going somewhere themselves, which IS a choice.
  it('releases the hold when a different organization is adopted from an address', () => {
    grants.inheritedWriterSet.set(new Set([UID_A, UID_B]));
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
    service.initializeUserOrganizations([]);
    rollUpFlag.set(false);
    TestBed.tick();

    const other = service.selectedAccount().uid === UID_A ? UID_B : UID_A;
    service.adoptFromAddress({ accountId: other, accountName: 'Other', membershipTier: '', uid: other, slug: 'other-inc' });

    expect(JSON.parse(cookies.get(COOKIE) as string)).toEqual({ uid: other });
  });

  /**
   * Regression, PR #4415 review 10 (high). With the flag resolved off and the grants not yet
   * answered, `rollUpEligibilityPending` short-circuits to false — so a caller with no persona
   * seeds had nothing to be demoted to, and the guard's only answer was `/org/not-found`: a dead
   * end later grants cannot repair, since reconciliation stops once the roll-up is deselected.
   */
  it('admits a cold /org/all visit it cannot yet decide, rather than stranding the caller', () => {
    rollUpFlag.set(false);
    grants.loaded.set(false);
    service.initializeUserOrganizations([]);

    expect(service.selectRollUp({ admitWhilePending: true })).toBe(true);
    expect(service.demoteAddressedRollUp()).toBeNull();
  });

  /**
   * Regression, PR #4415 review 12. The admission above and the reconciliation effect asked the same
   * question differently: the effect checked only "pending or eligible", so it demoted the visit it
   * had just been admitted, queued `/org/not-found`, and — because reconciliation returns early once
   * the roll-up is deselected — the later grants could never undo it. The earlier specs missed it by
   * never flushing the effect while the answer was still unknown.
   */
  it('survives an effect flush while the fallback is still undecidable', () => {
    rollUpFlag.set(false);
    grants.loaded.set(false);
    service.initializeUserOrganizations([]);
    service.selectRollUp({ admitWhilePending: true });

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
    rollUpFlag.set(false);
    grants.loaded.set(false);
    service.initializeUserOrganizations([]);
    service.selectRollUp({ admitWhilePending: true });

    grants.inheritedWriterSet.set(new Set([UID_B]));
    grants.loaded.set(true);
    TestBed.tick();

    expect(service.isRollUp()).toBe(false);
    expect(service.selectedAccount().uid).toBe(UID_B);
  });

  // Settled grants with nothing in them is a real answer, so the dead end is still correct.
  it('still refuses when the grants have settled on nothing', () => {
    rollUpFlag.set(false);
    grants.loaded.set(true);
    service.initializeUserOrganizations([]);

    expect(service.selectRollUp({ admitWhilePending: true })).toBe(false);
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
    cookies.set(COOKIE, JSON.stringify({ uid: 'all' }));
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
    routerUrl = '/org/all/people';
    routerEvents.next(new NavigationEnd(1, '/org/all/people', '/org/all/people'));

    return Promise.resolve().then(() => {
      expect(navigateSpy).not.toHaveBeenCalled();
      expect(navigateByUrl).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(UrlSerializer).serialize(navigateByUrl.mock.calls[0][0])).toBe(`/org/${UID_B}/people`);
    });
  });
});
