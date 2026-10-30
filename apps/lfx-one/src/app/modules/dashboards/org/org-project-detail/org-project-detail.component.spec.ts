// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, type ParamMap, Router, UrlTree } from '@angular/router';
import { ORG_SCOPE_PROJECT_DETAIL_NOTE, PD_HEALTH_TAG } from '@lfx-one/shared/constants';
import { Account, BoardDisplayRow, OrgLensEmptyStateName, OrgLensInfluenceBlock, OrgLensProjectHero } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { IntercomService } from '@services/intercom.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensOrgScopeService } from '@services/org-lens-org-scope.service';
import { OrgLensProjectDetailService } from '@services/org-lens-project-detail.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, EMPTY, of } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { OrgProjectDetailComponent } from './org-project-detail.component';

// The page-level classifier's surface, with the state under test's control.
function emptyStateStub(pageState: WritableSignal<OrgLensEmptyStateName | null>) {
  return {
    pageState,
    hasPageState: computed(() => pageState() !== null),
    pageReady: signal(true),
    settled: signal(true),
    retrying: signal(false),
    retry: vi.fn(),
  };
}

/**
 * Covers which leaderboard rows may open the score-breakdown drawer. The breakdown is keyed by
 * organization id, and a display name cannot stand in for it — names are not unique within a
 * project, so opening by name can show another company's figures. A row that arrived without an
 * organization id must therefore be inert rather than opening the drawer on an unresolved subject.
 */
describe('OrgProjectDetailComponent — leaderboard detail drawer opening', () => {
  let fixture: ComponentFixture<OrgProjectDetailComponent>;
  let component: OrgProjectDetailComponent;

  const ACCOUNT: Account = { accountId: 'acc-1', accountName: 'Test Org', uid: 'acc-1' } as Account;
  // What AccountContextService.clearAccount() leaves behind: an account with no identifier at all.
  const CLEARED_ACCOUNT: Account = { accountId: '', accountName: '', membershipTier: '' } as Account;

  // Replayed rather than a plain Subject: the component subscribes during construction and must see
  // the first slug, and a later emission stands in for navigating to another project.
  let paramMap: BehaviorSubject<ParamMap>;
  let selectedAccount: WritableSignal<Account>;

  const makeRow = (overrides: Partial<BoardDisplayRow> = {}): BoardDisplayRow => ({
    rank: 1,
    orgName: 'Acme',
    orgLogoUrl: '',
    initials: 'AC',
    activityLabel: '',
    bandLabel: '',
    bandSeverity: 'secondary',
    isViewingOrg: false,
    organizationId: 'crowd-org-1',
    ...overrides,
  });

  beforeEach(async () => {
    paramMap = new BehaviorSubject<ParamMap>(convertToParamMap({ projectSlug: 'k8s' }));
    selectedAccount = signal(ACCOUNT);

    await TestBed.configureTestingModule({
      imports: [OrgProjectDetailComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AccountContextService, useValue: { selectedAccount, selectedUrlSegment: signal('acme') } },
        { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
        { provide: OrgLensEmptyStateService, useValue: emptyStateStub(signal(null)) },
        // The page itself reads no flag; child components in its template do.
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: OrgLensOrgScopeService, useValue: { current: signal(null), retryFailedRead: () => undefined } },
        {
          provide: OrgLensProjectDetailService,
          useValue: {
            getHero: vi.fn(() => of(null)),
            getInfluenceBlock: vi.fn(() => of(null)),
            getTrendBlock: vi.fn(() => of(null)),
            getTechnicalBoard: vi.fn(() => of({ rows: [], total: 0 })),
            getEcosystemBoard: vi.fn(() => of({ rows: [], total: 0 })),
            // The drawer this suite opens injects the same service and fetches on becoming visible.
            getLeaderboardBreakdown: vi.fn(() => of(null)),
          },
        },
        {
          provide: PersonDetailDrawerService,
          useValue: {
            open: vi.fn(),
            close: vi.fn(),
            isOpen: signal(false),
            activeContext: signal(null),
            activeTab: signal('events'),
            loading: signal(false),
            error: signal(null),
            emailError: signal(false),
            emailsLoading: signal(false),
            companyEmails: signal([]),
          },
        },
        // lfx-button renders routerLink CTAs as real anchors — RouterLink on an anchor eagerly
        // computes href via createUrlTree/serializeUrl and subscribes to router.events.
        { provide: Router, useValue: { navigate: vi.fn(), events: EMPTY, createUrlTree: vi.fn(() => ({}) as UrlTree), serializeUrl: vi.fn(() => '') } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap.asObservable(),
            queryParamMap: of(convertToParamMap({})),
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgProjectDetailComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('opens the drawer for a row carrying an organization id', async () => {
    component['openLeaderboardDetail']('technical', makeRow());
    await fixture.whenStable();

    expect(component['leaderboardDetailOpen']()).toBe(true);
    expect(component['leaderboardDetailOrganizationId']()).toBe('crowd-org-1');
  });

  it('stays closed for a row with no organization id', async () => {
    component['openLeaderboardDetail']('technical', makeRow({ organizationId: '' }));
    await fixture.whenStable();

    expect(component['leaderboardDetailOpen']()).toBe(false);
  });

  // Only the subject is pinned when the drawer opens; slug, org and range are live inputs. Left open
  // across a project navigation it would refetch the previous board's company against the project
  // the user has moved to, which they never clicked a row on.
  it('closes the drawer when the project changes underneath it', async () => {
    component['openLeaderboardDetail']('technical', makeRow());
    await fixture.whenStable();
    expect(component['leaderboardDetailOpen']()).toBe(true);

    paramMap.next(convertToParamMap({ projectSlug: 'envoy' }));
    await fixture.whenStable();

    expect(component['leaderboardDetailOpen']()).toBe(false);
  });

  // Losing the organization does not unmount this page — an empty org list keeps the user under /org
  // to meet the empty state — so an open drawer would sit over that empty state waiting forever on an
  // organization the page no longer has.
  it('closes the drawer when the organization is cleared underneath it', async () => {
    component['openLeaderboardDetail']('technical', makeRow());
    await fixture.whenStable();
    expect(component['leaderboardDetailOpen']()).toBe(true);

    selectedAccount.set(CLEARED_ACCOUNT);
    await fixture.whenStable();

    expect(component['leaderboardDetailOpen']()).toBe(false);
  });
});

/**
 * #2961 — the shared page-level state replaces the whole page: a contractor refused the selected
 * organization must see only that state, never the page's own not-found / error states or any block.
 */
describe('OrgProjectDetailComponent — page-level empty state', () => {
  async function render(state: OrgLensEmptyStateName | null): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [OrgProjectDetailComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: AccountContextService,
          useValue: { selectedAccount: signal({ accountId: 'acc-1', accountName: 'Test Org', uid: 'acc-1' } as Account), selectedUrlSegment: signal('acme') },
        },
        { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
        { provide: OrgLensEmptyStateService, useValue: emptyStateStub(signal(state)) },
        // The page-level state's own actions (copy reference, contact support).
        MessageService,
        { provide: IntercomService, useValue: { show: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: OrgLensOrgScopeService, useValue: { current: signal(null), retryFailedRead: () => undefined } },
        {
          provide: OrgLensProjectDetailService,
          useValue: {
            // A null hero is the page's own whole-page not-found.
            getHero: vi.fn(() => of(null)),
            getInfluenceBlock: vi.fn(() => of(null)),
            getTrendBlock: vi.fn(() => of(null)),
            getTechnicalBoard: vi.fn(() => of({ rows: [], total: 0 })),
            getEcosystemBoard: vi.fn(() => of({ rows: [], total: 0 })),
            getLeaderboardBreakdown: vi.fn(() => of(null)),
          },
        },
        {
          provide: PersonDetailDrawerService,
          useValue: {
            open: vi.fn(),
            close: vi.fn(),
            isOpen: signal(false),
            activeContext: signal(null),
            activeTab: signal('events'),
            loading: signal(false),
            error: signal(null),
            emailError: signal(false),
            emailsLoading: signal(false),
            companyEmails: signal([]),
          },
        },
        { provide: Router, useValue: { navigate: vi.fn(), events: EMPTY, createUrlTree: vi.fn(() => ({}) as UrlTree), serializeUrl: vi.fn(() => '') } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ projectSlug: 'k8s' })),
            queryParamMap: of(convertToParamMap({})),
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgProjectDetailComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the page itself when there is no page-level state', async () => {
    const el = await render(null);

    expect(el.querySelector('[data-testid="org-project-detail-no-access-state"]')).toBeNull();
    expect(el.querySelector('[data-testid="project-detail-not-found"]')).not.toBeNull();
  });

  it('replaces the page with the contractor-no-grant state and renders none of its own states', async () => {
    const el = await render('contractor-no-grant');

    expect(el.querySelector('[data-testid="org-project-detail-no-access-state"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="project-detail-not-found"]')).toBeNull();
    expect(el.querySelector('[data-testid="project-detail-hero-loading"]')).toBeNull();
  });
});

/**
 * LFXV2-3379: when the warehouse has no v2 health category, the hero's `health` is `null`. The
 * badge must render an "Unavailable" tag matching the Org Lens projects table's equivalent state,
 * not omit the "Health score" section entirely (the pre-fix behavior — `healthMeta()` returned
 * `null` and the template's `@if (healthMeta(); as hm)` has no `@else`).
 */
describe('OrgProjectDetailComponent — healthMeta', () => {
  const HERO: OrgLensProjectHero = {
    projectName: 'Test Project',
    description: '',
    logoUrl: '',
    lfxInsightsUrl: null,
    firstCommit: null,
    softwareValueUsd: null,
    health: null,
    healthOverallScore: null,
    healthMaxScore: null,
    healthCoveredCategoryCount: null,
    healthMaintainer: null,
    healthSecurity: null,
    healthDevelopment: null,
    foundationLabel: '',
  };

  async function createComponent(hero: OrgLensProjectHero): Promise<OrgProjectDetailComponent> {
    await TestBed.configureTestingModule({
      imports: [OrgProjectDetailComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: AccountContextService,
          useValue: { selectedAccount: signal({ accountId: 'acc-1', accountName: 'Test Org', uid: 'acc-1' } as Account), selectedUrlSegment: signal('acme') },
        },
        { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
        { provide: OrgLensEmptyStateService, useValue: emptyStateStub(signal(null)) },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: OrgLensOrgScopeService, useValue: { current: signal(null), retryFailedRead: () => undefined } },
        {
          provide: OrgLensProjectDetailService,
          useValue: {
            getHero: vi.fn(() => of({ hero, isNonLfProject: false })),
            getInfluenceBlock: vi.fn(() => of(null)),
            getTrendBlock: vi.fn(() => of(null)),
            getTechnicalBoard: vi.fn(() => of({ rows: [], total: 0 })),
            getEcosystemBoard: vi.fn(() => of({ rows: [], total: 0 })),
            getLeaderboardBreakdown: vi.fn(() => of(null)),
          },
        },
        {
          provide: PersonDetailDrawerService,
          useValue: {
            open: vi.fn(),
            close: vi.fn(),
            isOpen: signal(false),
            activeContext: signal(null),
            activeTab: signal('events'),
            loading: signal(false),
            error: signal(null),
            emailError: signal(false),
            emailsLoading: signal(false),
            companyEmails: signal([]),
          },
        },
        { provide: Router, useValue: { navigate: vi.fn(), events: EMPTY, createUrlTree: vi.fn(() => ({}) as UrlTree), serializeUrl: vi.fn(() => '') } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ projectSlug: 'k8s' })),
            queryParamMap: of(convertToParamMap({})),
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgProjectDetailComponent);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  it('renders the "Unavailable" tag when the warehouse has no v2 health category', async () => {
    const component = await createComponent({ ...HERO, health: null });

    expect(component['healthMeta']()).toEqual(expect.objectContaining({ label: 'Unavailable' }));
  });

  it('renders the plain band label for a full, non-null health score', async () => {
    const component = await createComponent({ ...HERO, health: 'fair', healthMaxScore: 100, healthCoveredCategoryCount: 3 });

    expect(component['healthMeta']()).toEqual(expect.objectContaining({ label: 'Fair' }));
  });

  it('marks the label with an asterisk, on the bare band colors, when exactly 2 of 3 categories are covered (LFXV2-1262)', async () => {
    const component = await createComponent({ ...HERO, health: 'fair', healthMaxScore: 65, healthCoveredCategoryCount: 2 });

    expect(component['healthMeta']()).toEqual({ ...PD_HEALTH_TAG.fair, label: 'Fair*' });
  });

  it('keeps the "Unavailable" tag bare even when the covered count is 2', async () => {
    const component = await createComponent({ ...HERO, health: null, healthCoveredCategoryCount: 2 });

    expect(component['healthMeta']()).toEqual(expect.objectContaining({ label: 'Unavailable' }));
  });

  it('names a partial score in words, not with an asterisk, in the badge accessible name', async () => {
    const component = await createComponent({
      ...HERO,
      health: 'fair',
      healthOverallScore: 52,
      healthMaxScore: 65,
      healthCoveredCategoryCount: 2,
      healthMaintainer: 30,
      healthSecurity: null,
      healthDevelopment: 22,
    });

    expect(component['heroHealthAriaLabel']()).toBe(
      'Health: Fair, partial score (52/65). Maintainer Health 30/40, Security & Supply Chain -/35, Development Activity 22/25.'
    );
  });
});

/**
 * lfx-self-serve-ops#1219: the Organization scope picker drives every scoped Project Detail read and is kept in step with
 * `?orgScope=` (dropped at the default, insights).
 */
describe('OrgProjectDetailComponent — organization scope', () => {
  let queryParams: BehaviorSubject<ParamMap>;
  let navigate: Mock;
  let detail: Record<string, Mock>;

  async function create(
    initialQuery: Record<string, string> = {},
    hero: OrgLensProjectHero | null = null,
    influence: OrgLensInfluenceBlock | null = null
  ): Promise<{ fixture: ComponentFixture<OrgProjectDetailComponent>; component: OrgProjectDetailComponent }> {
    queryParams = new BehaviorSubject<ParamMap>(convertToParamMap(initialQuery));
    navigate = vi.fn();
    detail = {
      getHero: vi.fn(() => of(hero ? { hero, isNonLfProject: false } : null)),
      getInfluenceBlock: vi.fn(() => of(influence)),
      getTrendBlock: vi.fn(() => of(null)),
      getTechnicalBoard: vi.fn(() => of({ rows: [], total: 0 })),
      getEcosystemBoard: vi.fn(() => of({ rows: [], total: 0 })),
      getLeaderboardBreakdown: vi.fn(() => of(null)),
      getCardDrawer: vi.fn(() => of(null)),
      getCardRoster: vi.fn(() => of({ rows: [], total: 0 })),
    };
    await TestBed.configureTestingModule({
      imports: [OrgProjectDetailComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: AccountContextService,
          useValue: { selectedAccount: signal({ accountId: 'acc-1', accountName: 'Test Org', uid: 'acc-1' } as Account), selectedUrlSegment: signal('acme') },
        },
        { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
        { provide: OrgLensEmptyStateService, useValue: emptyStateStub(signal(null)) },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: OrgLensOrgScopeService, useValue: { current: signal(null), retryFailedRead: () => undefined } },
        { provide: OrgLensProjectDetailService, useValue: detail },
        {
          provide: PersonDetailDrawerService,
          useValue: {
            open: vi.fn(),
            close: vi.fn(),
            isOpen: signal(false),
            activeContext: signal(null),
            activeTab: signal('events'),
            loading: signal(false),
            error: signal(null),
            emailError: signal(false),
            emailsLoading: signal(false),
            companyEmails: signal([]),
          },
        },
        { provide: Router, useValue: { navigate, events: EMPTY, createUrlTree: vi.fn(() => ({}) as UrlTree), serializeUrl: vi.fn(() => '') } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ projectSlug: 'k8s' })),
            queryParamMap: queryParams.asObservable(),
            snapshot: {
              get queryParamMap(): ParamMap {
                return queryParams.value;
              },
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgProjectDetailComponent);
    await fixture.whenStable();
    return { fixture, component: fixture.componentInstance };
  }

  it('reads the influence cards under insights when the URL names no scope', async () => {
    await create();

    expect(detail['getInfluenceBlock']).toHaveBeenLastCalledWith('acc-1', 'Test Org', 'k8s', expect.any(String), 'insights');
  });

  // lfx-self-serve#4735: the organization scope sits behind "More filters".
  it('keeps the organization scope behind More filters in the filter strip, counted from the address', async () => {
    const hero: OrgLensProjectHero = {
      projectName: 'Kubernetes',
      description: '',
      logoUrl: '',
      lfxInsightsUrl: null,
      firstCommit: null,
      softwareValueUsd: null,
      health: null,
      healthOverallScore: null,
      healthMaxScore: null,
      healthCoveredCategoryCount: null,
      healthMaintainer: null,
      healthSecurity: null,
      healthDevelopment: null,
      foundationLabel: '',
    };
    const { fixture } = await create({ orgScope: 'all' }, hero);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const toggle = (): HTMLButtonElement => el.querySelector('[data-testid="project-detail-more-filters-toggle"]')!;
    const panel = (): HTMLElement => el.querySelector('#project-detail-more-filters')!;

    expect(el.querySelector('lfx-org-project-detail-tab-bar [data-testid="project-detail-more-filters-toggle"]')).not.toBeNull();
    expect(el.querySelector('lfx-org-project-detail-tab-bar [data-test="project-detail-org-scope-filter"]')).toBeNull();
    expect(panel().querySelector('[data-test="project-detail-org-scope-filter"]')).not.toBeNull();
    expect(panel().classList).toContain('hidden');
    expect(toggle().getAttribute('aria-controls')).toBe('project-detail-more-filters');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent?.trim()).toBe('More filters (1)');

    toggle().click();
    await fixture.whenStable();
    expect(panel().classList).not.toContain('hidden');
    expect(toggle().textContent?.trim()).toBe('Fewer filters');
  });

  it('reads the influence cards under the scope the URL names', async () => {
    await create({ orgScope: 'all' });

    expect(detail['getInfluenceBlock']).toHaveBeenLastCalledWith('acc-1', 'Test Org', 'k8s', expect.any(String), 'all');
  });

  // Under insights the band chips are the Insights organization's row only; when it has none on the project the BFF
  // sends null levels even if a related organization has a row, and the section titles carry no chip at all.
  it.each([
    { levels: { technical: null, ecosystem: null }, chips: 0 },
    { levels: { technical: 'leading', ecosystem: 'contributing' }, chips: 2 },
  ] as const)('renders $chips band chips for levels $levels', async ({ levels, chips }) => {
    const hero: OrgLensProjectHero = {
      projectName: 'Kubernetes',
      description: '',
      logoUrl: '',
      lfxInsightsUrl: null,
      firstCommit: null,
      softwareValueUsd: null,
      health: null,
      healthOverallScore: null,
      healthMaxScore: null,
      healthCoveredCategoryCount: null,
      healthMaintainer: null,
      healthSecurity: null,
      healthDevelopment: null,
      foundationLabel: '',
    };
    const { fixture } = await create({}, hero, { technical: [], ecosystem: [], isNonLfProject: false, levels });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="project-detail-technical-group"] h2')?.textContent).toBe('Our Technical Influence');
    expect(el.querySelectorAll('[data-testid="project-detail-technical-band"], [data-testid="project-detail-ecosystem-band"]')).toHaveLength(chips);
  });

  it('re-reads the influence cards and writes ?orgScope= on a pick, dropping it at the default', async () => {
    const { fixture, component } = await create();

    component['scopeForm'].controls.orgScope.setValue('all');
    await fixture.whenStable();
    expect(detail['getInfluenceBlock']).toHaveBeenLastCalledWith('acc-1', 'Test Org', 'k8s', expect.any(String), 'all');
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { orgScope: 'all' } }));

    queryParams.next(convertToParamMap({ orgScope: 'all' }));
    component['scopeForm'].controls.orgScope.setValue('insights');
    await fixture.whenStable();
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { orgScope: null } }));
  });

  it('passes the picker the note on what the pick changes on this page', async () => {
    const { component } = await create();

    expect(component['orgScopeNote']).toBe(ORG_SCOPE_PROJECT_DETAIL_NOTE);
  });

  it('keeps ?orgScope=all on the way back to Projects, and nothing at the default', async () => {
    const { component } = await create({ orgScope: 'all' });

    expect(component['breadcrumbHome']().queryParams).toEqual({ orgScope: 'all' });
    expect(component['breadcrumbItems']()[0].queryParams).toEqual({ orgScope: 'all' });

    queryParams.next(convertToParamMap({}));
    expect(component['breadcrumbHome']().queryParams).toEqual({});
  });

  it('re-reads both leaderboards with the picked scope', async () => {
    const { fixture, component } = await create({ tab: 'pd-leaderboards' });

    component['scopeForm'].controls.orgScope.setValue('all');
    await fixture.whenStable();

    expect(detail['getTechnicalBoard']).toHaveBeenLastCalledWith('acc-1', 'Test Org', 'k8s', expect.any(String), expect.any(String), 0, 10, '', 'all');
    expect(detail['getEcosystemBoard']).toHaveBeenLastCalledWith('acc-1', 'Test Org', 'k8s', expect.any(String), expect.any(String), 0, 10, '', 'all');
  });

  it('keys the card drawer cache by scope and sends the scope with the drawer and roster reads', async () => {
    const { fixture, component } = await create();

    component['loadDrawer']('commits');
    component['loadDrawer']('commits');
    expect(detail['getCardDrawer']).toHaveBeenCalledTimes(1);
    expect(detail['getCardDrawer']).toHaveBeenLastCalledWith('acc-1', 'Test Org', 'k8s', 'commits', expect.any(String), 'insights');

    component['scopeForm'].controls.orgScope.setValue('all');
    await fixture.whenStable();
    component['loadDrawer']('commits');
    expect(detail['getCardDrawer']).toHaveBeenCalledTimes(2);
    expect(detail['getCardDrawer']).toHaveBeenLastCalledWith('acc-1', 'Test Org', 'k8s', 'commits', expect.any(String), 'all');

    component['loadRosterPage']('commits', 0, 10);
    expect(detail['getCardRoster']).toHaveBeenLastCalledWith('acc-1', 'Test Org', 'k8s', 'commits', expect.any(String), 0, 10, 'all');
  });
});
