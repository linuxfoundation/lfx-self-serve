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
    expect(link.getAttribute('aria-label')).toBe('Open Engagement');
    expect(link.textContent).toContain('8 of 31');
    expect(link.textContent).not.toContain('View');
    expect(fixture.nativeElement.textContent).not.toContain('Awaiting data');
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

  it('renders no status chip for a statusless tile, leaving the "as of" label', async () => {
    await render({ area: 'evt', classification: 'none', showStatus: false, statValue: '—' });

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-status"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('as of');
  });

  it('renders the stat detail line in its tone colour when the tile carries one', async () => {
    await render({ area: 'mem', statDetail: { text: '3 of 12 unsecured · $40K', tone: 'watch' } });

    const detail: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-mem-detail"]');
    expect(detail.textContent?.trim()).toBe('3 of 12 unsecured · $40K');
    expect(detail.classList).toContain('text-amber-600');
  });

  it('renders the stat detail line neutral when it has no tone, and omits it when absent', async () => {
    await render({ area: 'evt', statDetail: { text: '1,204 registrations · goal 1,500' } });

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt-detail"]').classList).toContain('text-gray-500');
    TestBed.resetTestingModule();
    await render({ area: 'evt' });
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt-detail"]')).toBeNull();
  });

  it('renders no "as of" label for a never-evaluated (empty evaluatedAt) tile', async () => {
    await render({ evaluatedAt: '' });

    expect(fixture.nativeElement.textContent).not.toContain('as of');
  });
});
