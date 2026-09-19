// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Account, OrgItem, OrgItemsResponse } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
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
  let isAddressedSelection: ReturnType<typeof vi.fn>;
  let setAccount: ReturnType<typeof vi.fn>;
  let navigateToSelectedOrg: ReturnType<typeof vi.fn>;
  let refreshCanonicalRecord: ReturnType<typeof vi.fn>;
  let http: HttpTestingController;
  let service: OrgNavigationService;

  beforeEach(() => {
    selectedAccount = signal<Account>(placeholder);
    isAddressedSelection = vi.fn(() => false);
    setAccount = vi.fn((account: Account) => selectedAccount.set(account));
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
          useValue: { selectedAccount, isAddressedSelection, setAccount, refreshCanonicalRecord },
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

  it('selects the first organization and re-addresses the page as a default, not a switch', () => {
    bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

    expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_A, slug: 'acme' }));
    expect(refreshCanonicalRecord).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_A }));
    expect(navigateToSelectedOrg).toHaveBeenCalledTimes(1);
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
  });

  // The organization the address named was access-verified by the resolver a moment ago; whether or
  // not it appears on the first page, it stays selected and the address is not touched.
  it('leaves an addressed selection alone', () => {
    isAddressedSelection.mockReturnValue(true);
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
  });

  // A cookie-restored selection carries no slug; the indexed row does. Filling it is a patch to the
  // same selection, not a new one — and the address is written only after the slug is in place.
  it('backfills the slug of a restored selection from its row before writing the address', () => {
    selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B });

    bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

    expect(setAccount).toHaveBeenCalledTimes(1);
    expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B, slug: 'beta' }));
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('default');
    expect(setAccount.mock.invocationCallOrder[0]).toBeLessThan(navigateToSelectedOrg.mock.invocationCallOrder[0]);
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
