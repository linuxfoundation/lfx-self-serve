// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Account, OrgItem } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgSelectorComponent } from './org-selector.component';

/**
 * What a pick in the selector does to the selection and to the address (spec 050 US2 — FR-013,
 * FR-014, FR-022). The three cases are the three branches of `selectItem`: another organization,
 * the same organization on an ordinary page, and the same organization on the not-found dead end.
 */
describe('OrgSelectorComponent.selectItem', () => {
  const UID_A = '0014100000MgaAAAAA';
  const UID_B = '0014100000MgbBBBBB';
  const acme: Account = { accountId: UID_A, accountName: 'Acme', membershipTier: '', uid: UID_A, slug: 'acme-inc' };
  const rowA: OrgItem = { uid: UID_A, accountId: UID_A, name: 'Acme', logoUrl: null, slug: 'acme-inc' };
  const rowB: OrgItem = { uid: UID_B, accountId: UID_B, name: 'Beta', logoUrl: null, slug: 'beta-llc' };

  let selectedAccount: WritableSignal<Account>;
  let setAccount: ReturnType<typeof vi.fn>;
  let refreshCanonicalRecord: ReturnType<typeof vi.fn>;
  let navigateToSelectedOrg: ReturnType<typeof vi.fn>;
  let isOnNotFound: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<OrgSelectorComponent>;
  let retrying: WritableSignal<boolean>;
  let retry: ReturnType<typeof vi.fn>;

  const pick = (item: OrgItem): void => (fixture.componentInstance as unknown as { selectItem(item: OrgItem): void }).selectItem(item);

  beforeEach(async () => {
    selectedAccount = signal<Account>(acme);
    setAccount = vi.fn((account: Account) => selectedAccount.set(account));
    refreshCanonicalRecord = vi.fn(() => Promise.resolve());
    navigateToSelectedOrg = vi.fn();
    isOnNotFound = vi.fn(() => false);
    retrying = signal(false);
    retry = vi.fn();
    const empty = signal(new Set<string>());

    await TestBed.configureTestingModule({
      imports: [OrgSelectorComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AccountContextService, useValue: { selectedAccount, setAccount, refreshCanonicalRecord, getStoredUid: () => null } },
        {
          provide: OrgNavigationService,
          useValue: {
            items: signal<OrgItem[]>([rowA, rowB]),
            loading: signal(false),
            hasMore: signal(false),
            upstreamFailed: signal(false),
            searchTerm: () => signal(''),
            setSearchTerm: vi.fn(),
            resetAndReload: vi.fn(),
            loadNextPage: vi.fn(),
          },
        },
        {
          provide: OrgRoleGrantsService,
          useValue: {
            isStaff: signal(false),
            writerSet: empty,
            auditorSet: empty,
            inheritedWriterSet: empty,
            inheritedAuditorSet: empty,
            parentNameByUid: signal(new Map<string, string>()),
          },
        },
        { provide: OrgLensNavigationService, useValue: { navigateToSelectedOrg, isOnNotFound } },
        // Spec 053: the FR-010 list-incomplete notice reads this service; a stub keeps the spec off HttpClient.
        { provide: OrgLensEmptyStateService, useValue: { listIncomplete: signal(false), retrying, retry } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgSelectorComponent);
    fixture.componentRef.setInput('enabled', false);
    await fixture.whenStable();
  });

  it('selects another organization and re-addresses the page as a switch', () => {
    pick(rowB);

    expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B, slug: 'beta-llc' }));
    expect(refreshCanonicalRecord).toHaveBeenCalledTimes(1);
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('switch');
  });

  // FR-014 / US2 scenario 4: nothing reloads — not even the account signal page consumers refetch on.
  it('does nothing for the organization already selected', () => {
    pick(rowA);

    expect(setAccount).not.toHaveBeenCalled();
    expect(refreshCanonicalRecord).not.toHaveBeenCalled();
    expect(navigateToSelectedOrg).not.toHaveBeenCalled();
  });

  // On the dead end the selection is the cookie's or a bootstrap default that never made it into the
  // address, so the row shown as selected — for a single-organization viewer, the only row — is the
  // way out. Still no re-selection: the address moves, the account does not.
  it('leaves the not-found dead end for the already selected organization, without re-selecting it', () => {
    isOnNotFound.mockReturnValue(true);

    pick(rowA);

    expect(setAccount).not.toHaveBeenCalled();
    expect(refreshCanonicalRecord).not.toHaveBeenCalled();
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('switch');
  });

  // FR-010 switcher Retry: the control stays focusable while busy (aria-disabled), so the guard in
  // retryList is what prevents a second click from starting another cache-bypassing retry.
  it('starts the shared Retry when idle and ignores clicks while it is in flight', () => {
    const retryList = (): void => (fixture.componentInstance as unknown as { retryList(): void }).retryList();
    const label = (): string => (fixture.componentInstance as unknown as { listRetryLabel(): string }).listRetryLabel();

    expect(label()).toBe('Retry');
    retryList();
    expect(retry).toHaveBeenCalledTimes(1);

    retrying.set(true);
    expect(label()).toBe('Retrying…');
    retryList();
    retryList();
    expect(retry).toHaveBeenCalledTimes(1);

    retrying.set(false);
    retryList();
    expect(retry).toHaveBeenCalledTimes(2);
  });
});
