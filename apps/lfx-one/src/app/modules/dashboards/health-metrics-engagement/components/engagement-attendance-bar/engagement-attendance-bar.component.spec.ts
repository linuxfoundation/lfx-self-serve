// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { EngagementAttendanceBarComponent } from './engagement-attendance-bar.component';

describe('EngagementAttendanceBarComponent', () => {
  async function render(
    attendancePct: number | null,
    meetingsHeld: number | null,
    countMax: number | null = null
  ): Promise<ComponentFixture<EngagementAttendanceBarComponent>> {
    await TestBed.configureTestingModule({ imports: [EngagementAttendanceBarComponent] }).compileComponents();

    const fixture = TestBed.createComponent(EngagementAttendanceBarComponent);
    fixture.componentRef.setInput('attendancePct', attendancePct);
    fixture.componentRef.setInput('meetingsHeld', meetingsHeld);
    fixture.componentRef.setInput('countMax', countMax);
    fixture.detectChanges();
    return fixture;
  }

  function label(fixture: ComponentFixture<EngagementAttendanceBarComponent>): string {
    return fixture.nativeElement.querySelector('[data-testid="engagement-attendance-bar-label"]').textContent.trim();
  }

  function fill(fixture: ComponentFixture<EngagementAttendanceBarComponent>): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="engagement-attendance-bar-track"] > div');
  }

  function el(fixture: ComponentFixture<EngagementAttendanceBarComponent>, testId: string): HTMLElement {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  it('renders a percentage and a blue fill once the period has enough meetings', async () => {
    const fixture = await render(0.62, 8);

    expect(label(fixture)).toBe('62%');
    expect(fill(fixture).className).toContain('bg-blue-500');
    expect(fill(fixture).style.width).toBe('62%');
  });

  it('colours the one threshold that matters amber', async () => {
    const fixture = await render(0.49, 8);

    expect(fill(fixture).className).toContain('bg-amber-500');
  });

  it('draws no fill for a period with no invited population — an em dash, never 0%', async () => {
    const fixture = await render(null, 8);

    expect(label(fixture)).toBe('—');
    expect(fill(fixture).style.width).toBe('0%');
  });

  // A bar drawn under the confidence threshold would read as a real measurement.
  it('draws no fill when too few meetings were held to state a rate', async () => {
    const fixture = await render(0.8, 2);

    expect(label(fixture)).toBe('No data');
    expect(fill(fixture).style.width).toBe('0%');
  });

  // The design's `.att`: a fixed track rather than a fluid one, so every row's bar starts at the same x.
  it('draws a fixed 62x6px grey track, right-aligned with a 9px gap, and a bold 34px-min label', async () => {
    const fixture = await render(0.62, 8);

    expect(el(fixture, 'engagement-attendance-bar').className).toContain('justify-end');
    expect(el(fixture, 'engagement-attendance-bar').className).toContain('gap-[9px]');
    expect(el(fixture, 'engagement-attendance-bar-track').className).toContain('w-[62px]');
    expect(el(fixture, 'engagement-attendance-bar-track').className).toContain('h-[6px]');
    expect(el(fixture, 'engagement-attendance-bar-track').className).toContain('bg-gray-100');
    const labelClass = el(fixture, 'engagement-attendance-bar-label').className;
    expect(labelClass).toContain('font-semibold');
    expect(labelClass).toContain('text-gray-900');
    expect(labelClass).toContain('min-w-[34px]');
  });

  describe('count mode', () => {
    it('draws the count against the max in blue with the count as its label', async () => {
      const fixture = await render(null, 6, 24);

      expect(label(fixture)).toBe('6');
      expect(fill(fixture).style.width).toBe('25%');
      expect(fill(fixture).className).toContain('bg-blue-500');
    });

    // A meeting count has no confidence floor, unlike the rate the attendance mode states.
    it('fills the bar for a count below the attendance floor', async () => {
      const fixture = await render(null, 2, 2);

      expect(label(fixture)).toBe('2');
      expect(fill(fixture).style.width).toBe('100%');
    });

    it('draws no fill when every count in the table is zero', async () => {
      const fixture = await render(null, 0, 0);

      expect(label(fixture)).toBe('0');
      expect(fill(fixture).style.width).toBe('0%');
    });

    it('renders an unmeasured count as an em dash with no fill', async () => {
      const fixture = await render(null, null, 10);

      expect(label(fixture)).toBe('—');
      expect(fill(fixture).style.width).toBe('0%');
    });
  });
});
