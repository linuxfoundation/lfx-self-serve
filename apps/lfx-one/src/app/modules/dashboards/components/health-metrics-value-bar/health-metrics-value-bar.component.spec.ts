// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { HealthMetricsValueBarComponent } from './health-metrics-value-bar.component';

describe('HealthMetricsValueBarComponent', () => {
  let fixture: ComponentFixture<HealthMetricsValueBarComponent>;

  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const render = async (inputs: Record<string, unknown>): Promise<void> => {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HealthMetricsValueBarComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsValueBarComponent);
  });

  it('shows the value first, then a 62px bar at its share', async () => {
    await render({ value: '64%', pct: 64 });

    expect(query('health-metrics-value-bar-value')?.textContent?.trim()).toBe('64%');
    expect(query('health-metrics-value-bar-value')?.className).toContain('min-w-[40px]');
    expect(query('health-metrics-value-bar-fill')?.style.width).toBe('64%');
    expect(query('health-metrics-value-bar-fill')?.className).toContain('bg-blue-500');
  });

  it.each([
    [0, 'bg-gray-300'],
    [12, 'bg-red-500'],
    [35, 'bg-amber-500'],
  ])('fills a %s%% share with %s', async (pct, fill) => {
    await render({ value: `${pct}%`, pct });

    expect(query('health-metrics-value-bar-fill')?.className).toContain(fill);
  });

  it('takes a single fill from the widget', async () => {
    await render({ value: '12%', pct: 12, fillClass: 'bg-violet-500' });

    expect(query('health-metrics-value-bar-fill')?.className).toContain('bg-violet-500');
  });

  it('shows a grey dash and no bar without data', async () => {
    await render({ value: '', pct: null });

    expect(query('health-metrics-value-bar-value')?.textContent?.trim()).toBe('—');
    expect(query('health-metrics-value-bar-value')?.className).toContain('text-gray-400');
    expect(query('health-metrics-value-bar-fill')).toBeNull();
  });
});
