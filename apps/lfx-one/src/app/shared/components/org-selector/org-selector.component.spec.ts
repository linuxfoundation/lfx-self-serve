// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ROLLUP_ACCOUNT_NAME } from '@lfx-one/shared/constants';
import { Account, DisplayOrgItem, OrgItem, OrgRollUpFamily } from '@lfx-one/shared/interfaces';
import { isOrgRollUpSegment, orgRollUpAccount } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { LensService } from '@services/lens.service';
import { OrgClaOnlyAccessService } from '@services/org-cla-only-access.service';
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
  let familiesLoading: WritableSignal<boolean>;
  let retry: ReturnType<typeof vi.fn>;
  let resetAndReload: ReturnType<typeof vi.fn>;
  let refreshList: ReturnType<typeof vi.fn>;
  let previewingMenuLens: WritableSignal<boolean>;
  let noteAddressed: ReturnType<typeof vi.fn>;

  const pick = (item: OrgItem): void => (fixture.componentInstance as unknown as { selectItem(item: OrgItem): void }).selectItem(item);

  beforeEach(async () => {
    selectedAccount = signal<Account>(acme);
    setAccount = vi.fn((account: Account) => selectedAccount.set(account));
    refreshCanonicalRecord = vi.fn(() => Promise.resolve());
    navigateToSelectedOrg = vi.fn();
    isOnNotFound = vi.fn(() => false);
    retrying = signal(false);
    familiesLoading = signal(false);
    retry = vi.fn();
    resetAndReload = vi.fn();
    refreshList = vi.fn();
    previewingMenuLens = signal(false);
    noteAddressed = vi.fn();
    const empty = signal(new Set<string>());

    await TestBed.configureTestingModule({
      imports: [OrgSelectorComponent],
      providers: [
        provideNoopAnimations(),
        { provide: OrgClaOnlyAccessService, useValue: { noteAddressed, isClaOnly: () => false } },
        {
          provide: AccountContextService,
          useValue: {
            selectedAccount,
            setAccount,
            refreshCanonicalRecord,
            getStoredUid: () => null,
            // Mirrors the real accessor: the selection, else the cookie, and never the roll-up sentinel.
            orgListPinUid: () => {
              const uid = selectedAccount().uid;
              return uid && !isOrgRollUpSegment(uid) ? uid : null;
            },
            // Roll-up entry off by default: these suites cover the single-organization labelling
            // and the static-card rules, which #4132 must leave exactly as they were.
            canSelectRollUp: signal(false),
            rollUpFamiliesLoading: familiesLoading,
            rollUpFamiliesIncomplete: signal(false),
            eligibleRollUpFamilies: signal([]),
            selectedRollUpRootUid: signal(null),
            selectedRollUpFamily: signal(null),
            isRollUp: signal(false),
            rollUpOrganizationCount: signal(0),
            selectRollUp: vi.fn(() => false),
          },
        },
        {
          provide: OrgNavigationService,
          useValue: {
            items: signal<OrgItem[]>([rowA, rowB]),
            loading: signal(false),
            claOnlyPending: signal(false),
            hasMore: signal(false),
            upstreamFailed: signal(false),
            searchTerm: () => signal(''),
            setSearchTerm: vi.fn(),
            resetAndReload,
            refreshList,
            loadNextPage: vi.fn(),
          },
        },
        { provide: LensService, useValue: { previewingMenuLens } },
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

  it('shows "No logo" in the trigger instead of a building icon when the org has no logo', () => {
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="org-selector-trigger-logo-fallback"]')?.textContent?.trim()).toBe('No logo');
    expect(el.querySelector('.fa-building')).toBeNull();
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

  // M3: the path guard skips the resolver for the selection it already holds, so the pick carries the row's answer.
  it('records a CLA-only row as CLA-only before the switch navigates', () => {
    pick({ ...rowB, slug: null, claOnly: true });

    expect(noteAddressed).toHaveBeenCalledWith(UID_B, true);
    expect(noteAddressed.mock.invocationCallOrder[0]).toBeLessThan(navigateToSelectedOrg.mock.invocationCallOrder[0]);
  });

  it('clears any CLA-only note when the picked row is not CLA-only', () => {
    pick(rowB);

    expect(noteAddressed).toHaveBeenCalledWith(UID_B, false);
  });

  // The same-organization pick returns before switching, and the path guard will not resolve it either.
  it('records a re-pick of the selected CLA-only row without re-selecting it', () => {
    pick({ ...rowA, slug: null, claOnly: true });

    expect(noteAddressed).toHaveBeenCalledWith(UID_A, true);
    expect(setAccount).not.toHaveBeenCalled();
    expect(navigateToSelectedOrg).not.toHaveBeenCalled();
  });

  // FR-014 / US2 scenario 4: nothing reloads — not even the account signal page consumers refetch on. The pick is still
  // reported: one made while the mobile drawer previews Org Lens lands on that organization's overview (#4208).
  it('changes nothing for the organization already selected, but still reports the pick', () => {
    const selected = vi.fn();
    fixture.componentInstance.itemSelected.subscribe(selected);

    pick(rowA);

    expect(setAccount).not.toHaveBeenCalled();
    expect(refreshCanonicalRecord).not.toHaveBeenCalled();
    expect(navigateToSelectedOrg).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledWith(rowA);
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

  // Shown only because the mobile drawer previews Org Lens (#4208), the selector must not default-select, clear or
  // navigate: that is the bootstrap's job once Org Lens is really active, not a preview's.
  it('bootstraps its list without default-selection semantics while the drawer previews Org Lens', async () => {
    previewingMenuLens.set(true);
    fixture.componentRef.setInput('enabled', true);
    await fixture.whenStable();

    expect(refreshList).toHaveBeenCalledTimes(1);
    expect(resetAndReload).not.toHaveBeenCalled();
  });

  it('bootstraps its list with default selection when Org Lens is really active', async () => {
    fixture.componentRef.setInput('enabled', true);
    await fixture.whenStable();

    expect(resetAndReload).toHaveBeenCalledTimes(1);
    expect(refreshList).not.toHaveBeenCalled();
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

  // Retry's grants reload triggers a families refetch; a click during it would reload the grants
  // again and cancel that refetch, so the control stays busy until the families answer.
  it('stays busy while the families refetch Retry triggered is in flight', () => {
    const retryList = (): void => (fixture.componentInstance as unknown as { retryList(): void }).retryList();
    const label = (): string => (fixture.componentInstance as unknown as { listRetryLabel(): string }).listRetryLabel();

    familiesLoading.set(true);
    expect(label()).toBe('Retrying…');
    retryList();
    expect(retry).not.toHaveBeenCalled();

    familiesLoading.set(false);
    retryList();
    expect(retry).toHaveBeenCalledTimes(1);
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
    selectedRoleLabel(): string;
    selectedRoleTooltip(): string;
    displayedItems(): DisplayOrgItem[];
  }

  interface CardSetup {
    items?: OrgItem[];
    isStaff?: boolean;
    hasMore?: boolean;
    writers?: string[];
    inheritedWriters?: string[];
    claManagerOrgs?: string[];
    claOnlyPending?: boolean;
  }

  const createCard = async ({
    items = [rowA],
    isStaff = false,
    hasMore = false,
    writers = [],
    inheritedWriters = [],
    claManagerOrgs = [],
    claOnlyPending = false,
  }: CardSetup): Promise<NavbarCardView> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgSelectorComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: AccountContextService,
          useValue: {
            selectedAccount: signal(acme),
            setAccount: vi.fn(),
            refreshCanonicalRecord: vi.fn(),
            getStoredUid: () => null,
            // Mirrors the real accessor: the selection, else the cookie, and never the roll-up sentinel.
            orgListPinUid: () => acme.uid ?? null,
            // The roll-up entry is off here: these suites pin the single-organization labelling and
            // the static-card rules, which #4132 must leave exactly as they were.
            canSelectRollUp: signal(false),
            rollUpFamiliesLoading: signal(false),
            rollUpFamiliesIncomplete: signal(false),
            eligibleRollUpFamilies: signal([]),
            selectedRollUpRootUid: signal(null),
            selectedRollUpFamily: signal(null),
            isRollUp: signal(false),
            rollUpOrganizationCount: signal(0),
            selectRollUp: vi.fn(() => false),
          },
        },
        {
          provide: OrgNavigationService,
          useValue: {
            items: signal(items),
            loading: signal(false),
            claOnlyPending: signal(claOnlyPending),
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
            claManagerOrgSet: signal(new Set(claManagerOrgs)),
            claManagerLookupFailed: signal(false),
          },
        },
        { provide: OrgLensNavigationService, useValue: { navigateToSelectedOrg: vi.fn(), isOnNotFound: vi.fn(() => false) } },
        { provide: OrgLensEmptyStateService, useValue: { listIncomplete: signal(false), retrying: signal(false), retry: vi.fn() } },
        { provide: LensService, useValue: { previewingMenuLens: signal(false) } },
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

  it('keeps the panel while the deferred CLA-only rows are still on their way', async () => {
    expect((await createCard({ claOnlyPending: true })).isSingleOrg()).toBe(false);
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
  describe('a CLA-only organization (#5557)', () => {
    const claOnlyB: OrgItem = { ...rowB, slug: null, claOnly: true };
    const CLA_ONLY_TOOLTIP = 'You are a CLA Manager or initial CLA Manager designee for this organization. Only its EasyCLA page opens.';

    it('labels a CLA-only row listed after a held one, and keeps the panel openable', async () => {
      const card = await createCard({ items: [rowA, claOnlyB], writers: [UID_A] });

      expect(card.displayedItems().map((row) => [row.item.uid, row.roleLabel, row.roleTooltip])).toEqual([
        [UID_A, 'Org Admin Editor', ''],
        [UID_B, 'CLA Manager', CLA_ONLY_TOOLTIP],
      ]);
      expect(card.isSingleOrg()).toBe(false);
    });

    it('labels the card when the selection is a CLA-only organization', async () => {
      const card = await createCard({ items: [rowB, { ...rowA, claOnly: true }], claManagerOrgs: [UID_A] });

      expect(card.selectedRoleLabel()).toBe('CLA Manager');
      expect(card.selectedRoleTooltip()).toBe(CLA_ONLY_TOOLTIP);
      expect(card.navbarRoleTooltip()).toBe(CLA_ONLY_TOOLTIP);
    });

    // A search sends no selected_uid, so the selected row is absent from the filtered list.
    it('keeps the CLA-only label while a search excludes the selected organization', async () => {
      const card = await createCard({ items: [rowB], claManagerOrgs: [UID_A] });

      expect(card.selectedRoleLabel()).toBe('CLA Manager');
      expect(card.navbarRoleTooltip()).toBe(CLA_ONLY_TOOLTIP);
    });

    it('labels a selection recorded as CLA-only when the role-grants lookup did not list it', async () => {
      const card = await createCard({ items: [rowB] });
      TestBed.inject(OrgClaOnlyAccessService).noteAddressed(UID_A, true);

      expect(card.selectedRoleLabel()).toBe('CLA Manager');
    });

    it('leaves the card unlabelled when only another row is CLA-only', async () => {
      const card = await createCard({ items: [rowA, claOnlyB], claManagerOrgs: [UID_B] });

      expect(card.selectedRoleLabel()).not.toBe('CLA Manager');
      expect(card.selectedRoleTooltip()).not.toBe(CLA_ONLY_TOOLTIP);
      expect(card.navbarRoleTooltip()).not.toBe(CLA_ONLY_TOOLTIP);
    });

    it('lets a held grant win over a CLA-only flag on the same row', async () => {
      const card = await createCard({ items: [{ ...rowA, claOnly: true }], writers: [UID_A], claManagerOrgs: [UID_A] });

      expect(card.selectedRoleLabel()).toBe('Org Admin Editor');
      expect(card.displayedItems()[0].roleLabel).toBe('Org Admin Editor');
    });
  });
});

/**
 * lfx-self-serve#4132 — the pinned family roll-up entries, one per Salesforce family the caller
 * holds two or more organizations in. Each entry is a *view mode*, not a grant: it must appear only
 * for such a family, carry no persona badge, and leave the existing rows and their `(Original)` /
 * `(Inherited)` labelling alone.
 */
describe('OrgSelectorComponent family roll-ups', () => {
  const UID_A = '0014100000MgaAAAAA';
  const UID_B = '0014100000MgbBBBBB';
  const UID_C = '0014100000MgcCCCCC';
  const UID_D = '0014100000MgdDDDDD';
  const acme: Account = { accountId: UID_A, accountName: 'Acme', membershipTier: '', uid: UID_A, slug: 'acme-inc' };
  const rowA: OrgItem = { uid: UID_A, accountId: UID_A, name: 'Acme', logoUrl: null, slug: 'acme-inc' };
  const rowB: OrgItem = { uid: UID_B, accountId: UID_B, name: 'Beta', logoUrl: null, slug: 'beta-llc' };
  const acmeFamily: OrgRollUpFamily = { rootUid: UID_A, name: 'Acme', orgUids: [UID_A, UID_B, 'x', 'y'] };
  const charlieFamily: OrgRollUpFamily = { rootUid: UID_C, name: 'Charlie', orgUids: [UID_C, UID_D] };
  /** What `AccountContextService` holds while Acme's roll-up is the selection. */
  const acmeRollUp: Account = orgRollUpAccount(UID_A, 'Acme');

  interface RollUpView {
    activateOption(active: HTMLElement): boolean;
    displayName(): string;
    showRollUpRow(): boolean;
    rollUpRows(): { rootUid: string; name: string; subtitle: string; organizationCount: number; isSelected: boolean }[];
    isRollUpSelected(): boolean;
    isSingleOrg(): boolean;
    listIncomplete(): boolean;
    rollUpTriggerSubtitle(): string;
    selectRollUp(rootUid: string): void;
  }

  const selectRollUpSpy = vi.fn();
  const navigateSpy = vi.fn();
  const rollUpHomeSpy = vi.fn();
  const setAccountSpy = vi.fn();
  let onNotFound: ReturnType<typeof vi.fn>;

  const create = async (opts: {
    families: OrgRollUpFamily[];
    /** The family whose roll-up is selected, if any. */
    selectedRootUid?: string | null;
    /** The selected roll-up's organization count, as the service reports it. */
    count?: number;
    items?: OrgItem[];
    accepted?: boolean;
    onNotFound?: boolean;
    /** The current selection. Defaults to Acme; pass a roll-up account to make either row a real switch. */
    selected?: Account;
    /** The families answer landed as a lower bound or unknown. */
    familiesIncomplete?: boolean;
    /** The families answer for the current grants has not landed (or was incomplete). */
    familiesUnsettled?: boolean;
    /** The deferred CLA-only rows are still on their way. */
    claOnlyPending?: boolean;
  }): Promise<RollUpView> => {
    selectRollUpSpy.mockReset().mockReturnValue(opts.accepted ?? true);
    navigateSpy.mockReset();
    rollUpHomeSpy.mockReset();
    setAccountSpy.mockReset();
    onNotFound = vi.fn(() => opts.onNotFound ?? false);
    const selectedRootUid = opts.selectedRootUid ?? null;
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgSelectorComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: AccountContextService,
          useValue: {
            selectedAccount: signal(opts.selected ?? acme),
            setAccount: setAccountSpy,
            refreshCanonicalRecord: vi.fn(),
            getStoredUid: () => null,
            // Mirrors the real accessor: the selection, else the cookie, and never a roll-up segment.
            orgListPinUid: () => {
              const uid = (opts.selected ?? acme).uid;
              return uid && !isOrgRollUpSegment(uid) ? uid : null;
            },
            canSelectRollUp: signal(opts.families.length > 0),
            rollUpFamiliesLoading: signal(false),
            rollUpFamiliesIncomplete: signal(opts.familiesIncomplete ?? false),
            rollUpFamiliesUnsettled: signal(opts.familiesUnsettled ?? false),
            eligibleRollUpFamilies: signal(opts.families),
            selectedRollUpRootUid: signal(selectedRootUid),
            selectedRollUpFamily: signal(opts.families.find((family) => family.rootUid === selectedRootUid) ?? null),
            isRollUp: signal(selectedRootUid !== null),
            rollUpOrganizationCount: signal(opts.count ?? 0),
            selectRollUp: selectRollUpSpy,
          },
        },
        {
          provide: OrgNavigationService,
          useValue: {
            items: signal(opts.items ?? [rowA, rowB]),
            loading: signal(false),
            claOnlyPending: signal(opts.claOnlyPending ?? false),
            loaded: signal(true),
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
            writerSet: signal(new Set<string>()),
            auditorSet: signal(new Set<string>()),
            inheritedWriterSet: signal(new Set<string>()),
            inheritedAuditorSet: signal(new Set<string>()),
            parentNameByUid: signal(new Map<string, string>()),
          },
        },
        { provide: OrgLensNavigationService, useValue: { navigateToSelectedOrg: navigateSpy, navigateToRollUpHome: rollUpHomeSpy, isOnNotFound: onNotFound } },
        { provide: OrgLensEmptyStateService, useValue: { listIncomplete: signal(false), retrying: signal(false), retry: vi.fn() } },
        { provide: LensService, useValue: { previewingMenuLens: signal(false) } },
      ],
    })
      .overrideComponent(OrgSelectorComponent, { set: { template: '' } })
      .compileComponents();
    const fixture = TestBed.createComponent(OrgSelectorComponent);
    fixture.componentRef.setInput('enabled', false);
    await fixture.whenStable();
    return fixture.componentInstance as unknown as RollUpView;
  };

  it('offers one entry per eligible family and hides the block when there is none', async () => {
    const view = await create({ families: [acmeFamily, charlieFamily] });
    expect(view.showRollUpRow()).toBe(true);
    expect(view.rollUpRows().map((row) => row.rootUid)).toEqual([UID_A, UID_C]);
    expect((await create({ families: [], items: [rowA] })).showRollUpRow()).toBe(false);
  });

  it('names each entry after its family and describes its own set', async () => {
    const [acmeRow, charlieRow] = (await create({ families: [acmeFamily, charlieFamily] })).rollUpRows();
    expect(acmeRow).toEqual(
      expect.objectContaining({ name: 'All Acme Organizations', subtitle: 'Combined view of related organizations · 4 organizations', organizationCount: 4 })
    );
    expect(charlieRow).toEqual(expect.objectContaining({ name: 'All Charlie Organizations', organizationCount: 2 }));
  });

  /**
   * Cursor on PR #4415. The trigger shows a cookie-restored roll-up while the grants and families
   * load, but the row keyed on eligibility alone — and in the conglomerate case the count sits at 1
   * through that window, so the panel offered only organizations and picking one silently left
   * roll-up mode.
   */
  it('keeps the selected roll-up row while its family is not offered yet', async () => {
    const view = await create({ families: [charlieFamily], selectedRootUid: UID_A, selected: orgRollUpAccount(UID_A, null) });

    expect(view.showRollUpRow()).toBe(true);
    expect(view.rollUpRows()).toEqual([
      { rootUid: UID_A, name: ROLLUP_ACCOUNT_NAME, subtitle: 'Combined view of related organizations', organizationCount: 0, isSelected: true },
      expect.objectContaining({ rootUid: UID_C, isSelected: false }),
    ]);
  });

  // The service renames the selection once the family lands, so the trigger reads the selection
  // and agrees with every page heading.
  it('names the trigger from the selection', async () => {
    expect((await create({ families: [acmeFamily], selectedRootUid: UID_A, selected: acmeRollUp })).displayName()).toBe('All Acme Organizations');
    expect((await create({ families: [], selectedRootUid: UID_A, selected: orgRollUpAccount(UID_A, null) })).displayName()).toBe(ROLLUP_ACCOUNT_NAME);
  });

  // A failed families request hides every roll-up row; the notice says the list is incomplete and
  // its Retry re-runs the grants, which re-fetches the families.
  it('raises the incomplete-list notice when the families answer is incomplete', async () => {
    expect((await create({ families: [] })).listIncomplete()).toBe(false);
    expect((await create({ families: [], familiesIncomplete: true })).listIncomplete()).toBe(true);
  });

  it('marks only the selected family as selected', async () => {
    const rows = (await create({ families: [acmeFamily, charlieFamily], selectedRootUid: UID_C, count: 2 })).rollUpRows();
    expect(rows.map((row) => row.isSelected)).toEqual([false, true]);
  });

  /**
   * A conglomerate's siblings commonly arrive as inherited grants rather than org-items rows, so the
   * list can hold a single row while the caller holds several organizations. The static card would
   * then leave no way to open the panel the roll-up lives in.
   */
  it('keeps the trigger openable when a roll-up is offered but the list holds one row', async () => {
    const view = await create({ families: [acmeFamily], items: [rowA] });
    expect(view.isSingleOrg()).toBe(false);
  });

  /**
   * #4133 requires a new pick to land on the family's overview. Not an organization switch, which
   * keeps the current page: Org Profile is single-org by definition (#4125), so carrying the page
   * across could address a page with no roll-up rendering.
   */
  it('selects the picked family and lands on its overview rather than keeping the page', async () => {
    const view = await create({ families: [acmeFamily, charlieFamily] });
    view.selectRollUp(UID_C);
    expect(selectRollUpSpy).toHaveBeenCalledWith(UID_C);
    expect(rollUpHomeSpy).toHaveBeenCalledWith(UID_C);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // Mirrors `selectItem`'s FR-014 contract: re-picking what is already selected navigates nowhere.
  it('does not re-navigate when that family is already selected', async () => {
    const view = await create({ families: [acmeFamily], selectedRootUid: UID_A, count: 4, selected: acmeRollUp });
    view.selectRollUp(UID_A);
    expect(selectRollUpSpy).not.toHaveBeenCalled();
    expect(rollUpHomeSpy).not.toHaveBeenCalled();
  });

  // Switching between two families' roll-ups is a real switch, not a re-pick.
  it('switches from one family roll-up to another', async () => {
    const view = await create({ families: [acmeFamily, charlieFamily], selectedRootUid: UID_A, count: 4, selected: acmeRollUp });
    view.selectRollUp(UID_C);
    expect(selectRollUpSpy).toHaveBeenCalledWith(UID_C);
    expect(rollUpHomeSpy).toHaveBeenCalledWith(UID_C);
  });

  // The service re-derives eligibility; a refusal must leave the address alone rather than
  // navigating to a mode the caller does not qualify for.
  it('navigates nowhere when the service refuses the selection', async () => {
    const view = await create({ families: [charlieFamily], accepted: false });
    view.selectRollUp(UID_C);
    expect(selectRollUpSpy).toHaveBeenCalledTimes(1);
    expect(rollUpHomeSpy).not.toHaveBeenCalled();
  });

  // Regression, PR #4415 review: the same-selection shortcut skipped `selectItem`'s not-found
  // recovery, so a roll-up caller who reached the dead end could not click their way out of it.
  it('recovers from the not-found dead end when the selected roll-up is re-picked', async () => {
    const view = await create({ families: [acmeFamily], selectedRootUid: UID_A, count: 4, onNotFound: true });
    view.selectRollUp(UID_A);
    expect(rollUpHomeSpy).toHaveBeenCalledWith(UID_A);
  });

  // Regression, PR #4415 review: the count is rendered during the optimistic restore window, where
  // the grants have not landed and it can still read 1.
  it('agrees with the noun at one organization', async () => {
    const view = await create({ families: [], selectedRootUid: UID_A, count: 1 });
    expect(view.rollUpTriggerSubtitle()).toBe('1 organization');
  });

  /**
   * Regression, PR #4415 review (high severity). Keyboard activation resolved the focused option by
   * its DOM index into `displayedRows()`. The pinned roll-ups are real `[role=option]`s rendered
   * before that loop, so every index was off: Enter on a roll-up selected an organization, Enter on
   * an organization selected the next, and the last row did nothing.
   */
  describe('keyboard activation resolves the focused option by identity', () => {
    const optionEl = (dataset: Record<string, string>): HTMLElement => {
      const el = document.createElement('button');
      el.setAttribute('role', 'option');
      Object.entries(dataset).forEach(([key, value]) => (el.dataset[key] = value));
      return el;
    };

    it('activates the focused family roll-up, not another family', async () => {
      const view = await create({ families: [acmeFamily, charlieFamily] });
      expect(view.activateOption(optionEl({ optionKind: 'rollup', familyRoot: UID_C }))).toBe(true);
      expect(selectRollUpSpy).toHaveBeenCalledWith(UID_C);
    });

    it('activates nothing for a roll-up option naming no family', async () => {
      const view = await create({ families: [acmeFamily] });
      expect(view.activateOption(optionEl({ optionKind: 'rollup' }))).toBe(false);
      expect(selectRollUpSpy).not.toHaveBeenCalled();
    });

    // The bug's signature: with a roll-up present, this used to land on rowB.
    it('activates the focused organization, not the one after it', async () => {
      const view = await create({ families: [acmeFamily], selectedRootUid: UID_A, count: 4, selected: acmeRollUp });
      expect(view.activateOption(optionEl({ optionKind: 'org', orgUid: UID_A }))).toBe(true);
      expect(setAccountSpy).toHaveBeenCalledTimes(1);
      expect((setAccountSpy.mock.calls[0][0] as Account).uid).toBe(UID_A);
      expect(selectRollUpSpy).not.toHaveBeenCalled();
    });

    // The last row used to fall off the end of `displayedRows()` and activate nothing.
    it('activates the final organization', async () => {
      const view = await create({ families: [acmeFamily], selectedRootUid: UID_A, count: 4, selected: acmeRollUp });
      expect(view.activateOption(optionEl({ optionKind: 'org', orgUid: UID_B }))).toBe(true);
      expect((setAccountSpy.mock.calls[0][0] as Account).uid).toBe(UID_B);
    });

    it('activates nothing for an option naming no known organization', async () => {
      const view = await create({ families: [acmeFamily], selectedRootUid: UID_A, count: 4, selected: acmeRollUp });
      expect(view.activateOption(optionEl({ optionKind: 'org', orgUid: 'nope' }))).toBe(false);
      expect(setAccountSpy).not.toHaveBeenCalled();
    });
  });

  /**
   * Copilot on PR #5167. A restored roll-up's row comes from the families answer, which can land
   * after the organization list. Opening the panel in between focused the first organization and
   * ended the retry, so the selected roll-up row never received initial focus once it rendered.
   */
  describe('initial focus on a restored roll-up', () => {
    interface FocusView {
      pendingInitialFocus: boolean;
      listboxOptions: () => HTMLElement[];
      focusInitialOption(): void;
    }

    const orgOption = (): HTMLElement => {
      const el = document.createElement('button');
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', 'false');
      return el;
    };

    const runInitialFocus = async (view: RollUpView): Promise<boolean> => {
      const focus = view as unknown as FocusView;
      focus.listboxOptions = () => [orgOption(), orgOption()];
      focus.pendingInitialFocus = true;
      focus.focusInitialOption();
      await Promise.resolve();
      return focus.pendingInitialFocus;
    };

    it('keeps the retry armed while the selected roll-up row is still owed', async () => {
      const view = await create({ families: [], selectedRootUid: UID_A, selected: orgRollUpAccount(UID_A, null), familiesUnsettled: true });
      expect(await runInitialFocus(view)).toBe(true);
    });

    // Bugbot on PR #5167: a partial or failed answer leaves the families unsettled but renders no
    // roll-up row, so waiting on it let a later page of organizations pull focus back.
    it('ends the retry when the families answer landed incomplete', async () => {
      const view = await create({
        families: [],
        selectedRootUid: UID_A,
        selected: orgRollUpAccount(UID_A, null),
        familiesUnsettled: true,
        familiesIncomplete: true,
      });
      expect(await runInitialFocus(view)).toBe(false);
    });

    it('ends the retry once the families have settled', async () => {
      const view = await create({ families: [], selectedRootUid: UID_A, selected: orgRollUpAccount(UID_A, null) });
      expect(await runInitialFocus(view)).toBe(false);
    });

    it('ends the retry for an organization selection once the list has loaded', async () => {
      const view = await create({ families: [], familiesUnsettled: true });
      expect(await runInitialFocus(view)).toBe(false);
    });

    it('keeps the retry armed while the deferred CLA-only rows, which may hold the selection, are on their way', async () => {
      const view = await create({ families: [], claOnlyPending: true });
      expect(await runInitialFocus(view)).toBe(true);
    });
  });
});
