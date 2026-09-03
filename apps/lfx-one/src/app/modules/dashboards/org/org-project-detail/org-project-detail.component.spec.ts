// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, type ParamMap, Router, UrlTree } from '@angular/router';
import { Account, BoardDisplayRow } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { OrgLensProjectDetailService } from '@services/org-lens-project-detail.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { BehaviorSubject, EMPTY, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgProjectDetailComponent } from './org-project-detail.component';

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
  const CLEARED_ACCOUNT: Account = { accountId: '', accountName: '', accountSlug: '', membershipTier: '' } as Account;

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
        { provide: AccountContextService, useValue: { selectedAccount } },
        // The page itself reads no flag; child components in its template do.
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
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
