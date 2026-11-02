// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { OverviewNewsletterCardComponent } from './overview-newsletter-card.component';

import type { HealthMetricsOverviewNewsletterPeriod, HealthMetricsOverviewNewsletters } from '@lfx-one/shared/interfaces';

const YEAR = new Date().getFullYear();
const PERIOD: HealthMetricsOverviewNewsletterPeriod = {
  subscribers: 1458,
  subscribersGrowth: 0.39,
  growthBaselineDate: `${YEAR}-01-05`,
  newslettersSent: 10,
  avgOpenRate: 0.43,
  avgClickToOpenRate: 0.09,
  highEngagement: 175,
  mediumEngagement: 496,
  lowEngagement: 787,
  highEngagementShare: 0.12,
  mediumEngagementShare: 0.34,
  lowEngagementShare: 0.54,
  newslettersConsidered: 10,
  mostEngagingName: 'Monthly: Protocol ships',
  mostEngagingClickToOpenRate: 0.12,
};
const NEWSLETTERS: HealthMetricsOverviewNewsletters = {
  measured: true,
  periods: { YTD: PERIOD, COMPLETED_YEAR: PERIOD, COMPLETED_YEAR_2: null, COMPLETED_YEAR_3: null },
  newsletters: [
    { key: 'n2', name: 'Monthly: Protocol ships', sentDate: `${YEAR}-09-21`, openRate: 0.5, clickRate: 0.06 },
    { key: 'n1', name: 'Monthly: Hello', sentDate: `${YEAR}-08-24`, openRate: 0.37, clickRate: 0.0185 },
  ],
};

describe('OverviewNewsletterCardComponent', () => {
  let fixture: ComponentFixture<OverviewNewsletterCardComponent>;

  async function render(payload: HealthMetricsOverviewNewsletters = NEWSLETTERS): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OverviewNewsletterCardComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getOverviewNewsletters: vi.fn().mockReturnValue(of(payload)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewNewsletterCardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('shows the KPIs, a point per newsletter and the subscriber engagement split', async () => {
    await render();

    expect(text('overview-newsletter-kpis-subscribers-value')).toBe('1,458');
    expect(text('overview-newsletter-kpis-cto-value')).toBe('9%');
    expect(query('overview-newsletter-chart')).not.toBeNull();
    // Each open point takes focus, and its tooltip carries the same words as its accessible name.
    const point = query('overview-newsletter-open-n1');
    expect(point?.getAttribute('tabindex')).toBe('0');
    expect(point?.getAttribute('aria-label')).toBe(`Monthly: Hello · Aug 24, ${YEAR} · open 37%, click 2%`);
    expect(text('overview-newsletter-tip-n1')).toBe(`Monthly: Hello · Aug 24, ${YEAR} · open 37%, click 2%`);
    expect(query('overview-newsletter-tip-n1')?.className).toContain('left-0');
    const high = [...(query('overview-newsletter-engagement-high')?.children ?? [])].map((cell) => cell.textContent?.trim());
    expect(high).toEqual(['HighOpened 7+ newsletters and clicked a link', '175', '12%']);
    const mostEngaging = [...(query('overview-newsletter-most-engaging')?.children ?? [])].map((cell) => cell.textContent?.trim());
    expect(mostEngaging).toEqual(['Most engaging newsletter · 12% click-to-open', 'Monthly: Protocol ships']);
    const explore = query('overview-newsletter-explore') as HTMLAnchorElement;
    expect(explore.textContent?.trim()).toBe('Explore Newsletters');
    expect(explore.getAttribute('href')).toBe('/foundation/health-metrics/engagement#newsletters');
  });

  it('says so in place of the chart when no newsletter in the period carries engagement data', async () => {
    await render({ ...NEWSLETTERS, newsletters: [] });

    expect(query('overview-newsletter-chart')).toBeNull();
    expect(query('overview-newsletter-chart-empty')).not.toBeNull();
  });

  it('offers to create a newsletter, for the foundation, when nothing has gone out this year', async () => {
    await render({ ...NEWSLETTERS, periods: { ...NEWSLETTERS.periods, YTD: { ...PERIOD, newslettersSent: 0 } } });

    expect(text('overview-newsletter-empty-title')).toBe('No newsletters sent');
    const create = query('overview-newsletter-empty-create') as HTMLAnchorElement;
    expect(create.textContent?.trim()).toBe('Create Newsletter');
    expect(create.getAttribute('href')).toBe('/foundation/newsletters/create?project=acme');
  });

  it('words a past year’s empty state for that year, with no offer to create one', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR_2');
    fixture.detectChanges();

    expect(text('overview-newsletter-empty-title')).toBe(`No newsletters in ${YEAR - 2}`);
    expect(query('overview-newsletter-empty-create')).toBeNull();
  });
});
