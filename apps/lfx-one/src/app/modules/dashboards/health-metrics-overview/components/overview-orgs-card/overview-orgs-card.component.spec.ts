// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { OverviewOrgsCardComponent } from './overview-orgs-card.component';

import type { HealthMetricsOverviewParticipatingOrgs, HealthMetricsOverviewParticipatingOrgsPeriod } from '@lfx-one/shared/interfaces';

const SPLIT = { highCount: 182, mediumCount: 149, lowCount: 394, highPct: null, mediumPct: null, lowPct: null };
const PERIOD: HealthMetricsOverviewParticipatingOrgsPeriod = {
  activeMembers: 725,
  newMembers: 95,
  nonRenewals: 141,
  nonMembers: 7241,
  memberEngagement: SPLIT,
  nonMemberEngagement: SPLIT,
};
const ORGS: HealthMetricsOverviewParticipatingOrgs = {
  measured: true,
  periods: {
    YTD: PERIOD,
    COMPLETED_YEAR: PERIOD,
    COMPLETED_YEAR_2: { ...PERIOD, memberEngagement: null, nonMemberEngagement: null },
    COMPLETED_YEAR_3: PERIOD,
  },
};

describe('OverviewOrgsCardComponent', () => {
  let fixture: ComponentFixture<OverviewOrgsCardComponent>;
  let read: ReturnType<typeof vi.fn>;

  async function render(payload: HealthMetricsOverviewParticipatingOrgs | Error = ORGS): Promise<void> {
    read = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));
    await TestBed.configureTestingModule({
      imports: [OverviewOrgsCardComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getOverviewParticipatingOrgs: read } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewOrgsCardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(testId: string): string {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('reads the foundation once and draws both halves with their KPIs and engagement', async () => {
    await render();

    expect(read).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(text('overview-orgs-members-kpis-active-value')).toBe('725');
    expect(text('overview-orgs-non-members-kpis-non-members-value')).toBe('7,241');
    expect(text('overview-orgs-members-low')).toBe('54%');
    expect(text('overview-orgs-members-high')).toContain('182');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="overview-orgs-members"] svg circle')).toHaveLength(4);
  });

  it('links each half into its section', async () => {
    await render();

    expect(fixture.nativeElement.querySelector('[data-testid="overview-orgs-members-explore"]').getAttribute('href')).toContain('/members#list');
    expect(fixture.nativeElement.querySelector('[data-testid="overview-orgs-non-members-explore"]').getAttribute('href')).toContain('/non-members#orgs');
  });

  it('re-projects a period change without reading again, leaving an unmodelled split empty', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR_2');
    fixture.detectChanges();

    expect(read).toHaveBeenCalledTimes(1);
    expect(text('overview-orgs-members-low')).toBe('—');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="overview-orgs-members"] svg circle')).toHaveLength(1);
  });

  it('shows its empty state for a foundation with no row, and its error state when the read fails', async () => {
    await render({ ...ORGS, measured: false });
    expect(text('overview-orgs-empty')).toContain('No participating organizations yet');

    TestBed.resetTestingModule();
    await render(new Error('down'));
    expect(text('overview-orgs-error')).toContain('Unavailable right now');
  });
});
