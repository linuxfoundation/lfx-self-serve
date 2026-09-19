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
  let http: HttpTestingController;
  let service: OrgNavigationService;

  beforeEach(() => {
    selectedAccount = signal<Account>(placeholder);
    isAddressedSelection = vi.fn(() => false);
    setAccount = vi.fn((account: Account) => selectedAccount.set(account));
    navigateToSelectedOrg = vi.fn();
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
          useValue: { selectedAccount, isAddressedSelection, setAccount, refreshCanonicalRecord: vi.fn(() => Promise.resolve()) },
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

  it('keeps a restored selection that is on the page and does not re-address for it', () => {
    selectedAccount.set({ ...placeholder, uid: UID_B, accountId: UID_B, slug: 'beta' });

    bootstrapWith([item(UID_A, 'Acme'), item(UID_B, 'Beta')]);

    expect(setAccount).not.toHaveBeenCalled();
    expect(navigateToSelectedOrg).not.toHaveBeenCalled();
  });
});
