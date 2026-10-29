// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { ChartComponent } from '@components/chart/chart.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { FoundationValueConcentrationResponse } from '@lfx-one/shared/interfaces';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FoundationHealthComponent } from './foundation-health.component';

describe('FoundationHealthComponent metric availability', () => {
  const valueResponse = (totalValue = 12): FoundationValueConcentrationResponse => ({
    totalValue,
    top1Value: totalValue,
    top3Value: totalValue,
    top5Value: totalValue,
    allOtherValue: 0,
    totalProjectsCount: 1,
    top1Percentage: 100,
    top3Percentage: 100,
    top5Percentage: 100,
    allOtherPercentage: 0,
  });
  const failure = (status: number, code?: string) => throwError(() => new HttpErrorResponse({ status, error: code ? { code } : 'Proxy error' }));
  const selectedFoundation = signal<{ slug: string; name: string } | null>(null);
  let fixture: ComponentFixture<FoundationHealthComponent>;
  let analytics: ReturnType<typeof createAnalytics>;

  function createAnalytics() {
    return {
      getFoundationValueConcentration: vi.fn<AnalyticsService['getFoundationValueConcentration']>().mockReturnValue(of(valueResponse())),
      getFoundationTotalProjects: vi.fn(() => of({ totalProjects: 7, monthlyData: [6, 7], monthlyLabels: ['Sep', 'Oct'] })),
      getFoundationTotalMembers: vi.fn(() => of({ totalMembers: 3, monthlyData: [2, 3], monthlyLabels: ['Sep', 'Oct'] })),
      getCompanyBusFactor: vi.fn(() => of({ topCompaniesCount: 2, topCompaniesPercentage: 60, otherCompaniesCount: 3, otherCompaniesPercentage: 40 })),
      getFoundationMaintainers: vi
        .fn<AnalyticsService['getFoundationMaintainers']>()
        .mockReturnValue(of({ currentMaintainers: 9, asOfDate: '2026-10-28', trendData: [8, 9], trendLabels: ['Oct 27', 'Oct 28'] })),
      getFoundationMaintainersMonthly: vi.fn(() => of({ monthlyData: [8, 9], monthlyLabels: ['Sep', 'Oct'] })),
      getFoundationHealthScoreDistribution: vi.fn(() => of({ excellent: 1, healthy: 0, fair: 0, concerning: 0, critical: 0, unscored: 0 })),
      getUniqueContributorsDaily: vi.fn(() => of({ data: [], avgContributors: 4, totalDays: 1 })),
      getFoundationActiveContributorsMonthlyDistinct: vi
        .fn<AnalyticsService['getFoundationActiveContributorsMonthlyDistinct']>()
        .mockReturnValue(of({ monthlyData: [4, 5], monthlyLabels: ['Sep', 'Oct'], latest: 5, momDeltaPercent: 25, momDirection: 'up' })),
      getFoundationEventsQuarterly: vi.fn(() => of({ quarterlyData: [1, 2], quarterlyLabels: ['Q2', 'Q3'] })),
    };
  }

  beforeEach(() => {
    analytics = createAnalytics();
    selectedFoundation.set({ slug: 'test-foundation', name: 'Test Foundation' });
  });

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [FoundationHealthComponent],
      providers: [provideRouter([]), { provide: AnalyticsService, useValue: analytics }, { provide: ProjectContextService, useValue: { selectedFoundation } }],
    })
      // Keep the actual metric/empty-state/button templates; unrelated drawers and Copilot are not under test.
      .overrideComponent(FoundationHealthComponent, {
        set: { imports: [NgTemplateOutlet, MetricCardComponent, EmptyStateComponent, ButtonComponent], schemas: [NO_ERRORS_SCHEMA] },
      })
      // Chart.js requires a canvas; card selection and availability do not depend on drawing one.
      .overrideComponent(MetricCardComponent, { remove: { imports: [ChartComponent] }, add: { schemas: [NO_ERRORS_SCHEMA] } })
      .compileComponents();
    fixture = TestBed.createComponent(FoundationHealthComponent);
    await fixture.whenStable();
  }

  function card(name: string): HTMLElement {
    const element = fixture.nativeElement.querySelector(`[data-testid="foundation-health-card-${name}"]`);
    expect(element, `missing ${name} card`).not.toBeNull();
    return element as HTMLElement;
  }

  function retry(name: string): void {
    const button = card(name).querySelector<HTMLButtonElement>(`[data-testid="foundation-health-card-${name}-retry"] button`);
    expect(button).not.toBeNull();
    button!.click();
  }

  it('renders all eight independently loaded metrics and keeps working drawers', async () => {
    await render();
    expect(fixture.componentInstance.metricCards()).toHaveLength(8);
    expect(card('total-projects').textContent).toContain('7');
    expect(card('total-value').textContent).toContain('$12.0M');
    card('total-projects').click();
    expect(fixture.componentInstance.activeDrawer()).not.toBeNull();
  });

  it('shows missing software value locally, without fabricated zeros or hiding healthy cards', async () => {
    analytics.getFoundationValueConcentration.mockReturnValue(failure(404, 'NOT_FOUND'));
    await render();
    expect(card('total-value').textContent).toContain('Data not available yet');
    expect(card('total-value').textContent).not.toContain('$0.0M');
    expect(card('total-value').querySelector('lfx-chart')).toBeNull();
    expect(card('total-value').querySelector('button')).toBeNull();
    expect(card('total-projects').textContent).toContain('7');
    expect(card('events').textContent).toContain('2');
    expect(fixture.nativeElement.querySelector('[data-testid="foundation-health-carousel"]')).not.toBeNull();
    card('total-value').click();
    expect(fixture.componentInstance.activeDrawer()).toBeNull();
  });

  it('preserves a genuine measured zero rather than treating it as missing data', async () => {
    analytics.getFoundationValueConcentration.mockReturnValue(of(valueResponse(0)));
    await render();
    expect(card('total-value').textContent).toContain('$0.0M');
    expect(card('total-value').querySelector('[role="status"]')).toBeNull();
  });

  describe.each([
    {
      name: 'total-projects',
      configure: (measured: boolean) =>
        analytics.getFoundationTotalProjects.mockReturnValue(
          of({ totalProjects: 0, monthlyData: measured ? [0] : [], monthlyLabels: measured ? ['Oct'] : [] })
        ),
    },
    {
      name: 'total-members',
      configure: (measured: boolean) =>
        analytics.getFoundationTotalMembers.mockReturnValue(of({ totalMembers: 0, monthlyData: measured ? [0] : [], monthlyLabels: measured ? ['Oct'] : [] })),
    },
    {
      name: 'maintainers',
      configure: (measured: boolean) =>
        analytics.getFoundationMaintainers.mockReturnValue(
          of({ currentMaintainers: 0, asOfDate: measured ? '2026-10-28' : null, trendData: measured ? [0] : [], trendLabels: measured ? ['Oct 28'] : [] })
        ),
    },
    {
      name: 'active-contributors',
      configure: (measured: boolean) =>
        analytics.getFoundationActiveContributorsMonthlyDistinct.mockReturnValue(
          of({ monthlyData: measured ? [0] : [], monthlyLabels: measured ? ['Oct'] : [], latest: 0, momDeltaPercent: null, momDirection: 'flat' })
        ),
    },
    {
      name: 'events',
      configure: (measured: boolean) =>
        analytics.getFoundationEventsQuarterly.mockReturnValue(of({ quarterlyData: measured ? [0] : [], quarterlyLabels: measured ? ['Q3'] : [] })),
    },
  ])('$name measurement presence', ({ name, configure }) => {
    it.each([false, true])('distinguishes an empty HTTP-200 response from a measured zero (measured=%s)', async (measured) => {
      configure(measured);
      analytics.getFoundationValueConcentration.mockReturnValue(failure(404, 'NOT_FOUND'));
      await render();
      const element = card(name);
      if (measured) {
        expect(element.querySelector('[role="status"]')).toBeNull();
        expect(element.querySelector('.text-xl')?.textContent?.trim()).toBe('0');
        element.click();
        expect(fixture.componentInstance.activeDrawer()).not.toBeNull();
      } else {
        expect(element.textContent).toContain('Data not available yet');
        expect(element.querySelector('.text-xl')).toBeNull();
        expect(element.querySelector('lfx-chart')).toBeNull();
        expect(element.querySelector('button')).toBeNull();
        element.click();
        expect(fixture.componentInstance.activeDrawer()).toBeNull();
        if (name === 'total-projects') {
          expect(card('project-health-scores').textContent).toContain('100%');
          expect(card('project-health-scores').textContent).toContain('Additional details are unavailable');
          expect(card('project-health-scores').querySelector('button')).toBeNull();
          card('project-health-scores').click();
          expect(fixture.componentInstance.activeDrawer()).toBeNull();
        }
      }
      expect(card('org-dependency').textContent).toContain('2');
    });
  });

  describe.each([
    {
      name: 'maintainers',
      headline: '9',
      configure: (measured: boolean) =>
        analytics.getFoundationMaintainersMonthly.mockReturnValue(of({ monthlyData: measured ? [0] : [], monthlyLabels: measured ? ['Oct'] : [] })),
    },
    {
      name: 'active-contributors',
      headline: '5',
      configure: (measured: boolean) => analytics.getUniqueContributorsDaily.mockReturnValue(of({ data: [], avgContributors: 0, totalDays: measured ? 1 : 0 })),
    },
  ])('$name supporting measurement presence', ({ name, headline, configure }) => {
    it.each([false, true])('preserves the headline and only enables measured supporting data (measured=%s)', async (measured) => {
      configure(measured);
      await render();
      const element = card(name);
      expect(element.querySelector('.text-xl')?.textContent?.trim()).toBe(headline);
      if (measured) {
        expect(element.querySelector('[role="status"]')).toBeNull();
      } else {
        expect(element.textContent).toContain('Additional details are unavailable');
        expect(element.textContent).toContain('Data not available yet');
        expect(element.querySelector('button')).toBeNull();
      }
      element.click();
      expect(fixture.componentInstance.activeDrawer() !== null).toBe(measured);
    });
  });

  it('updates snapshot availability when switching from measured to empty and back to measured foundations', async () => {
    await render();
    expect(card('maintainers').querySelector('.text-xl')?.textContent?.trim()).toBe('9');
    analytics.getFoundationMaintainers.mockReturnValueOnce(of({ currentMaintainers: 0, asOfDate: null, trendData: [], trendLabels: [] }));
    selectedFoundation.set({ slug: 'empty-foundation', name: 'Empty Foundation' });
    await fixture.whenStable();
    expect(card('maintainers').textContent).toContain('Data not available yet');
    expect(card('maintainers').querySelector('.text-xl')).toBeNull();
    selectedFoundation.set({ slug: 'test-foundation', name: 'Test Foundation' });
    await fixture.whenStable();
    expect(card('maintainers').querySelector('[role="status"]')).toBeNull();
    expect(card('maintainers').querySelector('.text-xl')?.textContent?.trim()).toBe('9');
  });

  it('treats a bare/proxy 404 as a retryable failure, not verified missing data', async () => {
    analytics.getFoundationValueConcentration.mockReturnValue(failure(404));
    await render();
    expect(card('total-value').textContent).toContain('This metric could not be loaded');
    expect(card('total-value').textContent).not.toContain('Data not available yet');
  });

  it('retries only the failed source and keeps successful cards mounted', async () => {
    analytics.getFoundationValueConcentration.mockReturnValueOnce(failure(500));
    await render();
    const projects = card('total-projects');
    expect(card('total-value').textContent).toContain('This metric could not be loaded');
    retry('total-value');
    await fixture.whenStable();
    expect(card('total-value').textContent).toContain('$12.0M');
    expect(card('total-projects')).toBe(projects);
    expect(analytics.getFoundationValueConcentration).toHaveBeenCalledTimes(2);
    for (const [name, method] of Object.entries(analytics)) {
      if (name !== 'getFoundationValueConcentration') expect(method, name).toHaveBeenCalledTimes(1);
    }
    expect(fixture.componentInstance.activeDrawer()).toBeNull();
  });

  it('keeps the maintainers headline when only its monthly details fail, and retries just those details', async () => {
    analytics.getFoundationMaintainersMonthly.mockReturnValueOnce(failure(500));
    await render();
    expect(card('maintainers').textContent).toContain('9');
    expect(card('maintainers').textContent).toContain('Additional details are unavailable');
    card('maintainers').click();
    expect(fixture.componentInstance.activeDrawer()).toBeNull();
    retry('maintainers');
    await fixture.whenStable();
    expect(analytics.getFoundationMaintainersMonthly).toHaveBeenCalledTimes(2);
    expect(analytics.getFoundationMaintainers).toHaveBeenCalledTimes(1);
    expect(card('maintainers').textContent).not.toContain('Additional details are unavailable');
    card('maintainers').click();
    expect(fixture.componentInstance.activeDrawer()).not.toBeNull();
  });

  it('hides the previous foundation monthly delta while new maintainer details are pending', async () => {
    await render();
    expect(card('maintainers').querySelector('[data-testid="metric-card-change-percentage"]')).not.toBeNull();
    const pending = new Subject<{ monthlyData: number[]; monthlyLabels: string[] }>();
    analytics.getFoundationMaintainersMonthly.mockReturnValueOnce(pending);
    analytics.getFoundationMaintainers.mockReturnValueOnce(
      of({ currentMaintainers: 42, asOfDate: '2026-10-29', trendData: [40, 42], trendLabels: ['Oct 28', 'Oct 29'] })
    );
    selectedFoundation.set({ slug: 'another-foundation', name: 'Another Foundation' });
    await fixture.whenStable();
    expect(card('maintainers').textContent).toContain('42');
    expect(card('maintainers').querySelector('[data-testid="metric-card-change-percentage"]')).toBeNull();
    pending.next({ monthlyData: [1, 2], monthlyLabels: ['Sep', 'Oct'] });
    pending.complete();
    await fixture.whenStable();
    expect(card('maintainers').querySelector('[data-testid="metric-card-change-percentage"]')?.textContent).toContain('100.0%');
  });

  it.each([
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ])('does not retry non-retryable supporting data (%s / %s)', async (status, code) => {
    analytics.getFoundationMaintainers.mockReturnValueOnce(failure(500));
    analytics.getFoundationMaintainersMonthly.mockReturnValue(failure(status, code));
    await render();
    retry('maintainers');
    await fixture.whenStable();
    expect(analytics.getFoundationMaintainers).toHaveBeenCalledTimes(2);
    expect(analytics.getFoundationMaintainersMonthly).toHaveBeenCalledTimes(1);
    expect(card('maintainers').textContent).toContain('9');
    expect(card('maintainers').querySelector('button')).toBeNull();
  });

  it('does not erase monthly contributor measurements when the daily drawer data fails', async () => {
    analytics.getUniqueContributorsDaily.mockReturnValueOnce(failure(500));
    await render();
    expect(card('active-contributors').textContent).toContain('5');
    expect(card('active-contributors').textContent).toContain('Additional details are unavailable');
    retry('active-contributors');
    await fixture.whenStable();
    expect(analytics.getUniqueContributorsDaily).toHaveBeenCalledTimes(2);
    expect(analytics.getFoundationActiveContributorsMonthlyDistinct).toHaveBeenCalledTimes(1);
  });

  it('keeps health-score measurements but blocks incomplete drawers when total projects fail', async () => {
    analytics.getFoundationTotalProjects.mockReturnValueOnce(failure(500));
    await render();
    expect(card('project-health-scores').textContent).toContain('100%');
    expect(card('project-health-scores').textContent).toContain('Additional details are unavailable');
    card('project-health-scores').click();
    expect(fixture.componentInstance.activeDrawer()).toBeNull();
    retry('project-health-scores');
    await fixture.whenStable();
    expect(analytics.getFoundationTotalProjects).toHaveBeenCalledTimes(2);
    expect(analytics.getFoundationHealthScoreDistribution).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, 'FORBIDDEN', 'You do not have access to this metric'],
    [503, 'ACCESS_CHECK_UNAVAILABLE', 'Access could not be verified'],
    [503, 'ROLE_GRANTS_UNAVAILABLE', 'Access could not be verified'],
    [403, undefined, 'This metric could not be loaded'],
  ])('preserves access semantics for status %s / code %s', async (status, code, message) => {
    analytics.getFoundationValueConcentration.mockReturnValue(failure(status, code));
    await render();
    expect(card('total-value').textContent).toContain(message);
    expect(card('total-value').textContent).not.toContain('$0.0M');
    expect(card('total-projects').textContent).toContain('7');
  });

  it('does not let a pending software-value query hide metrics that are already available', async () => {
    analytics.getFoundationValueConcentration.mockReturnValue(new Subject<FoundationValueConcentrationResponse>());
    await render();
    expect(fixture.componentInstance.metricCards().find((metric) => metric.testId?.endsWith('-total-value'))?.loading).toBe(true);
    expect(card('total-projects').textContent).toContain('7');
    expect(card('total-value').textContent).not.toContain('$0.0M');
  });

  it('cancels the old foundation request and hides old measurements while the new selection loads', async () => {
    const oldValue = new Subject<FoundationValueConcentrationResponse>();
    const newValue = new Subject<FoundationValueConcentrationResponse>();
    analytics.getFoundationValueConcentration.mockImplementation((slug) => (slug === 'test-foundation' ? oldValue : newValue));
    await render();
    selectedFoundation.set({ slug: 'another-foundation', name: 'Another Foundation' });
    await fixture.whenStable();
    oldValue.next(valueResponse(999));
    oldValue.complete();
    await fixture.whenStable();
    expect(card('total-value').textContent).not.toContain('$999.0M');
    newValue.next(valueResponse(5));
    newValue.complete();
    await fixture.whenStable();
    expect(card('total-value').textContent).toContain('$5.0M');
    expect(analytics.getFoundationValueConcentration).toHaveBeenCalledTimes(2);
  });

  it('filters cards without refetching healthy or unavailable metrics', async () => {
    analytics.getFoundationValueConcentration.mockReturnValue(failure(404, 'NOT_FOUND'));
    await render();
    fixture.componentInstance.handleFilterChange('events');
    await fixture.whenStable();
    expect(fixture.componentInstance.metricCards()).toHaveLength(1);
    expect(card('events')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="foundation-health-card-total-value"]')).toBeNull();
    expect(analytics.getFoundationValueConcentration).toHaveBeenCalledTimes(1);
  });

  it('does not request unscoped analytics without a foundation selection', async () => {
    selectedFoundation.set(null);
    await render();
    for (const method of Object.values(analytics)) expect(method).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Please select a foundation');
  });
});
