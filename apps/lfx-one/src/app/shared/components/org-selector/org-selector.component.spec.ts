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
    const selected = vi.fn();
    fixture.componentInstance.itemSelected.subscribe(selected);

    pick(rowB);

    expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B, slug: 'beta-llc' }));
    expect(refreshCanonicalRecord).toHaveBeenCalledTimes(1);
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('switch');
    expect(selected).toHaveBeenCalledWith(rowB);
  });

  // FR-014 / US2 scenario 4: nothing reloads — not even the account signal page consumers refetch on.
  it('does nothing for the organization already selected', () => {
    const selected = vi.fn();
    fixture.componentInstance.itemSelected.subscribe(selected);

    pick(rowA);

    expect(setAccount).not.toHaveBeenCalled();
    expect(refreshCanonicalRecord).not.toHaveBeenCalled();
    expect(navigateToSelectedOrg).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
  });

  // On the dead end the selection is the cookie's or a bootstrap default that never made it into the
  // address, so the row shown as selected — for a single-organization viewer, the only row — is the
  // way out. Still no re-selection: the address moves, the account does not.
  it('leaves the not-found dead end for the already selected organization, without re-selecting it', () => {
    isOnNotFound.mockReturnValue(true);
    const selected = vi.fn();
    fixture.componentInstance.itemSelected.subscribe(selected);

    pick(rowA);

    expect(setAccount).not.toHaveBeenCalled();
    expect(refreshCanonicalRecord).not.toHaveBeenCalled();
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('switch');
    expect(selected).toHaveBeenCalledWith(rowA);
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

/** The navbar variant's single-organization static card and its plain-language role description. */
describe('OrgSelectorComponent navbar card', () => {
  const UID_A = '0014100000MgaAAAAA';
  const UID_B = '0014100000MgbBBBBB';
  const UID_PARENT = '0014100000MgpPPPPP';
  const acme: Account = { accountId: UID_A, accountName: 'Acme', membershipTier: '', uid: UID_A, slug: 'acme-inc' };
  const rowA: OrgItem = { uid: UID_A, accountId: UID_A, name: 'Acme', logoUrl: null, slug: 'acme-inc' };
  const rowB: OrgItem = { uid: UID_B, accountId: UID_B, name: 'Beta', logoUrl: null, slug: 'beta-llc' };

  interface NavbarCardView {
    isSingleOrg(): boolean;
    navbarRoleTooltip(): string;
  }

  interface CardSetup {
    items?: OrgItem[];
    isStaff?: boolean;
    hasMore?: boolean;
    writers?: string[];
    inheritedWriters?: string[];
  }

  const createCard = async ({ items = [rowA], isStaff = false, hasMore = false, writers = [], inheritedWriters = [] }: CardSetup): Promise<NavbarCardView> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgSelectorComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: AccountContextService,
          useValue: { selectedAccount: signal(acme), setAccount: vi.fn(), refreshCanonicalRecord: vi.fn(), getStoredUid: () => null },
        },
        {
          provide: OrgNavigationService,
          useValue: {
            items: signal(items),
            loading: signal(false),
            hasMore: signal(hasMore),
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
            isStaff: signal(isStaff),
            writerSet: signal(new Set(writers)),
            auditorSet: signal(new Set<string>()),
            inheritedWriterSet: signal(new Set(inheritedWriters)),
            inheritedAuditorSet: signal(new Set<string>()),
            parentNameByUid: signal(new Map([[UID_A, 'Parent Holdings']])),
          },
        },
        { provide: OrgLensNavigationService, useValue: { navigateToSelectedOrg: vi.fn(), isOnNotFound: vi.fn(() => false) } },
        { provide: OrgLensEmptyStateService, useValue: { listIncomplete: signal(false), retrying: signal(false), retry: vi.fn() } },
      ],
    })
      // Signal logic only — the template's viewport-deferred list needs an IntersectionObserver jsdom lacks.
      .overrideComponent(OrgSelectorComponent, { set: { template: '' } })
      .compileComponents();
    const fixture = TestBed.createComponent(OrgSelectorComponent);
    fixture.componentRef.setInput('enabled', false);
    await fixture.whenStable();
    return fixture.componentInstance as unknown as NavbarCardView;
  };

  it('is a static card only for a non-staff viewer whose complete list holds just the selected organization', async () => {
    expect((await createCard({})).isSingleOrg()).toBe(true);
    expect((await createCard({ items: [rowA, rowB] })).isSingleOrg()).toBe(false);
    expect((await createCard({ hasMore: true })).isSingleOrg()).toBe(false);
    expect((await createCard({ isStaff: true })).isSingleOrg()).toBe(false);
  });

  it('keeps the panel when the one listed organization is not the selected one', async () => {
    expect((await createCard({ items: [rowB] })).isSingleOrg()).toBe(false);
  });

  it('describes an inherited role through the organization it comes from', async () => {
    const card = await createCard({ inheritedWriters: [UID_A] });

    expect(card.navbarRoleTooltip()).toContain('Parent Holdings');
  });

  it('marks a direct role as direct only when the viewer also holds inherited access', async () => {
    expect((await createCard({ writers: [UID_A] })).navbarRoleTooltip()).not.toContain('Granted directly');
    expect((await createCard({ writers: [UID_A], inheritedWriters: [UID_PARENT] })).navbarRoleTooltip()).toContain('Granted directly');
  });
});
