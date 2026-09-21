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
  const item = (uid: string, name: string): OrgItem => ({ uid, accountId: uid, name, logoUrl: null, slug: name.toLowerCase() });
  const page = (items: OrgItem[]): OrgItemsResponse => ({ items, next_page_token: null, upstream_failed: false });
  const placeholder: Account = { accountId: '', accountName: '', accountSlug: '', membershipTier: '' };

  let selectedAccount: WritableSignal<Account>;
  let isAdoptedFromAddress: ReturnType<typeof vi.fn>;
  let setAccount: ReturnType<typeof vi.fn>;
  let setIndexedSlug: ReturnType<typeof vi.fn>;
  let pinSelection: ReturnType<typeof vi.fn>;
  let clearAccount: ReturnType<typeof vi.fn>;
  let navigateToSelectedOrg: ReturnType<typeof vi.fn>;
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
    navigateToSelectedOrg = vi.fn();
    refreshCanonicalRecord = vi.fn(() => Promise.resolve());
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        MessageService,
        { provide: LensService, useValue: {} },
        { provide: OrgRoleGrantsService, useValue: { isStaff: signal(false), degraded: signal(false) } },
        { provide: OrgLensNavigationService, useValue: { navigateToSelectedOrg } },
        {
          provide: AccountContextService,
          useValue: { selectedAccount, isAdoptedFromAddress, setAccount, setIndexedSlug, pinSelection, clearAccount, refreshCanonicalRecord },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(OrgNavigationService);
  });

  afterEach(() => http.verify());

  const bootstrapWith = (items: OrgItem[]): void => {
    service.resetAndReload();
    http.expectOne((req) => req.url === '/api/nav/org-items').flush(page(items));
  };

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

    it('keeps it, re-pinned, when it is still listed', () => {
      bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

      expect(setAccount).not.toHaveBeenCalled();
      expect(clearAccount).not.toHaveBeenCalled();
      expect(pinSelection).toHaveBeenCalledWith('default');
    });
  });

  // The organization the address named was access-verified by the resolver a moment ago; whether or
  // not it appears on the first page, it stays selected and the address is not touched.
  it('leaves an addressed selection alone', () => {
    isAdoptedFromAddress.mockReturnValue(true);
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

  // A pre-spec-002 selection keyed by accountId rather than uid still finds its own row; that is a
  // default selection of the *same* organization, and takes the default path like any other.
  it('falls back to the row matching the restored accountId, still as a default', () => {
    selectedAccount.set({ ...placeholder, accountId: UID_B });

    bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

    expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B, slug: 'beta' }));
    expect(navigateToSelectedOrg).toHaveBeenCalledTimes(1);
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
  });
});
