// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    expect(query('health-metrics-th-sort-button')).toBeNull();
    expect(query('health-metrics-th-tip')).toBeNull();
  });

  it('hides the two-way arrow, with no room kept for it, until the header is hovered or focused', async () => {
    fixture.componentRef.setInput('sort', 'none');
    await fixture.whenStable();

    const arrow = query('health-metrics-th-sort') as HTMLElement;
    expect(arrow.classList).toContain('fa-arrow-up-arrow-down');
    for (const cls of ['text-[10px]', 'w-0', 'ml-0', 'opacity-0', 'group-hover/hmth:w-[10px]', 'group-focus-within/hmth:opacity-100', 'duration-200'])
      expect(arrow.classList).toContain(cls);
    expect(fixture.nativeElement.classList).toContain('group/hmth');
  });

  it('always shows the sorted direction 6px after the label', async () => {
    fixture.componentRef.setInput('sort', 'desc');
    await fixture.whenStable();

    const arrow = query('health-metrics-th-sort') as HTMLElement;
    expect(arrow.classList).toContain('fa-solid');
    expect(arrow.classList).toContain('fa-arrow-down');
    for (const cls of ['ml-[6px]', 'w-[10px]', 'opacity-100']) expect(arrow.classList).toContain(cls);
    expect(arrow.classList).not.toContain('w-0');
  });

  it('asks to sort from the label button or the arrow, and puts the arrow after the tip', async () => {
    fixture.componentRef.setInput('sort', 'none');
    fixture.componentRef.setInput('tip', 'Share of invited seats filled.');
    await fixture.whenStable();
    const sorted = vi.fn();
    fixture.componentInstance.sorted.subscribe(sorted);

    const button = query('health-metrics-th-sort-button') as HTMLButtonElement;
    expect(button.getAttribute('type')).toBe('button');
    expect(button.textContent?.trim()).toBe('Attendance');
    button.click();
    query('health-metrics-th-sort')?.click();
    expect(sorted).toHaveBeenCalledTimes(2);

    const order = [...fixture.nativeElement.children].map((child: Element) => child.getAttribute('data-testid'));
    expect(order).toEqual(['health-metrics-th-sort-button', 'health-metrics-th-tip', 'health-metrics-th-sort']);
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
