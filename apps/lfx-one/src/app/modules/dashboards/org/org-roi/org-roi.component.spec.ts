// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, NO_ERRORS_SCHEMA, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ORG_LENS_ROI_DEFAULT_METHOD } from '@lfx-one/shared/constants';
import type { Account, OrgLensEmptyStateName, OrgLensRoiCoverage, OrgLensRoiSummary } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgLensRoiMethodPreferenceService } from '@services/org-lens-roi-method-preference.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import { OrgNavigationService } from '@services/org-navigation.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';

import { OrgRoiComponent } from './org-roi.component';

const ACCOUNT_ID = 'acc-1';

const SUMMARY: OrgLensRoiSummary = {
  orgUid: ACCOUNT_ID,
  method: ORG_LENS_ROI_DEFAULT_METHOD,
  hasData: true,
  nProjects: 3,
  totalExpenditure: 1000,
  totalReturn: 3000,
  profit: 2000,
  roi: 2,
  bcr: 3,
  yearMin: 2020,
  yearMax: 2024,
  dateMin: '2020-01-01',
  dateMax: '2024-12-31',
};

const COVERAGE: OrgLensRoiCoverage = { orgUid: ACCOUNT_ID, hasData: true, coverageReason: 'unmapped' };

interface RenderOptions {
  pageReady?: boolean;
  pageState?: OrgLensEmptyStateName | null;
}

interface Rendered {
  fixture: ComponentFixture<OrgRoiComponent>;
  pageState: WritableSignal<OrgLensEmptyStateName | null>;
}

async function render(options: RenderOptions = {}): Promise<Rendered> {
  const pageState = signal<OrgLensEmptyStateName | null>(options.pageState ?? null);
  const selectedAccount = signal<Account>({ accountId: ACCOUNT_ID, accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [OrgRoiComponent],
    providers: [
      provideRouter([]),
      MessageService,
      { provide: AccountContextService, useValue: { selectedAccount } },
      // Never loads: an admitted contractor with no switcher access has no org list to wait for (#2961).
      { provide: OrgNavigationService, useValue: { loaded: signal(false) } },
      { provide: OrgRoleGrantsService, useValue: { loaded: signal(true), correlationId: signal(null) } },
      {
        provide: OrgLensEmptyStateService,
        useValue: {
          pageState,
          hasPageState: computed(() => pageState() !== null),
          pageReady: signal(options.pageReady ?? true),
          settled: signal(true),
          retrying: signal(false),
          retry: vi.fn(),
        },
      },
      { provide: OrgLensRoiService, useValue: { getSummary: () => of(SUMMARY), getCoverage: () => of(COVERAGE) } },
      { provide: OrgLensRoiMethodPreferenceService, useValue: { read: () => null, write: vi.fn() } },
    ],
  })
    .overrideComponent(OrgRoiComponent, {
      set: { imports: [OrgLensEmptyStateComponent, EmptyStateComponent, SkeletonModule], schemas: [NO_ERRORS_SCHEMA] },
    })
    .compileComponents();

  const fixture = TestBed.createComponent(OrgRoiComponent);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, pageState };
}

function has(fixture: ComponentFixture<OrgRoiComponent>, selector: string): boolean {
  return !!fixture.nativeElement.querySelector(selector);
}

describe('OrgRoiComponent — page readiness', () => {
  it('shows the loading skeleton and no ROI content before the page is ready', async () => {
    const { fixture } = await render({ pageReady: false });

    expect(has(fixture, '[data-testid="org-roi-loading"]')).toBe(true);
    expect(has(fixture, 'lfx-org-roi-kpi-cards')).toBe(false);
    expect(has(fixture, 'lfx-org-roi-projects-section')).toBe(false);
    expect(has(fixture, '[data-testid="org-roi-no-access-state"]')).toBe(false);
  });

  it('renders the ROI content once the page is ready, even though the org list never loads', async () => {
    const { fixture } = await render({ pageReady: true });

    expect(has(fixture, '[data-testid="org-roi-loading"]')).toBe(false);
    expect(has(fixture, 'lfx-org-roi-kpi-cards')).toBe(true);
    expect(has(fixture, 'lfx-org-roi-projects-section')).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="org-roi-window"]')?.textContent).toContain('2020–2024');
  });

  it('replaces the page with the contractor-no-grant state and renders no ROI content', async () => {
    const { fixture } = await render({ pageState: 'contractor-no-grant' });

    expect(has(fixture, '[data-testid="org-roi-no-access-state"]')).toBe(true);
    expect(has(fixture, '[data-testid="org-roi-loading"]')).toBe(false);
    expect(has(fixture, 'lfx-org-roi-kpi-cards')).toBe(false);
    expect(has(fixture, 'lfx-org-roi-projects-section')).toBe(false);
    expect(has(fixture, '[data-testid="org-roi-assumptions-trigger"]')).toBe(false);
  });
});
