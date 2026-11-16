// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { buildHealthMetricsLineChart } from '@lfx-one/shared/utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { HealthMetricsLineChartComponent } from './health-metrics-line-chart.component';

import type { HealthMetricsLineChartView } from '@lfx-one/shared/interfaces';

function chart(): HealthMetricsLineChartView {
  return buildHealthMetricsLineChart({
    xLabels: ['Jan', 'Feb', 'Mar', 'Apr'],
    series: [
      { key: 'open', label: 'Open rate', color: '#009AFF', values: [40, 50, 20, 30], fill: true },
      { key: 'cto', label: 'Click-to-open rate', color: '#00BC7D', values: [10, 12, 5, 8], dashed: true },
    ],
    max: 60,
    formatTick: (value) => `${Math.round(value)}%`,
    tips: ['One', 'Two', 'Three', 'Four'].map((title) => ({
      title,
      rows: [{ label: 'Open rate', value: '40%', color: '#009AFF', separated: false, inline: true }],
    })),
    ariaLabel: 'Open, click and click-to-open rate by newsletter',
  });
}

describe('HealthMetricsLineChartComponent', () => {
  let fixture: ComponentFixture<HealthMetricsLineChartComponent>;

  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HealthMetricsLineChartComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsLineChartComponent);
    fixture.componentRef.setInput('chart', chart());
    fixture.componentRef.setInput('testId', 'chart');
    fixture.detectChanges();
  });

  it('labels the y axis top to bottom and the x axis left to right', () => {
    expect(Array.from(query('chart-y')?.querySelectorAll('span') ?? []).map((span) => span.textContent)).toEqual(['60%', '45%', '30%', '15%', '0%']);
    expect(Array.from(query('chart-x')?.querySelectorAll('span') ?? []).map((span) => span.textContent)).toEqual(['Jan', 'Feb', 'Mar', 'Apr']);
  });

  it('draws each series, dashing the derived one, and fills under the first filled series with a unique gradient', () => {
    expect(query('chart-line-open')?.getAttribute('stroke-dasharray')).toBeNull();
    expect(query('chart-line-cto')?.getAttribute('stroke-dasharray')).toBe('5 4');
    const fill = query('chart-area')?.getAttribute('fill') ?? '';
    const id = fill.slice('url(#'.length, -1);
    expect(fixture.nativeElement.querySelector(`linearGradient[id="${id}"]`)).not.toBeNull();
    // The design leaves the dashed series without dots: four open-rate dots, none for click-to-open.
    expect(fixture.nativeElement.querySelectorAll('span.rounded-full.bg-white')).toHaveLength(4);
  });

  it('names the points for screen readers and hides the drawing', () => {
    expect(fixture.nativeElement.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    expect(query('chart-points')?.getAttribute('aria-label')).toBe('Open, click and click-to-open rate by newsletter');
    expect(query('chart-column-0')?.getAttribute('aria-label')).toBe('One, Open rate 40%');
    expect(query('chart-column-0')?.getAttribute('tabindex')).toBe('0');
  });

  it('opens the popup on hover or focus, right of a left-half column and left of a right-half one, and closes it on leave', () => {
    query('chart-column-0')?.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    expect(query('chart-tip')?.textContent).toContain('One');
    expect(query('chart-tip')?.className).toContain('left-[calc(50%+12px)]');

    query('chart-column-0')?.dispatchEvent(new Event('mouseleave'));
    query('chart-column-3')?.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(query('chart-tip')?.textContent).toContain('Four');
    expect(query('chart-tip')?.className).toContain('right-[calc(50%+12px)]');

    query('chart-column-3')?.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(query('chart-tip')).toBeNull();
  });

  it('closes the popup on Escape', () => {
    query('chart-column-1')?.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(query('chart-tip')).toBeNull();
  });
});
