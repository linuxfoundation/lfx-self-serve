// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Event, Navigation, NavigationCancel, NavigationEnd, NavigationSkipped, provideRouter, Router } from '@angular/router';
import { Account, OrgItem, OrgItemsResponse } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountContextService } from './account-context.service';
import { LensService } from './lens.service';
import { OrgClaOnlyAccessService } from './org-cla-only-access.service';
import { OrgLensNavigationService } from './org-lens-navigation.service';
import { OrgNavigationService } from './org-navigation.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

/**
 * The default-selection path: what the org-selector's bootstrap does with the first org-items page
 * when a selection is pending. Its one address side effect is a `default` re-address — never a
 * `switch` — so the not-found dead end and an already-addressed organization are left alone
 * (spec 050 FR-011, FR-022–FR-024; `OrgLensNavigationService` owns those two rules).
 */
describe('OrgNavigationService default selection', () => {
  const UID_A = '0014100000MgaAAAAA';
  const UID_B = '0014100000MgbBBBBB';
  const item = (uid: string, name: string, extra: Partial<OrgItem> = {}): OrgItem => ({
    uid,
    accountId: uid,
    name,
    logoUrl: null,
    slug: name.toLowerCase(),
    ...extra,
  });
  const page = (items: OrgItem[]): OrgItemsResponse => ({ items, next_page_token: null, upstream_failed: false });
  const placeholder: Account = { accountId: '', accountName: '', membershipTier: '' };

  let selectedAccount: WritableSignal<Account>;
  let isAdoptedFromAddress: ReturnType<typeof vi.fn>;
  let setAccount: ReturnType<typeof vi.fn>;
  let setIndexedSlug: ReturnType<typeof vi.fn>;
  let pinSelection: ReturnType<typeof vi.fn>;
  // #2961 — set per test; an LF contractor's empty list is explained by the page, not the toast.
  const isContractor = signal(false);
  const isStaff = signal(false);
  let clearAccount: ReturnType<typeof vi.fn>;
  let writerSet: WritableSignal<Set<string>>;
  let auditorSet: WritableSignal<Set<string>>;
  let inheritedWriterSet: WritableSignal<Set<string>>;
  let inheritedAuditorSet: WritableSignal<Set<string>>;
  let grantsLoaded: WritableSignal<boolean>;
  let grantsError: WritableSignal<string | null>;
  let claManagerOrgSet: WritableSignal<Set<string>>;
  let claManagerLookupFailed: WritableSignal<boolean>;
  let navigateToSelectedOrg: ReturnType<typeof vi.fn>;
  let isOnAddressedPage: ReturnType<typeof vi.fn>;
  let isRollUp: ReturnType<typeof vi.fn>;
  let refreshCanonicalRecord: ReturnType<typeof vi.fn>;
  let http: HttpTestingController;
  let service: OrgNavigationService;

  beforeEach(() => {
    selectedAccount = signal<Account>(placeholder);
    isAdoptedFromAddress = vi.fn(() => false);
    setAccount = vi.fn((account: Account) => selectedAccount.set(account));
    setIndexedSlug = vi.fn((slug: string | null) => selectedAccount.update((a) => ({ ...a, slug })));
    pinSelection = vi.fn();
    clearAccount = vi.fn(() => selectedAccount.set(placeholder));
    isContractor.set(false);
    isStaff.set(false);
    writerSet = signal(new Set<string>());
    auditorSet = signal(new Set<string>());
    inheritedWriterSet = signal(new Set<string>());
    inheritedAuditorSet = signal(new Set<string>());
    grantsLoaded = signal(true);
    grantsError = signal<string | null>(null);
    claManagerOrgSet = signal(new Set<string>());
    claManagerLookupFailed = signal(false);
    navigateToSelectedOrg = vi.fn();
    isOnAddressedPage = vi.fn(() => false);
    isRollUp = vi.fn(() => false);
    refreshCanonicalRecord = vi.fn(() => Promise.resolve());
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        MessageService,
        { provide: LensService, useValue: { setLens: vi.fn() } },
        {
          provide: OrgRoleGrantsService,
          useValue: {
            isStaff,
            isContractor,
            degraded: signal(false),
            writerSet,
            auditorSet,
            inheritedWriterSet,
            inheritedAuditorSet,
            loaded: grantsLoaded,
            error: grantsError,
            claManagerOrgSet,
            claManagerLookupFailed,
          },
        },
        { provide: OrgLensNavigationService, useValue: { navigateToSelectedOrg, isOnAddressedPage } },
        {
          provide: AccountContextService,
          useValue: {
            selectedAccount,
            isAdoptedFromAddress,
            setAccount,
            setIndexedSlug,
            pinSelection,
            clearAccount,
            refreshCanonicalRecord,
            getStoredUid: () => null,
            isRollUp,
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(OrgNavigationService);
  });

  afterEach(() => http.verify());

  /** One macrotask: lets a toObservable-driven subscription observe a signal change. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  const bootstrapWith = (items: OrgItem[]): void => {
    service.resetAndReload();
    http.expectOne((req) => req.url === '/api/nav/org-items').flush(page(items));
  };

  it('lists the CLA-only rows the server sends', () => {
    bootstrapWith([item(UID_B, 'Beta', { slug: null, claOnly: true }), item(UID_A, 'Acme')]);

    expect(service.items().map((row) => row.uid)).toEqual([UID_B, UID_A]);
  });

  // The default re-address reads the *current* address; mid-navigation that is the page being
  // left, so the write waits until the router is idle and then re-reads the destination. A cancel
  // that is immediately followed by another navigation (a guard redirect) is not idle yet.
  it('defers the re-address until the router is idle, through a cancel-and-redirect', async () => {
    const router = TestBed.inject(Router);
    const inFlight = vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({} as Navigation);
    const events = new Subject<Event>();
    Object.defineProperty(router, 'events', { get: () => events.asObservable() });
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);
    expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_A }));
    expect(navigateToSelectedOrg).not.toHaveBeenCalled();

    // The first navigation is cancelled by a redirect that is already in flight: still not idle.
    events.next(new NavigationCancel(1, '/org/roi', 'redirected'));
    await settle();
    expect(navigateToSelectedOrg).not.toHaveBeenCalled();

    // The router clears its current navigation only after emitting NavigationEnd (in the
    // transition's finalize) — the idle check must therefore run after the event, not during it.
    events.next(new NavigationEnd(2, '/org/people', '/org/people'));
    expect(navigateToSelectedOrg).not.toHaveBeenCalled();
    inFlight.mockReturnValue(null);
    await settle();

    expect(navigateToSelectedOrg).toHaveBeenCalledTimes(1);
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
  });

  // Two bootstraps while the router is busy (selector re-enabled, CLA return) must not leave two
  // deferred writes behind: the later one supersedes the earlier, and exactly one fires on idle.
  it('keeps at most one deferred write pending across overlapping bootstraps', async () => {
    const router = TestBed.inject(Router);
    const inFlight = vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({} as Navigation);
    const events = new Subject<Event>();
    Object.defineProperty(router, 'events', { get: () => events.asObservable() });
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    bootstrapWith([item(UID_A, 'Acme')]);
    bootstrapWith([item(UID_A, 'Acme')]);
    expect(navigateToSelectedOrg).not.toHaveBeenCalled();

    inFlight.mockReturnValue(null);
    // A skipped navigation is a settle event too.
    events.next(new NavigationSkipped(3, '/org/people', 'same url'));
    await settle();

    expect(navigateToSelectedOrg).toHaveBeenCalledTimes(1);
  });

  // DR-005 rung 4 refined (lfx-self-serve#2570, prod): the list is alphabetical with inherited rows
  // beside direct ones. An admin whose only direct writer grant is the parent organization, with
  // three inherited subsidiaries that sort first, must land on the parent — ranked authority-first,
  // the same order `OrgSelectorComponent.resolvePersona` uses (LFXV2-3029).
  describe('the default ranks the list authority-first', () => {
    const PARENT = '0014100000ParentAA';
    const SUB_EXPIRED = '0014100000ExpiredA';
    const SUB_ACTIVE = '0014100000ActiveAA';
    const list = () => [
      item(SUB_EXPIRED, 'Alpha Subsidiary Inc.', { isMember: false, status: 'Expired', parentName: 'Parent Corporation' }),
      item(SUB_ACTIVE, 'Beta Subsidiary, Inc.', { isMember: true, status: 'Active', parentName: 'Parent Corporation' }),
      item(PARENT, 'Parent Corporation', { isMember: true, status: 'Active' }),
    ];

    it('picks the direct writer grant over inherited rows that sort first', () => {
      writerSet.set(new Set([PARENT]));
      inheritedWriterSet.set(new Set([SUB_EXPIRED, SUB_ACTIVE]));
      bootstrapWith(list());
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: PARENT }));
    });

    it('an inherited writer outranks a direct auditor (authority first, not directness first)', () => {
      auditorSet.set(new Set([SUB_EXPIRED]));
      inheritedWriterSet.set(new Set([PARENT]));
      bootstrapWith(list());
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: PARENT }));
    });

    it('a direct auditor outranks an inherited auditor', () => {
      auditorSet.set(new Set([PARENT]));
      inheritedAuditorSet.set(new Set([SUB_ACTIVE]));
      bootstrapWith(list());
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: PARENT }));
    });

    it('within a band prefers an active member, keeping list order', () => {
      writerSet.set(new Set([SUB_EXPIRED, SUB_ACTIVE, PARENT]));
      bootstrapWith(list());
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: SUB_ACTIVE }));
    });

    it('reads the membership status case-insensitively', () => {
      writerSet.set(new Set([SUB_EXPIRED, PARENT]));
      bootstrapWith([item(SUB_EXPIRED, 'Alpha', { isMember: true, status: 'expired' }), item(PARENT, 'Parent', { isMember: true, status: ' ACTIVE ' })]);
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: PARENT }));
    });

    it('with no granted row at all (a staff catalogue, or grants that failed) prefers an active member, then the first row', () => {
      grantsError.set('boom');
      grantsLoaded.set(false);
      bootstrapWith(list());
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: SUB_ACTIVE }));

      setAccount.mockClear();
      selectedAccount.set(placeholder);
      bootstrapWith([item(SUB_EXPIRED, 'Alpha', { isMember: false, status: 'Expired' }), item(UID_B, 'Beta', { isMember: false })]);
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: SUB_EXPIRED }));
    });

    // The staff catalogue lists assigned rows first, then discovered ones; the membership preference
    // must not lift a discovered row over the viewer's own assigned rows.
    it("keeps the viewer's assigned rows ahead of discovered catalogue rows", () => {
      bootstrapWith([
        item(SUB_EXPIRED, 'Assigned Non-Member', { isMember: false, status: 'Expired', isAssigned: true }),
        item(UID_B, 'Discovered Active Member', { isMember: true, status: 'Active', isAssigned: false }),
      ]);
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: SUB_EXPIRED }));
    });

    // Grants arrive on their own request; org-items may land first. The default must not decide
    // against an empty, not-yet-loaded grant set — that would be the first-row bug back, intermittently.
    it('waits for the grants to load when org-items lands first, then ranks', async () => {
      grantsLoaded.set(false);
      bootstrapWith(list());
      expect(setAccount).not.toHaveBeenCalled();

      writerSet.set(new Set([PARENT]));
      grantsLoaded.set(true);
      await settle();
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: PARENT }));
      expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
    });

    // While the default waits, an address adoption (path guard, EasyCLA return) or a user pick can
    // land. The deferred default must not overwrite it — or clear its pin.
    it('does not overwrite a selection the viewer picked while it waited for grants', async () => {
      grantsLoaded.set(false);
      bootstrapWith(list());
      expect(setAccount).not.toHaveBeenCalled();

      // A plain pick: not address-pinned, only the uid changed.
      selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B, slug: 'beta' });
      writerSet.set(new Set([PARENT]));
      grantsLoaded.set(true);
      await settle();

      expect(setAccount).not.toHaveBeenCalled();
      expect(pinSelection).not.toHaveBeenCalled();
      expect(selectedAccount().uid).toBe(UID_B);
    });

    it('does not overwrite a selection that became address-pinned while it waited, even with the same uid', async () => {
      // Deferred for an unlisted selection (would re-default); the path guard then adopts that very
      // organization from an address before grants settle.
      selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B, slug: 'beta' });
      grantsLoaded.set(false);
      bootstrapWith(list());
      expect(setAccount).not.toHaveBeenCalled();

      isAdoptedFromAddress.mockReturnValue(true);
      writerSet.set(new Set([PARENT]));
      grantsLoaded.set(true);
      await settle();

      expect(setAccount).not.toHaveBeenCalled();
      expect(selectedAccount().uid).toBe(UID_B);
    });

    it('a reload while it waits supersedes the pending default; only the new page decides', async () => {
      grantsLoaded.set(false);
      bootstrapWith(list());
      expect(setAccount).not.toHaveBeenCalled();

      // The reload's own page — different rows; the stale waiter must not select from `list()`.
      writerSet.set(new Set([UID_B]));
      bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta', { isMember: true, status: 'Active' })]);
      grantsLoaded.set(true);
      await settle();

      expect(setAccount).toHaveBeenCalledTimes(1);
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B }));
    });

    it('proceeds when the grants request fails rather than waiting forever', async () => {
      grantsLoaded.set(false);
      bootstrapWith(list());
      expect(setAccount).not.toHaveBeenCalled();

      grantsError.set('boom');
      await settle();
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: SUB_ACTIVE }));
    });
  });

  it('selects the first organization and re-addresses the page as a default, not a switch', () => {
    bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

    expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_A, slug: 'acme' }));
    expect(refreshCanonicalRecord).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_A }));
    expect(navigateToSelectedOrg).toHaveBeenCalledTimes(1);
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
  });

  // lfx-self-serve#2570 (prod): the persona refresh can land after the default is selected — with no
  // seeds at all for a grant-only (staff) viewer — and would reset an unpinned selection to the
  // placeholder under the address just written. The default is pinned like an adopted selection,
  // and pinned *before* the write: landing in the gap would otherwise clear the selection, the write
  // would find no segment, and the legacy address would stay put, empty.
  it('pins the default selection before writing it into the address', () => {
    bootstrapWith([item(UID_A, 'Acme')]);

    expect(pinSelection).toHaveBeenCalledTimes(1);
    expect(pinSelection).toHaveBeenCalledWith('default');
    expect(pinSelection.mock.invocationCallOrder[0]).toBeGreaterThan(setAccount.mock.invocationCallOrder[0]);
    expect(pinSelection.mock.invocationCallOrder[0]).toBeLessThan(navigateToSelectedOrg.mock.invocationCallOrder[0]);
  });

  // A default pin came from this list, so it is not the address pin the early return above honours:
  // a later authoritative reload re-runs the selection, which is how a revoked organization is
  // released instead of kept for the rest of the session (Copilot on lfx-self-serve#2793).
  describe('a default-pinned selection on a later reload', () => {
    beforeEach(() => {
      // `isAdoptedFromAddress` stays false: the pin is a default one.
      selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B, slug: 'beta' });
    });

    it('re-defaults to the first row when the pinned organization is no longer listed', () => {
      bootstrapWith([item(UID_A, 'Acme')]);

      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_A }));
      expect(pinSelection).toHaveBeenCalledWith('default');
    });

    it('routes an empty list through the no-access handling, releasing the selection', () => {
      bootstrapWith([]);

      expect(clearAccount).toHaveBeenCalledTimes(1);
      expect(setAccount).not.toHaveBeenCalled();
    });

    // #2961: the page renders contractor-no-grant from the selection; the toast would repeat it as
    // employee copy, and clearing the selection would drop the organization the page checks.
    // A persona seed can start the list before the role grants answer; the empty-list decision waits for
    // them, so a contractor is never toasted and cleared on an early page.
    it('decides an empty list that lands before the grants only once they answer', () => {
      grantsLoaded.set(false);
      const add = vi.spyOn(TestBed.inject(MessageService), 'add');

      bootstrapWith([]);
      expect(add).not.toHaveBeenCalled();
      expect(clearAccount).not.toHaveBeenCalled();

      isContractor.set(true);
      grantsLoaded.set(true);
      TestBed.tick();

      expect(add).not.toHaveBeenCalled();
      expect(clearAccount).not.toHaveBeenCalled();
    });

    // Spec 050: an address adopted while the empty-list decision waited stays selected.
    it('keeps a selection an address adopted while the empty-list decision waited', () => {
      grantsLoaded.set(false);
      bootstrapWith([]);

      isAdoptedFromAddress.mockReturnValue(true);
      grantsLoaded.set(true);
      TestBed.tick();

      expect(clearAccount).not.toHaveBeenCalled();
    });

    it('still reports an empty list for a non-contractor once the grants answer', () => {
      grantsLoaded.set(false);
      bootstrapWith([]);
      expect(clearAccount).not.toHaveBeenCalled();

      grantsLoaded.set(true);
      TestBed.tick();

      expect(clearAccount).toHaveBeenCalledTimes(1);
    });

    it('leaves a contractor\u2019s empty list to the page: no toast, selection kept', () => {
      isContractor.set(true);
      const add = vi.spyOn(TestBed.inject(MessageService), 'add');

      bootstrapWith([]);

      expect(add).not.toHaveBeenCalled();
      expect(clearAccount).not.toHaveBeenCalled();
    });

    it('keeps it, re-pinned, when it is still listed', () => {
      bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

      expect(setAccount).not.toHaveBeenCalled();
      expect(clearAccount).not.toHaveBeenCalled();
      expect(pinSelection).toHaveBeenCalledWith('default');
    });

    // On an addressed page the address names the selection. A default from the list would leave
    // that address in place with another organization rendering under it — spec 050's silent
    // substitution — so the selection stays, whatever the list says (Copilot on lfx-self-serve#2793).
    it('never re-defaults under an address that names the unlisted organization', () => {
      isOnAddressedPage.mockReturnValue(true);

      bootstrapWith([item(UID_A, 'Acme')]);

      expect(setAccount).not.toHaveBeenCalled();
      expect(navigateToSelectedOrg).not.toHaveBeenCalled();
      expect(selectedAccount().uid).toBe(UID_B);
    });
  });

  // The organization the address named was access-verified by the resolver a moment ago; whether or
  // not it appears on the first page, it stays selected and the address is not touched.
  it('leaves an addressed selection alone', () => {
    isAdoptedFromAddress.mockReturnValue(true);
    // The premise of this spec: the URL names B. Left at the mock's default (`false`) when this was
    // written, because nothing read it then — an address-pinned selection on an *unaddressed* URL
    // is a different case, and now has its own specs above.
    isOnAddressedPage.mockReturnValue(true);
    selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B });

    bootstrapWith([item(UID_A, 'Acme')]);

    expect(setAccount).not.toHaveBeenCalled();
    expect(navigateToSelectedOrg).not.toHaveBeenCalled();
  });

  // A restored selection on a legacy `/org/{page}` is the same uncopyable bar as a default's, so it is
  // written the same way — as a default, which is a no-op on an addressed page or the dead end.
  it('keeps a restored selection that is on the page and writes it into a legacy address as a default', () => {
    selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B, slug: 'beta' });

    bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

    expect(setAccount).not.toHaveBeenCalled();
    expect(refreshCanonicalRecord).not.toHaveBeenCalled();
    expect(navigateToSelectedOrg).toHaveBeenCalledTimes(1);
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
    // Same exposure as the default: the restored selection is about to become the address.
    expect(pinSelection).toHaveBeenCalledTimes(1);
    expect(pinSelection).toHaveBeenCalledWith('default');
    expect(pinSelection.mock.invocationCallOrder[0]).toBeLessThan(navigateToSelectedOrg.mock.invocationCallOrder[0]);
  });

  // A cookie-restored selection carries no slug, or a stale one from an earlier session; the indexed
  // row's is the one addresses resolve against. Applying it is a patch to the same selection, not a
  // new one — and the address is written only after the slug is in place.
  it.each([
    ['no slug yet', undefined],
    ['a stale slug', 'beta-old'],
  ])('applies the indexed slug to a restored selection with %s before writing the address', (_label, slug) => {
    selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B, slug });

    bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

    expect(setAccount).not.toHaveBeenCalled();
    expect(setIndexedSlug).toHaveBeenCalledTimes(1);
    expect(setIndexedSlug).toHaveBeenCalledWith('beta');
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
    expect(setIndexedSlug.mock.invocationCallOrder[0]).toBeLessThan(navigateToSelectedOrg.mock.invocationCallOrder[0]);
  });

  // The tri-state matters to the path guard, which takes its no-round-trip shortcut only for a
  // *known* slug: an indexed row without a slug confirms `null`, so the SFID address stops
  // round-tripping to the resolver on every navigation.
  it('confirms an indexed null for a restored selection whose row has no slug', () => {
    selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B });

    bootstrapWith([item(UID_A, 'Acme'), { ...item(UID_B, 'Beta'), slug: null }]);

    expect(setIndexedSlug).toHaveBeenCalledTimes(1);
    expect(setIndexedSlug).toHaveBeenCalledWith(null);
  });

  // Compared as normalized slugs, not raw strings: a case-only difference is the same address and
  // must not re-write the account (and the cookie) for nothing.
  it('does not re-write a restored selection whose slug differs from the row only in case', () => {
    selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B, slug: 'Beta' });

    bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

    expect(setAccount).not.toHaveBeenCalled();
    expect(setIndexedSlug).not.toHaveBeenCalled();
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
  });

  // M3: a restored CLA-only selection skips the path guard's resolver once its slug is known, so the
  // listed row is what the CLA-only shell reads when the role-grants lookup disagrees with org-items.
  describe('a restored CLA-only selection (#5557)', () => {
    const claOnlyB = (): OrgItem => item(UID_B, 'Beta', { slug: null, claOnly: true });
    const restoreB = (): void => selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B });

    it('records the row as CLA-only when the role-grants lookup failed to list it', () => {
      claManagerLookupFailed.set(true);
      restoreB();

      bootstrapWith([item(UID_A, 'Acme'), claOnlyB()]);

      expect(TestBed.inject(OrgClaOnlyAccessService).isClaOnly(UID_B)).toBe(true);
    });

    it('clears an earlier CLA-only note when the listed row is not CLA-only', () => {
      const access = TestBed.inject(OrgClaOnlyAccessService);
      access.noteAddressed(UID_B, true);
      restoreB();

      bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

      expect(access.isClaOnly(UID_B)).toBe(false);
    });

    it('lets a held grant win over the CLA-only row', () => {
      writerSet.set(new Set([UID_B]));
      restoreB();

      bootstrapWith([item(UID_A, 'Acme'), claOnlyB()]);

      expect(TestBed.inject(OrgClaOnlyAccessService).isClaOnly(UID_B)).toBe(false);
    });

    it('records a CLA-only row chosen as the default', () => {
      claManagerLookupFailed.set(true);

      bootstrapWith([claOnlyB()]);

      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B }));
      expect(TestBed.inject(OrgClaOnlyAccessService).isClaOnly(UID_B)).toBe(true);
    });
  });

  // A pre-spec-002 selection keyed by accountId rather than uid still finds its own row; that is a
  // default selection of the *same* organization, and takes the default path like any other.
  it('falls back to the row matching the restored accountId, still as a default', () => {
    selectedAccount.set({ ...placeholder, accountId: UID_B });

    bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

    expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B, slug: 'beta' }));
    expect(navigateToSelectedOrg).toHaveBeenCalledTimes(1);
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
  });

  // M3 (#5557): a grant holder's held page lands without waiting on the CLA Manager lookup; their
  // CLA-only rows follow from one `cla_only=1` request per reload and are listed after the held rows.
  describe('deferred CLA-only rows', () => {
    const UID_C = '0014100000MgcCCCCC';
    const isMainRequest = (req: { url: string; params: { has: (name: string) => boolean } }) => req.url === '/api/nav/org-items' && !req.params.has('cla_only');
    const isClaOnlyRequest = (req: { url: string; params: { get: (name: string) => string | null } }) =>
      req.url === '/api/nav/org-items' && req.params.get('cla_only') === '1';
    const hinted = (items: OrgItem[], upstreamFailed = false): OrgItemsResponse => ({
      items,
      next_page_token: null,
      upstream_failed: upstreamFailed,
      cla_only_deferred: true,
    });
    const claOnlyRow = (uid: string, name: string): OrgItem => item(uid, name, { slug: null, claOnly: true });
    const bootstrapHinted = (items: OrgItem[]): void => {
      service.resetAndReload();
      http.expectOne(isMainRequest).flush(hinted(items));
    };
    const flushClaOnly = (items: OrgItem[], upstreamFailed = false): void => {
      http.expectOne(isClaOnlyRequest).flush({ items, next_page_token: null, upstream_failed: upstreamFailed, total: items.length });
      TestBed.tick();
    };

    it('asks for the CLA-only rows once a hinted first page lands, and not otherwise', () => {
      bootstrapWith([item(UID_A, 'Acme')]);
      http.expectNone(isClaOnlyRequest);

      bootstrapHinted([item(UID_A, 'Acme')]);
      expect(service.claOnlyPending()).toBe(true);
      flushClaOnly([]);
      expect(service.claOnlyPending()).toBe(false);
    });

    it('serves every later search from the one request, filtered by the term the held page was fetched with', async () => {
      vi.useFakeTimers();
      try {
        bootstrapHinted([item(UID_A, 'Acme')]);
        flushClaOnly([claOnlyRow(UID_C, 'Gamma Labs'), claOnlyRow(UID_B, 'Beta Labs')]);
        expect(service.items().map((row) => row.uid)).toEqual([UID_A, UID_B, UID_C]);

        service.setSearchTerm('gam');
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(1000);
        // The CLA-only rows follow the term the displayed held page answered, not the live input.
        expect(service.items().map((row) => row.uid)).toEqual([UID_A, UID_B, UID_C]);
        http.expectOne(isMainRequest).flush(hinted([]));
        TestBed.tick();

        http.expectNone(isClaOnlyRequest);
        expect(service.items().map((row) => row.uid)).toEqual([UID_C]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the CLA-only rows filtered by a search whose request failed', async () => {
      vi.useFakeTimers();
      try {
        bootstrapHinted([item(UID_A, 'Acme')]);
        flushClaOnly([claOnlyRow(UID_C, 'Gamma Labs'), claOnlyRow(UID_B, 'Beta Labs')]);

        service.setSearchTerm(' gam ');
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(1000);
        http.expectOne(isMainRequest).flush('down', { status: 502, statusText: 'Bad Gateway' });
        TestBed.tick();

        expect(service.items().map((row) => row.uid)).toEqual([UID_C]);
        expect(service.upstreamFailed()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('lists a held organization once, as held, when the CLA-only answer also names it', () => {
      bootstrapHinted([item(UID_B, 'Beta'), item(UID_A, 'Acme')]);
      flushClaOnly([claOnlyRow(UID_A, 'Acme'), claOnlyRow(UID_C, 'Gamma')]);

      expect(service.items().map((row) => [row.uid, row.claOnly === true])).toEqual([
        [UID_B, false],
        [UID_A, false],
        [UID_C, true],
      ]);
    });

    it.each([
      ['the CLA-only request fails', () => http.expectOne(isClaOnlyRequest).flush('down', { status: 502, statusText: 'Bad Gateway' })],
      ['the CLA-only lookup reports a failure', () => flushClaOnly([], true)],
    ])('reports the list incomplete when %s, keeping the held rows', (_label, fail) => {
      bootstrapHinted([item(UID_A, 'Acme')]);
      expect(service.upstreamFailed()).toBe(false);

      fail();

      expect(service.upstreamFailed()).toBe(true);
      expect(service.items().map((row) => row.uid)).toEqual([UID_A]);
    });

    it('drops a CLA-only answer requested before a reload', () => {
      bootstrapHinted([item(UID_A, 'Acme')]);
      const stale = http.expectOne(isClaOnlyRequest);

      service.resetAndReload();
      stale.flush({ items: [claOnlyRow(UID_C, 'Gamma')], next_page_token: null, upstream_failed: true, total: 1 });

      expect(service.items().map((row) => row.uid)).not.toContain(UID_C);
      expect(service.upstreamFailed()).toBe(false);
      http.expectOne(isMainRequest).flush(hinted([item(UID_A, 'Acme')]));
      flushClaOnly([claOnlyRow(UID_B, 'Beta')]);
      expect(service.items().map((row) => row.uid)).toEqual([UID_A, UID_B]);
    });

    it('waits for the CLA-only rows before deciding a restored selection the held page lacks, then keeps it', () => {
      selectedAccount.set({ ...placeholder, uid: UID_C, accountId: UID_C });

      bootstrapHinted([item(UID_A, 'Acme')]);
      expect(setAccount).not.toHaveBeenCalled();
      expect(navigateToSelectedOrg).not.toHaveBeenCalled();

      flushClaOnly([claOnlyRow(UID_C, 'Gamma')]);

      expect(setAccount).not.toHaveBeenCalled();
      expect(setIndexedSlug).toHaveBeenCalledWith(null);
      expect(TestBed.inject(OrgClaOnlyAccessService).isClaOnly(UID_C)).toBe(true);
      expect(pinSelection).toHaveBeenCalledWith('default');
      expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
    });

    it('defaults as today when the CLA-only request fails for a restored selection the held page lacks', () => {
      selectedAccount.set({ ...placeholder, uid: UID_C, accountId: UID_C });

      bootstrapHinted([item(UID_A, 'Acme')]);
      http.expectOne(isClaOnlyRequest).flush('down', { status: 502, statusText: 'Bad Gateway' });
      TestBed.tick();

      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_A }));
    });

    it('picks the default from the held page without waiting', () => {
      bootstrapHinted([item(UID_A, 'Acme')]);

      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_A }));
      flushClaOnly([]);
    });

    it('waits for the CLA-only rows before treating an empty held page as no access', () => {
      const add = vi.spyOn(TestBed.inject(MessageService), 'add');

      bootstrapHinted([]);
      expect(add).not.toHaveBeenCalled();
      expect(clearAccount).not.toHaveBeenCalled();

      flushClaOnly([claOnlyRow(UID_C, 'Gamma')]);

      expect(add).not.toHaveBeenCalled();
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_C }));
    });

    describe("a grant holder's undecided selection (#5744)", () => {
      beforeEach(() => {
        writerSet.set(new Set([UID_A]));
        selectedAccount.set({ ...placeholder, uid: UID_C, accountId: UID_C });
      });

      it('is undecided before any page is requested, and while the first page is in flight', () => {
        expect(service.selectionUndecided()).toBe(true);

        service.resetAndReload();
        expect(service.selectionUndecided()).toBe(true);

        http.expectOne(isMainRequest).flush(hinted([item(UID_A, 'Acme')]));
        expect(service.selectionUndecided()).toBe(true);
        flushClaOnly([]);
      });

      it('stays undecided after the CLA-only rows land, until the selection is recorded from them', () => {
        bootstrapHinted([item(UID_A, 'Acme')]);
        http.expectOne(isClaOnlyRequest).flush({ items: [claOnlyRow(UID_C, 'Gamma')], next_page_token: null, upstream_failed: false, total: 1 });

        expect(service.claOnlyPending()).toBe(false);
        expect(service.selectionUndecided()).toBe(true);

        TestBed.tick();

        expect(TestBed.inject(OrgClaOnlyAccessService).isClaOnly(UID_C)).toBe(true);
        expect(service.selectionUndecided()).toBe(false);
      });

      it('is never undecided for staff or for a caller who holds no grant', () => {
        isStaff.set(true);
        expect(service.selectionUndecided()).toBe(false);

        isStaff.set(false);
        writerSet.set(new Set());
        expect(service.selectionUndecided()).toBe(false);
      });

      it('treats a CLA-only request that never answers as failed: it decides the selection and reports the list incomplete', async () => {
        vi.useFakeTimers();
        try {
          bootstrapHinted([item(UID_A, 'Acme')]);
          const hung = http.expectOne(isClaOnlyRequest);

          await vi.advanceTimersByTimeAsync(9_999);
          expect(service.claOnlyPending()).toBe(true);
          expect(service.selectionUndecided()).toBe(true);

          await vi.advanceTimersByTimeAsync(1);
          TestBed.tick();

          expect(hung.cancelled).toBe(true);
          expect(service.claOnlyPending()).toBe(false);
          expect(service.upstreamFailed()).toBe(true);
          expect(service.selectionUndecided()).toBe(false);
          expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_A }));
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  // Spec 053 Retry. The bootstrap's semantics on an empty or non-matching first page — clear the
  // selection, or default to the first row — are the wrong contract for "try the same thing again":
  // a Retry pressed mid-outage must leave the viewer's selection exactly where it was.
  describe('refreshList (Retry)', () => {
    const refreshWith = (items: OrgItem[], upstreamFailed = false): void => {
      service.refreshList(UID_B);
      http.expectOne((req) => req.url === '/api/nav/org-items').flush({ items, next_page_token: null, upstream_failed: upstreamFailed });
    };

    it('keeps the selection when the refreshed first page is empty, even on an upstream failure', () => {
      selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B, slug: 'beta' });

      refreshWith([], true);

      expect(clearAccount).not.toHaveBeenCalled();
      expect(setAccount).not.toHaveBeenCalled();
      expect(navigateToSelectedOrg).not.toHaveBeenCalled();
      expect(service.upstreamFailed()).toBe(true);
      expect(service.loaded()).toBe(true);
    });

    it('does not re-point the selection when the refreshed page lacks the current organization', () => {
      selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B, slug: 'beta' });

      refreshWith([item(UID_A, 'Acme')]);

      expect(setAccount).not.toHaveBeenCalled();
      expect(navigateToSelectedOrg).not.toHaveBeenCalled();
      expect(service.items().map((row) => row.uid)).toEqual([UID_A]);
    });

    // Retry's busy state also needs to know when its first page landed; scroll pages reuse the
    // generation and must not count.
    it('records a first page landing but not a next page', () => {
      const started = service.refreshList(UID_B);
      expect(service.firstPageLandedGeneration()).toBeLessThan(started);

      http.expectOne((req) => req.url === '/api/nav/org-items').flush({ items: [item(UID_B, 'Beta')], next_page_token: 'next', upstream_failed: false });
      expect(service.firstPageLandedGeneration()).toBe(started);

      service.loadNextPage();
      expect(service.generation()).toBe(started);
      http.expectOne((req) => req.url === '/api/nav/org-items').flush(page([item(UID_A, 'Acme')]));
      expect(service.firstPageLandedGeneration()).toBe(started);
    });

    // Retry is pressed during an outage, so its first page may fail again: the failed reset page must
    // still count as landed, or Retry would stay disabled until the next search.
    it('records a failed first page as landed so Retry is released', () => {
      const started = service.refreshList(UID_B);
      http.expectOne((req) => req.url === '/api/nav/org-items').flush('unavailable', { status: 503, statusText: 'Service Unavailable' });
      expect(service.firstPageLandedGeneration()).toBe(started);
    });

    // The empty-state Retry keys its busy state on this: the generation returned is the one the
    // started fetch carries, and a later reset moves past it.
    it('returns the generation of the fetch it started, which a later reset supersedes', () => {
      const started = service.refreshList(UID_B);
      expect(service.generation()).toBe(started);

      service.resetAndReload();
      expect(service.generation()).toBeGreaterThan(started);

      http
        .match((req) => req.url === '/api/nav/org-items')
        .forEach((req) => {
          if (!req.cancelled) req.flush(page([item(UID_B, 'Beta')]));
        });
    });

    it('pins the current selection into the refreshed request like the bootstrap does', () => {
      service.refreshList(UID_B);

      const req = http.expectOne((r) => r.url === '/api/nav/org-items');
      expect(req.request.params.get('selected_uid')).toBe(UID_B);
      req.flush(page([item(UID_B, 'Beta')]));
    });

    // A bootstrap already in flight keeps its own intent: the flag is neither armed nor cleared here.
    it('leaves an in-flight bootstrap\u2019s default-selection intent intact', () => {
      service.resetAndReload();
      service.refreshList(null);

      // The refresh supersedes the bootstrap's request (switchMap); its page lands under the bootstrap's intent.
      const requests = http.match((req) => req.url === '/api/nav/org-items');
      expect(requests).toHaveLength(2);
      expect(requests[0].cancelled).toBe(true);
      requests[1].flush(page([item(UID_A, 'Acme'), item(UID_B, 'Beta')]));

      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_A }));
    });

    // The documented qualification: with a bootstrap still armed, an empty refreshed page is consumed
    // under the bootstrap's own semantics (it would have cleared on its own empty page too). Retry adds
    // no selection semantics of its own — it neither arms nor disarms the pending intent.
    it('lets an armed bootstrap apply its own empty-page handling to the refreshed page', () => {
      selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B, slug: 'beta' });
      service.resetAndReload();
      service.refreshList(UID_B);

      const requests = http.match((req) => req.url === '/api/nav/org-items');
      requests[1].flush(page([]));

      expect(clearAccount).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * lfx-self-serve#4125 / PR #4415 review 7. A roll-up restored from the cookie pins as an address
   * selection even when the URL names no organization (`/org`, or a legacy `/org/{page}`), because
   * nothing may re-default it. The pin alone left the combined view living only in the cookie: the
   * address still read `/org/people`, so sharing or reloading that link dropped it.
   */
  describe('restored roll-up on an unaddressed URL', () => {
    const rows = (): OrgItem[] => [item('0014100000MgaAAAAA', 'Alpha'), item('0014100000MgbBBBBB', 'Bravo')];

    it('writes the default address while keeping the selection pinned', async () => {
      isAdoptedFromAddress.mockReturnValue(true);
      isRollUp.mockReturnValue(true);
      isOnAddressedPage.mockReturnValue(false);

      bootstrapWith(rows());
      await settle();

      expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
      // The pin is about the selection, not the address: nothing re-selects.
      expect(setAccount).not.toHaveBeenCalled();
    });

    it('leaves an address that already names the roll-up alone', async () => {
      isAdoptedFromAddress.mockReturnValue(true);
      isRollUp.mockReturnValue(true);
      isOnAddressedPage.mockReturnValue(true);

      bootstrapWith(rows());
      await settle();

      expect(navigateToSelectedOrg).not.toHaveBeenCalled();
    });

    /**
     * Copilot on PR #4415. This spec used to assert the opposite, and so locked in the defect: on
     * `/org/people` with a roll-up cookie, if the grants settle to one organization before org-items
     * answers, the demotion pins its concrete fallback as an address selection — but
     * `repointAddressAfterDemotion` only corrects a `/org/family-{rootUid}/…` address, and a legacy one names no
     * organization to correct. Gating the write on `isRollUp()` then skipped it, leaving the page
     * rendering one organization under an address that does not identify it.
     *
     * `isOnAddressedPage()` is the real condition, and it already excludes a resolver adoption.
     */
    it('writes the address for a concrete pin the URL does not name', async () => {
      isAdoptedFromAddress.mockReturnValue(true);
      isRollUp.mockReturnValue(false);
      isOnAddressedPage.mockReturnValue(false);

      bootstrapWith(rows());
      await settle();

      expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
      // Still only the address: the demotion's pin owns the selection.
      expect(setAccount).not.toHaveBeenCalled();
    });

    // Unchanged for a resolver adoption: the address already names the organization.
    it('does not write an address for a concrete organization the URL already names', async () => {
      isAdoptedFromAddress.mockReturnValue(true);
      isRollUp.mockReturnValue(false);
      isOnAddressedPage.mockReturnValue(true);

      bootstrapWith(rows());
      await settle();

      expect(navigateToSelectedOrg).not.toHaveBeenCalled();
    });
  });
});
