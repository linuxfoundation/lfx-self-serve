// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { HealthMetricsOverviewRailComponent } from './health-metrics-overview-rail.component';

import type { HealthMetricsOverviewFoundationSummary, HealthMetricsOverviewRevenue } from '@lfx-one/shared/interfaces';

describe('HealthMetricsOverviewRailComponent', () => {
  let fixture: ComponentFixture<HealthMetricsOverviewRailComponent>;

  const revenue: HealthMetricsOverviewRevenue = {
    total: 1_000_000,
    streams: [
      { key: 'memberships', value: 600_000 },
      { key: 'events', value: 300_000 },
      { key: 'training', value: 100_000 },
    ],
  };

  const foundationSummary: HealthMetricsOverviewFoundationSummary = {
    size: 'Large',
    projects: 14,
    tiers: '4 tiers',
    board: '12 seats',
    nextRenewals: '5 in the next 30 days',
  };

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({ imports: [HealthMetricsOverviewRailComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsOverviewRailComponent);
    fixture.componentRef.setInput('revenue', revenue);
    fixture.componentRef.setInput('foundationSummary', foundationSummary);
    fixture.detectChanges();
  }

  it('renders the formatted revenue total and a percent-share legend row per stream', async () => {
    await render();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Memberships');
    expect(text).toContain('60%');
    expect(text).toContain('Events');
    expect(text).toContain('30%');
    expect(text).toContain('Training');
    expect(text).toContain('10%');
  });

  it('renders the foundation summary fields and the fixed data-sources tag list', async () => {
    await render();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Large');
    expect(text).toContain('14');
    expect(text).toContain('4 tiers');
    expect(text).toContain('12 seats');
    expect(text).toContain('5 in the next 30 days');
    expect(text).toContain('Membership');
    expect(text).toContain('LFX Insights');
  });
});
