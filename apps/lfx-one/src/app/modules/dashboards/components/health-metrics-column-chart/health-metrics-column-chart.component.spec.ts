// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { buildHealthMetricsColumnChart } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';

import { HealthMetricsColumnChartComponent } from './health-metrics-column-chart.component';

const CHART = buildHealthMetricsColumnChart({
  series: [
    { key: 'in-person', label: 'In-person', color: '#009AFF' },
    { key: 'virtual', label: 'Virtual', color: '#8E51FF' },
  ],
  columns: [
    { key: '2025', label: '2025', sub: '', values: [14010, 600], total: 14610, muted: true, tipTitle: '2025' },
    { key: '2026', label: '2026', sub: 'partial', values: [10797, 0], total: 10797, muted: false, tipTitle: '2026 · partial year' },
  ],
  peak: 15779,
  heightPx: 260,
  barWidthPx: 40,
  formatTotal: (value) => `${Math.round(value / 100) / 10}K`,
  formatValue: (value) => value.toLocaleString('en-US'),
  ariaLabel: 'Registrations by year, in person and virtual',
});

describe('HealthMetricsColumnChartComponent', () => {
  let fixture: ComponentFixture<HealthMetricsColumnChartComponent>;

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({ imports: [HealthMetricsColumnChartComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsColumnChartComponent);
    fixture.componentRef.setInput('chart', CHART);
    fixture.componentRef.setInput('testId', 'chart');
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  it('draws each column as stacked segments with its total above, the earlier year muted', async () => {
    await render();

    expect(query('chart-segment-2025-in-person')?.style.backgroundColor).toBe('rgb(0, 154, 255)');
    expect(query('chart-total-2025')?.textContent?.trim()).toBe('14.6K');
    expect((query('chart-segment-2025-in-person')?.parentElement as HTMLElement).style.opacity).toBe('0.35');
    expect((query('chart-segment-2026-in-person')?.parentElement as HTMLElement).style.opacity).toBe('1');
  });

  it('rounds the top corners of each stack on its highest segment', async () => {
    await render();

    expect(query('chart-segment-2025-virtual')?.className).toContain('rounded-t-[4px]');
    expect(query('chart-segment-2025-in-person')?.className).not.toContain('rounded-t-[4px]');
    // 2026 has no virtual registrations, so its in-person segment is the top of the stack.
    expect(query('chart-segment-2026-in-person')?.className).toContain('rounded-t-[4px]');
  });

  it('places an open popup again when the window resizes', async () => {
    await render();
    const column = query('chart-column-2025') as HTMLElement;
    column.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    const placements: unknown[] = [];
    placements.push(fixture.componentInstance['tipPlacement']());
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();
    placements.push(fixture.componentInstance['tipPlacement']());

    expect(query('chart-tip')).not.toBeNull();
    expect(placements[1]).toEqual(placements[0]);
    expect(placements[1]).not.toBeNull();
  });

  it('labels the y axis, the years with their sub-line, and the legend', async () => {
    await render();

    expect([...(query('chart-y')?.children ?? [])].map((tick) => tick.textContent?.trim())).toEqual(['16K', '12K', '8K', '4K', '0']);
    expect([...(query('chart-x')?.querySelectorAll('span') ?? [])].map((label) => label.textContent?.trim())).toEqual(['2025', '2026', 'partial']);
    expect([...(query('chart-legend')?.children ?? [])].map((item) => item.textContent?.trim())).toEqual(['In-person', 'Virtual']);
  });

  it('opens the popup on hover or focus, names each column for screen readers, and closes on Escape', async () => {
    await render();
    const column = query('chart-column-2026') as HTMLElement;

    expect(column.getAttribute('aria-label')).toBe('2026 · partial year, In-person 10,797, Virtual 0, Total 10,797');
    column.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    expect(query('chart-tip')?.textContent).toContain('2026 · partial year');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(query('chart-tip')).toBeNull();

    column.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(query('chart-tip')).not.toBeNull();
    column.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(query('chart-tip')).toBeNull();
  });
});
