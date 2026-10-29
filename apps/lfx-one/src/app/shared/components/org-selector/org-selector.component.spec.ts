// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Account, OrgItem } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { LensService } from '@services/lens.service';
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
  let resetAndReload: ReturnType<typeof vi.fn>;
  let refreshList: ReturnType<typeof vi.fn>;
  let previewingMenuLens: WritableSignal<boolean>;

  const pick = (item: OrgItem): void => (fixture.componentInstance as unknown as { selectItem(item: OrgItem): void }).selectItem(item);

  beforeEach(async () => {
    selectedAccount = signal<Account>(acme);
    setAccount = vi.fn((account: Account) => selectedAccount.set(account));
    refreshCanonicalRecord = vi.fn(() => Promise.resolve());
    navigateToSelectedOrg = vi.fn();
    isOnNotFound = vi.fn(() => false);
    retrying = signal(false);
    retry = vi.fn();
    resetAndReload = vi.fn();
    refreshList = vi.fn();
    previewingMenuLens = signal(false);
    const empty = signal(new Set<string>());

    await TestBed.configureTestingModule({
      imports: [OrgSelectorComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: AccountContextService,
          useValue: {
            selectedAccount,
            setAccount,
            refreshCanonicalRecord,
            getStoredUid: () => null,
            // Roll-up entry off by default: these suites cover the single-organization labelling
            // and the static-card rules, which #4132 must leave exactly as they were.
            canSelectRollUp: signal(false),
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

  it('selects another organization and re-addresses the page as a switch', () => {
    const selected = vi.fn();
    fixture.componentInstance.itemSelected.subscribe(selected);

    pick(rowB);

    expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B, slug: 'beta-llc' }));
    expect(refreshCanonicalRecord).toHaveBeenCalledTimes(1);
    expect(navigateToSelectedOrg).toHaveBeenCalledWith('switch');
    expect(selected).toHaveBeenCalledWith(rowB);
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
          useValue: {
            selectedAccount: signal(acme),
            setAccount: vi.fn(),
            refreshCanonicalRecord: vi.fn(),
            getStoredUid: () => null,
            // The roll-up entry is off here: these suites pin the single-organization labelling and
            // the static-card rules, which #4132 must leave exactly as they were.
            canSelectRollUp: signal(false),
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

/**
 * lfx-self-serve#4132 — the pinned All Organizations roll-up entry. The entry is a *view mode*, not
 * a grant: it must appear only for a caller holding several organizations, carry no persona badge,
 * and leave the existing rows and their `(Original)` / `(Inherited)` labelling alone.
 */
describe('OrgSelectorComponent All Organizations roll-up', () => {
  const UID_A = '0014100000MgaAAAAA';
  const UID_B = '0014100000MgbBBBBB';
  const acme: Account = { accountId: UID_A, accountName: 'Acme', membershipTier: '', uid: UID_A, slug: 'acme-inc' };
  const rowA: OrgItem = { uid: UID_A, accountId: UID_A, name: 'Acme', logoUrl: null, slug: 'acme-inc' };
  const rowB: OrgItem = { uid: UID_B, accountId: UID_B, name: 'Beta', logoUrl: null, slug: 'beta-llc' };
  /** What `AccountContextService` holds while the roll-up is the selection. */
  const rollUpAccount: Account = { accountId: 'all', accountName: 'All Organizations', membershipTier: '', uid: 'all', slug: null };

  interface RollUpView {
    activateOption(active: HTMLElement): boolean;
    showRollUpRow(): boolean;
    isRollUpSelected(): boolean;
    isSingleOrg(): boolean;
    rollUpSubtitle(): string;
    rollUpTriggerSubtitle(): string;
    selectRollUp(): void;
  }

  const selectRollUpSpy = vi.fn();
  const navigateSpy = vi.fn();
  const rollUpHomeSpy = vi.fn();
  const setAccountSpy = vi.fn();
  let onNotFound: ReturnType<typeof vi.fn>;

  const create = async (opts: {
    canSelectRollUp: boolean;
    isRollUp?: boolean;
    count?: number;
    items?: OrgItem[];
    accepted?: boolean;
    onNotFound?: boolean;
    /** The current selection. Defaults to Acme; pass the roll-up account to make either row a real switch. */
    selected?: Account;
  }): Promise<RollUpView> => {
    selectRollUpSpy.mockReset().mockReturnValue(opts.accepted ?? true);
    navigateSpy.mockReset();
    rollUpHomeSpy.mockReset();
    setAccountSpy.mockReset();
    onNotFound = vi.fn(() => opts.onNotFound ?? false);
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
            canSelectRollUp: signal(opts.canSelectRollUp),
            isRollUp: signal(opts.isRollUp ?? false),
            rollUpOrganizationCount: signal(opts.count ?? 0),
            selectRollUp: selectRollUpSpy,
          },
        },
        {
          provide: OrgNavigationService,
          useValue: {
            items: signal(opts.items ?? [rowA, rowB]),
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

  it('offers the entry to a caller with several organizations and hides it from a single-org caller', async () => {
    expect((await create({ canSelectRollUp: true, count: 4 })).showRollUpRow()).toBe(true);
    expect((await create({ canSelectRollUp: false, items: [rowA] })).showRollUpRow()).toBe(false);
  });

  it('describes the set rather than a persona', async () => {
    const view = await create({ canSelectRollUp: true, count: 4 });
    expect(view.rollUpSubtitle()).toBe('Combined view · 4 organizations');
    expect(view.rollUpTriggerSubtitle()).toBe('4 organizations');
  });

  /**
   * A conglomerate's siblings commonly arrive as inherited grants rather than org-items rows, so the
   * list can hold a single row while the caller holds several organizations. The static card would
   * then leave no way to open the panel the roll-up lives in.
   */
  it('keeps the trigger openable when the roll-up is offered but the list holds one row', async () => {
    const view = await create({ canSelectRollUp: true, count: 3, items: [rowA] });
    expect(view.isSingleOrg()).toBe(false);
  });

  /**
   * #4133 requires a new pick to land on `/org/all/overview`. Not an organization switch, which
   * keeps the current page: Org Profile is single-org by definition (#4125), so carrying the page
   * across could address a page with no roll-up rendering.
   */
  it('selects the roll-up and lands on its overview rather than keeping the page', async () => {
    const view = await create({ canSelectRollUp: true, count: 4 });
    view.selectRollUp();
    expect(selectRollUpSpy).toHaveBeenCalledTimes(1);
    expect(rollUpHomeSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // Mirrors `selectItem`'s FR-014 contract: re-picking what is already selected navigates nowhere.
  it('does not re-navigate when the roll-up is already selected', async () => {
    const view = await create({ canSelectRollUp: true, isRollUp: true, count: 4 });
    view.selectRollUp();
    expect(selectRollUpSpy).not.toHaveBeenCalled();
    expect(rollUpHomeSpy).not.toHaveBeenCalled();
  });

  // The service re-derives eligibility; a refusal must leave the address alone rather than
  // navigating to a mode the caller does not qualify for.
  it('navigates nowhere when the service refuses the selection', async () => {
    const view = await create({ canSelectRollUp: true, count: 2, accepted: false });
    view.selectRollUp();
    expect(selectRollUpSpy).toHaveBeenCalledTimes(1);
    expect(rollUpHomeSpy).not.toHaveBeenCalled();
  });

  // Regression, PR #4415 review: the same-selection shortcut skipped `selectItem`'s not-found
  // recovery, so a roll-up caller who reached the dead end could not click their way out of it.
  it('recovers from the not-found dead end when the selected roll-up is re-picked', async () => {
    const view = await create({ canSelectRollUp: true, isRollUp: true, count: 4, onNotFound: true });
    view.selectRollUp();
    expect(rollUpHomeSpy).toHaveBeenCalledTimes(1);
  });

  // Regression, PR #4415 review: the count is rendered during the optimistic restore window, where
  // the grants have not landed and it can still read 1.
  it('agrees with the noun at one organization', async () => {
    const view = await create({ canSelectRollUp: true, isRollUp: true, count: 1 });
    expect(view.rollUpTriggerSubtitle()).toBe('1 organization');
    expect(view.rollUpSubtitle()).toBe('Combined view · 1 organization');
  });

  /**
   * Regression, PR #4415 review (high severity). Keyboard activation resolved the focused option by
   * its DOM index into `displayedRows()`. The pinned roll-up is a real `[role=option]` rendered
   * before that loop, so every index was off by one: Enter on the roll-up selected the first
   * organization, Enter on an organization selected the next, and the last row did nothing.
   */
  describe('keyboard activation resolves the focused option by identity', () => {
    const optionEl = (dataset: Record<string, string>): HTMLElement => {
      const el = document.createElement('button');
      el.setAttribute('role', 'option');
      Object.entries(dataset).forEach(([key, value]) => (el.dataset[key] = value));
      return el;
    };

    it('activates the roll-up when the roll-up option is focused', async () => {
      const view = await create({ canSelectRollUp: true, count: 4 });
      expect(view.activateOption(optionEl({ optionKind: 'rollup' }))).toBe(true);
      expect(selectRollUpSpy).toHaveBeenCalledTimes(1);
    });

    // The bug's signature: with the roll-up present, this used to land on rowB.
    it('activates the focused organization, not the one after it', async () => {
      const view = await create({ canSelectRollUp: true, isRollUp: true, count: 4, selected: rollUpAccount });
      expect(view.activateOption(optionEl({ optionKind: 'org', orgUid: UID_A }))).toBe(true);
      expect(setAccountSpy).toHaveBeenCalledTimes(1);
      expect((setAccountSpy.mock.calls[0][0] as Account).uid).toBe(UID_A);
      expect(selectRollUpSpy).not.toHaveBeenCalled();
    });

    // The last row used to fall off the end of `displayedRows()` and activate nothing.
    it('activates the final organization', async () => {
      const view = await create({ canSelectRollUp: true, isRollUp: true, count: 4, selected: rollUpAccount });
      expect(view.activateOption(optionEl({ optionKind: 'org', orgUid: UID_B }))).toBe(true);
      expect((setAccountSpy.mock.calls[0][0] as Account).uid).toBe(UID_B);
    });

    it('activates nothing for an option naming no known organization', async () => {
      const view = await create({ canSelectRollUp: true, isRollUp: true, count: 4, selected: rollUpAccount });
      expect(view.activateOption(optionEl({ optionKind: 'org', orgUid: 'nope' }))).toBe(false);
      expect(setAccountSpy).not.toHaveBeenCalled();
    });
  });
});
