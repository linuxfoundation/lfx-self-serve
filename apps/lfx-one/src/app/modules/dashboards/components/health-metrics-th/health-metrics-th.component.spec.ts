// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { HealthMetricsThComponent } from './health-metrics-th.component';

describe('HealthMetricsThComponent', () => {
  let fixture: ComponentFixture<HealthMetricsThComponent>;

  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HealthMetricsThComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsThComponent);
    fixture.componentRef.setInput('label', 'Attendance');
    await fixture.whenStable();
  });

  it('shows only the label on a column that does not sort', () => {
    expect(fixture.nativeElement.textContent.trim()).toBe('Attendance');
    expect(query('health-metrics-th-sort')).toBeNull();
    expect(query('health-metrics-th-tip')).toBeNull();
  });

  it('shows the two-way arrow until sorted, then the sorted direction', async () => {
    fixture.componentRef.setInput('sort', 'none');
    await fixture.whenStable();
    expect(query('health-metrics-th-sort')?.className).toContain('fa-arrow-up-arrow-down');
    expect(query('health-metrics-th-sort')?.className).toContain('text-[10px]');

    fixture.componentRef.setInput('sort', 'desc');
    await fixture.whenStable();
    expect(query('health-metrics-th-sort')?.classList).toContain('fa-solid');
    expect(query('health-metrics-th-sort')?.classList).toContain('fa-arrow-down');
  });

  it('adds a focusable question-mark tip named by its text', async () => {
    fixture.componentRef.setInput('tip', 'Share of invited seats filled.');
    await fixture.whenStable();

    const tip = query('health-metrics-th-tip') as HTMLElement;
    expect(tip.getAttribute('tabindex')).toBe('0');
    expect(tip.getAttribute('aria-label')).toBe('Share of invited seats filled.');
    expect(tip.querySelector('i')?.className).toContain('fa-circle-question');
  });
});
