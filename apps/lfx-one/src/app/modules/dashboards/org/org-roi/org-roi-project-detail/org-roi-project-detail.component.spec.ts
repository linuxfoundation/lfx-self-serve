// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ORG_LENS_ROI_DEFAULT_METHOD } from '@lfx-one/shared/constants';
import type { Account, OrgLensEmptyStateName, OrgLensRoiProjectAnnual, OrgLensRoiProjectDetail } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { IntercomService } from '@services/intercom.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { OrgLensRoiMethodPreferenceService } from '@services/org-lens-roi-method-preference.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgRoiProjectDetailComponent } from './org-roi-project-detail.component';

const ACCOUNT = { accountId: 'acc-1', accountName: 'Test Org', uid: 'acc-1' } as Account;

const DETAIL = {
  orgUid: 'acc-1',
  method: ORG_LENS_ROI_DEFAULT_METHOD,
  hasOrgLensProject: false,
  project: { projectSlug: 'k8s', projectName: 'Kubernetes', totalExpenditure: 1000, totalReturn: 5000, profit: 4000, roi: 4, bcr: 5 },
} as unknown as OrgLensRoiProjectDetail;

const ANNUAL = { rows: [], apportioned: false, efficiencyConstant: false } as unknown as OrgLensRoiProjectAnnual;

describe('OrgRoiProjectDetailComponent — page-level empty state (#2961)', () => {
  let fixture: ComponentFixture<OrgRoiProjectDetailComponent>;
  let pageState: WritableSignal<OrgLensEmptyStateName | null>;
  let pageReady: WritableSignal<boolean>;

  const byTestId = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(async () => {
    pageState = signal<OrgLensEmptyStateName | null>(null);
    pageReady = signal(true);

    await TestBed.configureTestingModule({
      imports: [OrgRoiProjectDetailComponent],
      providers: [
        provideRouter([]),
        // The page-level state's own actions (copy reference, contact support).
        MessageService,
        { provide: IntercomService, useValue: { show: vi.fn() } },
        { provide: AccountContextService, useValue: { selectedAccount: signal(ACCOUNT) } },
        { provide: OrgLensNavigationService, useValue: { orgLensLink: (...segments: string[]) => ['/org', ...segments] } },
        { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
        {
          provide: OrgLensEmptyStateService,
          useValue: {
            pageState,
            hasPageState: computed(() => pageState() !== null),
            pageReady,
            settled: signal(true),
            retrying: signal(false),
            retry: vi.fn(),
          },
        },
        { provide: OrgLensRoiService, useValue: { getProjectDetail: vi.fn(() => of(DETAIL)), getProjectAnnual: vi.fn(() => of(ANNUAL)) } },
        { provide: OrgLensRoiMethodPreferenceService, useValue: { read: vi.fn(() => null) } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ projectSlug: 'k8s' })) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgRoiProjectDetailComponent);
  });

  it('renders the contractor-no-grant page state instead of the figures', async () => {
    pageState.set('contractor-no-grant');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(byTestId('org-roi-project-detail-no-access-state')?.getAttribute('data-state')).toBe('contractor-no-grant');
    expect(byTestId('org-roi-project-detail-kpi-cards')).toBeNull();
    expect(byTestId('org-roi-project-detail-skeleton')).toBeNull();
  });

  it('holds a skeleton, not the figures, until the page is ready', async () => {
    pageReady.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(byTestId('org-roi-project-detail-skeleton')).not.toBeNull();
    expect(byTestId('org-roi-project-detail-kpi-cards')).toBeNull();
    expect(byTestId('org-roi-project-detail-no-access-state')).toBeNull();
  });

  it('renders the project figures once ready with no page state', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const cards = byTestId('org-roi-project-detail-kpi-cards');
    expect(cards).not.toBeNull();
    expect(cards?.textContent).toContain('Investment');
    expect(byTestId('org-roi-project-detail-skeleton')).toBeNull();
    expect(byTestId('org-roi-project-detail-no-access-state')).toBeNull();
  });
});
