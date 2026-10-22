// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { HealthMetricsOverviewRailComponent } from './health-metrics-overview-rail.component';

import type { HealthMetricsOverviewFoundationSummary, HealthMetricsOverviewRevenue } from '@lfx-one/shared/interfaces';

describe('HealthMetricsOverviewRailComponent', () => {
  let fixture: ComponentFixture<HealthMetricsOverviewRailComponent>;

  const revenue: HealthMetricsOverviewRevenue = {
    dataAvailable: true,
    total: 1_000_000,
    streams: [
      { key: 'memberships', value: 600_000, share: 60 },
      { key: 'events', value: 300_000, share: 30 },
      { key: 'training', value: 100_000, share: 10 },
    ],
  };

  const foundationSummary: HealthMetricsOverviewFoundationSummary = {
    dataAvailable: true,
    size: '1,725 members',
    projects: '14 projects',
    tiers: '4 tiers',
    board: '12 board seats',
    nextRenewals: '5 renewals in 90 days',
  };

  async function render(
    summary: HealthMetricsOverviewFoundationSummary = foundationSummary,
    revenueInput: HealthMetricsOverviewRevenue = revenue,
    periodLabel = 'YTD'
  ): Promise<void> {
    await TestBed.configureTestingModule({ imports: [HealthMetricsOverviewRailComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsOverviewRailComponent);
    fixture.componentRef.setInput('revenue', revenueInput);
    fixture.componentRef.setInput('revenuePeriodLabel', periodLabel);
    fixture.componentRef.setInput('foundationSummary', summary);
    fixture.componentRef.setInput('topPx', 88);
    fixture.detectChanges();
  }

  it('renders the formatted revenue total and a percent-share legend row per stream', async () => {
    await render();

    const rootEl: HTMLElement = fixture.nativeElement;
    expect(rootEl.textContent).toContain('$1M');

    const text = rootEl.textContent;
    expect(text).toContain('Memberships');
    expect(text).toContain('60%');
    expect(text).toContain('Events');
    expect(text).toContain('30%');
    expect(text).toContain('Training');
    expect(text).toContain('10%');
  });

  it('labels the revenue total with the selected period, at the design size and weight', async () => {
    await render(foundationSummary, revenue, '2025');

    const total: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-total"]');
    const [label, value] = Array.from<HTMLElement>(total.querySelectorAll('span'));
    expect(label.textContent?.trim()).toBe('Total 2025');
    expect(value.textContent?.trim()).toBe('$1M');
    expect(value.classList).toContain('text-[24px]');
    expect(value.classList).toContain('font-medium');
  });

  it('reads each legend entry "<percent> · <value>", with the value at regular weight', async () => {
    await render();

    const row: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-legend-memberships"]');
    const cells = Array.from<HTMLElement>(row.querySelectorAll('span'));
    expect(cells.map((el) => el.textContent?.trim())).toEqual(['', 'Memberships', '60%', '·', '$600K']);
    expect(cells[2].classList).not.toContain('text-gray-400');
    expect(cells[4].classList).not.toContain('font-semibold');
  });

  it('draws one rounded bar segment per measured stream, with no track behind them', async () => {
    await render(foundationSummary, {
      dataAvailable: true,
      total: 600_000,
      streams: [
        { key: 'memberships', value: 600_000, share: 100 },
        { key: 'events', value: null, share: null },
      ],
    });

    const bar: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-bar"]');
    expect(bar.classList).not.toContain('bg-gray-100');
    const segments = Array.from<HTMLElement>(bar.querySelectorAll('div'));
    expect(segments).toHaveLength(1);
    expect(segments[0].classList).toContain('rounded-full');
  });

  it('renders the foundation summary fields and the fixed data-sources tag list', async () => {
    await render();

    const sizeRow: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-foundation-summary-size"]');
    expect(Array.from<Element>(sizeRow.querySelectorAll('span')).map((el) => el.textContent?.trim())).toEqual(['Size', '1,725 members']);
    // Size leads the Foundation block, per the design.
    expect(sizeRow.parentElement?.firstElementChild).toBe(sizeRow);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('14 projects');
    expect(text).toContain('4 tiers');
    expect(text).toContain('12 board seats');
    expect(text).toContain('5 renewals in 90 days');
    // Values read at regular weight, per the design's `.rrow2 b{font-weight:400}`.
    expect(sizeRow.querySelectorAll('.font-semibold')).toHaveLength(0);

    const dataSourceTags = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('[data-testid="health-metrics-overview-rail-data-sources"] span')
    ).map((el) => (el.textContent ?? '').trim());
    expect(dataSourceTags).toEqual(['Membership', 'Meetings', 'Events', 'LFX Insights']);
  });

  it('shows a not-available message instead of placeholder values when the foundation summary is unavailable', async () => {
    await render({ dataAvailable: false, size: '—', projects: '—', tiers: '—', board: '—', nextRenewals: '—' });

    const rootEl: HTMLElement = fixture.nativeElement;
    expect(rootEl.querySelector('[data-testid="health-metrics-overview-foundation-summary-unavailable"]')?.textContent).toContain('not available yet');
    expect(rootEl.textContent).not.toContain('Membership tiers');
  });

  it('renders a null revenue stream as an em dash rather than $0 / 0%', async () => {
    await render(foundationSummary, {
      dataAvailable: true,
      total: 600_000,
      streams: [
        { key: 'memberships', value: 600_000, share: 100 },
        { key: 'events', value: null, share: null },
      ],
    });

    const eventsRow = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.flex-1')).find(
      (el) => el.textContent?.trim() === 'Events'
    )?.parentElement;
    const cells = Array.from<HTMLElement>(eventsRow?.querySelectorAll('span') ?? []).map((el) => el.textContent?.trim());
    expect(cells).toEqual(['', 'Events', '—', '·', '—']);
  });

  it('labels each stream with the model share, not a share recomputed from the streams', async () => {
    await render(foundationSummary, {
      dataAvailable: true,
      total: 1_000_000,
      streams: [{ key: 'memberships', value: 250_000, share: 31.6 }],
    });

    expect(fixture.nativeElement.textContent).toContain('32%');
    expect(fixture.nativeElement.textContent).not.toContain('25%');
  });

  it('applies the topPx input as the sticky offset', async () => {
    await render();

    const aside: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-rail"]');
    expect(aside.style.top).toBe('88px');
  });
});
