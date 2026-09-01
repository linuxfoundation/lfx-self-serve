// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, Router, UrlTree } from '@angular/router';
import { Account, BoardDisplayRow } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { OrgLensProjectDetailService } from '@services/org-lens-project-detail.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { EMPTY, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgProjectDetailComponent } from './org-project-detail.component';

/**
 * Covers the leaderboard row score-breakdown drawer's reactive close (GH-1798 Copilot finding):
 * `openLeaderboardDetail` only guards on `leaderboardDetailFeatureEnabled()` while opening, so a
 * LaunchDarkly config change that flips the flag off while the drawer is already open would
 * otherwise leave gated demo data on screen. The constructor's `toObservable` subscription in
 * org-project-detail.component.ts is what closes it.
 */
describe('OrgProjectDetailComponent — leaderboard detail drawer flag gating', () => {
  let fixture: ComponentFixture<OrgProjectDetailComponent>;
  let component: OrgProjectDetailComponent;
  let featureEnabled: WritableSignal<boolean>;

  const ACCOUNT: Account = { accountId: 'acc-1', accountName: 'Test Org', uid: 'acc-1' } as Account;

  const makeRow = (overrides: Partial<BoardDisplayRow> = {}): BoardDisplayRow => ({
    rank: 1,
    orgName: 'Acme',
    orgLogoUrl: '',
    initials: 'AC',
    activityLabel: '',
    bandLabel: '',
    bandSeverity: 'secondary',
    isViewingOrg: false,
    ...overrides,
  });

  beforeEach(async () => {
    featureEnabled = signal(true);

    await TestBed.configureTestingModule({
      imports: [OrgProjectDetailComponent],
      providers: [
        provideNoopAnimations(),
        { provide: AccountContextService, useValue: { selectedAccount: signal(ACCOUNT) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => featureEnabled) } },
        {
          provide: OrgLensProjectDetailService,
          useValue: {
            getHero: vi.fn(() => of(null)),
            getInfluenceBlock: vi.fn(() => of(null)),
            getTrendBlock: vi.fn(() => of(null)),
            getTechnicalBoard: vi.fn(() => of({ rows: [], total: 0 })),
            getEcosystemBoard: vi.fn(() => of({ rows: [], total: 0 })),
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
            paramMap: of(convertToParamMap({ projectSlug: 'k8s' })),
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

  it('closes the drawer when the flag flips off while it is open', async () => {
    component['openLeaderboardDetail']('technical', makeRow());
    expect(component['leaderboardDetailOpen']()).toBe(true);

    featureEnabled.set(false);
    await fixture.whenStable();

    expect(component['leaderboardDetailOpen']()).toBe(false);
  });

  it('leaves the drawer open while the flag stays on', async () => {
    component['openLeaderboardDetail']('technical', makeRow());
    await fixture.whenStable();

    expect(component['leaderboardDetailOpen']()).toBe(true);
  });
});
