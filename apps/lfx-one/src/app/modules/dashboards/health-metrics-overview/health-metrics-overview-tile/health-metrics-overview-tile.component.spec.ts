// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { HealthMetricsOverviewTileComponent } from './health-metrics-overview-tile.component';

import type { HealthMetricsOverviewTileViewModel } from '@lfx-one/shared/interfaces';

describe('HealthMetricsOverviewTileComponent', () => {
  let fixture: ComponentFixture<HealthMetricsOverviewTileComponent>;

  function tile(overrides: Partial<HealthMetricsOverviewTileViewModel> = {}): HealthMetricsOverviewTileViewModel {
    return {
      area: 'eng',
      name: 'Engagement',
      icon: 'fa-light fa-people-group',
      statValue: '8 of 31',
      statLabel: 'below 50%',
      classification: 'act',
      evaluatedAt: '2026-09-01',
      ...overrides,
    };
  }

  async function render(overrides: Partial<HealthMetricsOverviewTileViewModel> = {}): Promise<void> {
    await TestBed.configureTestingModule({ imports: [HealthMetricsOverviewTileComponent], providers: [provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsOverviewTileComponent);
    fixture.componentRef.setInput('tile', tile(overrides));
    fixture.detectChanges();
  }

  it('renders the classification status label and no Insights link when insightsUrl is unset', async () => {
    await render();

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-insights-link"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Needs action');
  });

  it('renders the Insights link and no status label when insightsUrl is set', async () => {
    await render({ area: 'code', insightsUrl: 'https://insights.lfx.dev/foundation-slug' });

    const link = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-insights-link"]');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('https://insights.lfx.dev/foundation-slug');
    expect(fixture.nativeElement.textContent).not.toContain('Needs action');
  });

  it('renders the Engagement link with no status chip when a route is set and the status is hidden', async () => {
    await render({
      classification: 'none',
      showStatus: false,
      route: { commands: ['/foundation/health-metrics', 'engagement'], fragment: 'committees', queryParams: { groupType: null } },
      routeLabel: 'View groups',
    });

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-eng-link"]');
    expect(link.getAttribute('href')).toBe('/foundation/health-metrics/engagement#committees');
    expect(link.textContent).toContain('View groups');
    expect(fixture.nativeElement.textContent).not.toContain('Awaiting data');
  });

  it('keeps the status chip beside the link when the tile shows its status', async () => {
    await render({
      area: 'evt',
      classification: 'watch',
      route: { commands: ['/foundation/health-metrics', 'events'], fragment: 'forecast', queryParams: { event: null } },
      routeLabel: 'View forecast',
    });

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt-link"]');
    expect(link.getAttribute('href')).toBe('/foundation/health-metrics/events#forecast');
    expect(link.textContent).toContain('View forecast');
    expect(fixture.nativeElement.textContent).toContain('Needs attention');
  });

  it('renders no status row for a statusless tile without a link, leaving the "as of" label first', async () => {
    await render({ area: 'evt', classification: 'none', showStatus: false, statValue: '—' });

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-status-row"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('as of');
  });

  it('renders no "as of" label for a never-evaluated (empty evaluatedAt) tile', async () => {
    await render({ evaluatedAt: '' });

    expect(fixture.nativeElement.textContent).not.toContain('as of');
  });
});
