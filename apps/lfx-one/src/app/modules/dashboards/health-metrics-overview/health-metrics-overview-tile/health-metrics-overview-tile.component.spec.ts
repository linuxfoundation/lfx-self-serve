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

  it('makes the whole tile a link to the top of its tab, with no "View" text link', async () => {
    await render({ classification: 'none', showStatus: false, tabRoute: ['/foundation/health-metrics', 'engagement'] });

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-link"]');
    expect(link.getAttribute('href')).toBe('/foundation/health-metrics/engagement');
    expect(link.getAttribute('aria-label')).toBeNull();
    expect(link.getAttribute('title')).toBe('Open Engagement');
    expect(link.textContent).toContain('8 of 31');
    expect(link.textContent).not.toContain('View');
    expect(fixture.nativeElement.textContent).not.toContain('No data');
  });

  it('keeps the status chip inside the linked tile', async () => {
    await render({ area: 'evt', classification: 'watch', tabRoute: ['/foundation/health-metrics', 'events'] });

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-link"]');
    expect(link.querySelector('[data-testid="health-metrics-overview-tile-status"]')?.textContent).toContain('Needs attention');
  });

  it('renders a tile without a tab route as plain content', async () => {
    await render({ area: 'code', insightsUrl: 'https://insights.lfx.dev/foundation-slug' });

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-link"]')).toBeNull();
  });

  it('renders no status chip for a statusless tile', async () => {
    await render({ area: 'evt', classification: 'none', showStatus: false, statValue: '—' });

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-status"]')).toBeNull();
  });

  it('never renders an "as of" label, even for an evaluated tile', async () => {
    await render({ evaluatedAt: '2026-09-01' });

    expect(fixture.nativeElement.textContent).not.toContain('as of');
  });

  it.each([
    ['ok', 'Healthy', 'text-emerald-600'],
    ['none', 'No data', 'text-gray-500'],
    ['opp', 'Opportunity', 'text-blue-500'],
  ] as const)('words a %s status chip "%s", per the design rather than the findings group', async (classification, label, textClass) => {
    await render({ area: 'non', classification });

    const status: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-status"]');
    expect(status.textContent?.trim()).toBe(label);
    expect(status.classList).toContain(textClass);
  });

  it('capitalizes only the first letter of the caption, leaving the copy sentence-case', async () => {
    await render({ statLabel: 'groups inactive' });

    const caption: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-caption"]');
    expect(caption.textContent?.trim()).toBe('groups inactive');
    expect(caption.classList).toContain('first-letter:uppercase');
  });
});
