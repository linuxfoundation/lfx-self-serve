// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { EngagementAttendanceBarComponent } from './engagement-attendance-bar.component';

describe('EngagementAttendanceBarComponent', () => {
  async function render(attendancePct: number | null, meetingsHeld: number): Promise<ComponentFixture<EngagementAttendanceBarComponent>> {
    await TestBed.configureTestingModule({ imports: [EngagementAttendanceBarComponent] }).compileComponents();

    const fixture = TestBed.createComponent(EngagementAttendanceBarComponent);
    fixture.componentRef.setInput('attendancePct', attendancePct);
    fixture.componentRef.setInput('meetingsHeld', meetingsHeld);
    fixture.detectChanges();
    return fixture;
  }

  function label(fixture: ComponentFixture<EngagementAttendanceBarComponent>): string {
    return fixture.nativeElement.querySelector('[data-testid="engagement-attendance-bar-label"]').textContent.trim();
  }

  function fill(fixture: ComponentFixture<EngagementAttendanceBarComponent>): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="engagement-attendance-bar"] div > div');
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
});
