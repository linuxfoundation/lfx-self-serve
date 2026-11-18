// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorldGeometryService } from '@services/world-geometry.service';
import { NEVER, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsWorldMapComponent } from './health-metrics-world-map.component';

import type { HealthMetricsWorldGeometry, HealthMetricsWorldMapCountry } from '@lfx-one/shared/interfaces';

const GEOMETRY: HealthMetricsWorldGeometry = {
  source: 'test',
  width: 960,
  height: 470,
  countries: [
    { code: 'US', name: 'United States', d: 'M0,0L10,10Z' },
    { code: 'NO', name: 'Norway', d: 'M20,20L30,30Z' },
  ],
};

const COUNTRIES: HealthMetricsWorldMapCountry[] = [
  { code: 'US', name: 'United States', value: 900, valueLabel: '900 · 90%' },
  { code: null, name: 'Atlantis', value: 100, valueLabel: '100 · 10%' },
];

describe('HealthMetricsWorldMapComponent', () => {
  let fixture: ComponentFixture<HealthMetricsWorldMapComponent>;

  async function render(geometry: Observable<HealthMetricsWorldGeometry | null> = of(GEOMETRY), platform = 'browser'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsWorldMapComponent],
      providers: [
        { provide: WorldGeometryService, useValue: { getGeometry: vi.fn(() => geometry) } },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HealthMetricsWorldMapComponent);
    fixture.componentRef.setInput('countries', COUNTRIES);
    fixture.componentRef.setInput('label', 'Registrations');
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

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('draws every outline as an image named for what it counts, with white borders', async () => {
    await render();
    const svg = query('health-metrics-world-map-svg');
    const us = query('health-metrics-world-map-country-US');

    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('Registrations by country');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 960 470');
    expect(us?.getAttribute('fill')).toBe('#0061A3');
    expect(us?.getAttribute('stroke')).toBe('white');
    expect(us?.getAttribute('stroke-width')).toBe('0.6');
    expect(us?.getAttribute('class')).toContain('hover:opacity-80');
    expect(query('health-metrics-world-map-country-NO')?.getAttribute('fill')).toBe('#E2E8F0');
  });

  it('opens the chart popup on a country and closes it on leave or Escape', async () => {
    await render();
    const us = query('health-metrics-world-map-country-US') as Element;

    us.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(text('health-metrics-world-map-tip')).toContain('United States');
    expect(text('health-metrics-world-map-tip')).toContain('Registrations: 900 · 90%');

    us.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    expect(query('health-metrics-world-map-tip')).toBeNull();

    (query('health-metrics-world-map-country-NO') as Element).dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(text('health-metrics-world-map-tip')).toContain('Registrations: None');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(query('health-metrics-world-map-tip')).toBeNull();
  });

  it('labels the legend from fewer to more, with the no-value swatch last', async () => {
    await render();

    const parts = [...(query('health-metrics-world-map-legend')?.children ?? [])].map((child) => child.textContent?.trim()).filter(Boolean);
    expect(parts).toEqual(['Fewer', 'More registrations', 'No registrations']);
    expect(query('health-metrics-world-map-legend')?.querySelectorAll('.w-\\[20px\\]').length).toBe(7);
  });

  it('lists every country with a value for screen readers, the undrawn ones included', async () => {
    await render();
    const rows = [...(query('health-metrics-world-map-table')?.querySelectorAll('tbody tr') ?? [])].map((row) =>
      [...row.children].map((cell) => cell.textContent?.trim())
    );

    expect(query('health-metrics-world-map-table')?.className).toContain('sr-only');
    expect(rows).toEqual([
      ['United States', '900 · 90%'],
      ['Atlantis', '100 · 10%'],
    ]);
  });

  it('holds the map shape while the outlines load', async () => {
    await render(NEVER);

    expect(query('health-metrics-world-map-loading')).not.toBeNull();
    expect(query('health-metrics-world-map-svg')).toBeNull();
  });

  it('gives way when the outlines fail, keeping the screen-reader table', async () => {
    await render(of(null));

    expect(query('health-metrics-world-map')).toBeNull();
    expect(query('health-metrics-world-map-table')).not.toBeNull();
  });

  it('loads nothing on the server, where it only holds the shape', async () => {
    await render(of(GEOMETRY), 'server');

    expect(TestBed.inject(WorldGeometryService).getGeometry).not.toHaveBeenCalled();
    expect(query('health-metrics-world-map-loading')).not.toBeNull();
  });
});
