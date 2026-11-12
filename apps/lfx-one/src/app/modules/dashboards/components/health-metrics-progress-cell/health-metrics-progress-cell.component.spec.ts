// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { HealthMetricsProgressCellComponent } from './health-metrics-progress-cell.component';

describe('HealthMetricsProgressCellComponent', () => {
  let fixture: ComponentFixture<HealthMetricsProgressCellComponent>;

  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const render = async (inputs: Record<string, unknown>): Promise<void> => {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HealthMetricsProgressCellComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsProgressCellComponent);
  });

  it('draws an accent bar 4px under the value, up to 140px wide', async () => {
    await render({ value: '640', pct: 64 });
    const host = fixture.nativeElement as HTMLElement;

    expect(query('health-metrics-progress-value')?.textContent?.trim()).toBe('640');
    expect(query('health-metrics-progress-goal')).toBeNull();
    expect(host.className).toContain('gap-[4px]');
    expect(host.style.maxWidth).toBe('140px');
    expect(query('health-metrics-progress-fill')?.style.width).toBe('64%');
    expect(query('health-metrics-progress-fill')?.className).toContain('bg-blue-500');
  });

  it('puts the goal on the right and the bar 6px under both, at the widget’s width', async () => {
    await render({ value: '640', pct: 64, goal: 'of 1,000', maxWidthPx: 220 });

    expect(query('health-metrics-progress-goal')?.textContent?.trim()).toBe('of 1,000');
    expect(query('health-metrics-progress-goal')?.className).toContain('whitespace-nowrap');
    expect(fixture.nativeElement.className).toContain('gap-[6px]');
    expect((fixture.nativeElement as HTMLElement).style.maxWidth).toBe('220px');
  });

  it('clamps an overshoot to a full bar and draws an empty track without data', async () => {
    await render({ value: '1,200', pct: 120 });
    expect(query('health-metrics-progress-fill')?.style.width).toBe('100%');

    await render({ pct: null });
    expect(query('health-metrics-progress-fill')?.style.width).toBe('0%');
  });
});
