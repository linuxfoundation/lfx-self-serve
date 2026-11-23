// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { buildHealthMetricsBarChart } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';

import { HealthMetricsBarChartComponent } from './health-metrics-bar-chart.component';

import type { HealthMetricsBarChartInputBar } from '@lfx-one/shared/interfaces';

function bar(key: string, value: number, lineValue: number | null, selected: boolean): HealthMetricsBarChartInputBar {
  return {
    key,
    label: key,
    value,
    valueLabel: `${value}%`,
    labelTone: selected ? 'strong' : 'muted',
    color: '#FB2C36',
    opacity: selected ? 1 : 0.3,
    lineValue,
    tip: {
      title: key,
      rows: [
        { label: 'Revenue churn', value: `${value}%`, color: '#FB2C36', separated: false },
        { label: 'Logo churn', value: lineValue === null ? '—' : `${lineValue}%`, color: '#009AFF', separated: false },
      ],
    },
  };
}

const CHART = buildHealthMetricsBarChart({
  bars: [bar('2025', 8, 4, false), bar('2026', 16, 12, true)],
  heightPx: 180,
  barWidthPx: 40,
  max: 16,
  ticks: ['16%', '12%', '8%', '4%', '0%'],
  line: { color: '#009AFF', max: 16, ticks: [] },
  legend: [
    { key: 'revenue', label: 'Revenue churn', color: '#FB2C36', kind: 'bar' },
    { key: 'logo', label: 'Logo churn', color: '#009AFF', kind: 'line' },
  ],
  ariaLabel: 'Revenue and logo churn over 2 years, oldest first',
});

describe('HealthMetricsBarChartComponent', () => {
  let fixture: ComponentFixture<HealthMetricsBarChartComponent>;

  async function render(chart = CHART): Promise<void> {
    await TestBed.configureTestingModule({ imports: [HealthMetricsBarChartComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsBarChartComponent);
    fixture.componentRef.setInput('chart', chart);
    fixture.componentRef.setInput('testId', 'chart');
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  it('draws each bar to its height with its value above, the earlier year pale', async () => {
    await render();

    expect(query('chart-fill-2025')?.style.height).toBe('50%');
    expect(query('chart-fill-2025')?.style.opacity).toBe('0.3');
    expect(query('chart-fill-2026')?.style.opacity).toBe('1');
    expect(query('chart-value-2026')?.textContent?.trim()).toBe('16%');
    expect(query('chart-value-2026')?.className).toContain('text-gray-900');
    expect(query('chart-value-2025')?.className).toContain('text-gray-500');
  });

  it('draws the dashed line with a dot per point, and no right axis when the line shares the bars', async () => {
    await render();

    expect(query('chart-line')?.querySelector('path')?.getAttribute('d')).toBe('M25 75 L75 25');
    expect(query('chart-line')?.querySelector('path')?.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(query('chart-dot-2026')?.style.top).toBe('25%');
    expect(query('chart-right')).toBeNull();
  });

  it('labels the axes and the legend, the line with a dashed swatch', async () => {
    await render();

    expect([...(query('chart-y')?.children ?? [])].map((tick) => tick.textContent?.trim())).toEqual(['16%', '12%', '8%', '4%', '0%']);
    expect([...(query('chart-x')?.children ?? [])].map((label) => label.textContent?.trim())).toEqual(['2025', '2026']);
    expect([...(query('chart-legend')?.children ?? [])].map((item) => item.textContent?.trim())).toEqual(['Revenue churn', 'Logo churn']);
    expect(query('chart-legend-logo')?.querySelector('[data-testid="chart-legend-dashed"]')).not.toBeNull();
  });

  it('opens the popup on hover or focus, names each bar for screen readers, and closes on Escape', async () => {
    await render();
    const item = query('chart-bar-2026') as HTMLElement;

    expect(item.getAttribute('aria-label')).toBe('2026, Revenue churn 16%, Logo churn 12%');
    item.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    expect(query('chart-tip')?.textContent).toContain('Logo churn');
    // The open bar stays under the line, so its fill never hides the logo point the popup describes.
    expect(item.className).not.toContain('z-');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(query('chart-tip')).toBeNull();
    expect(fixture.componentInstance['tip']['anchor']).toBeNull();

    item.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(query('chart-tip')).not.toBeNull();
    item.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(query('chart-tip')).toBeNull();
  });
});
