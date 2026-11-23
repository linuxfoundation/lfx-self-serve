// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { HealthMetricsInfoTipComponent } from './health-metrics-info-tip.component';

describe('HealthMetricsInfoTipComponent', () => {
  let fixture: ComponentFixture<HealthMetricsInfoTipComponent>;
  const icon = (): HTMLElement => fixture.nativeElement.querySelector('i') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HealthMetricsInfoTipComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsInfoTipComponent);
    fixture.componentRef.setInput('text', 'How this is counted.');
    await fixture.whenStable();
  });

  it('is a focusable 13px question mark named by its text', () => {
    expect(icon().className).toContain('fa-circle-question');
    expect(icon().className).toContain('text-[13px]');
    expect(icon().getAttribute('role')).toBe('img');
    expect(icon().getAttribute('tabindex')).toBe('0');
    expect(icon().getAttribute('aria-label')).toBe('How this is counted.');
  });

  it('puts the test id on the icon only when given', async () => {
    expect(icon().hasAttribute('data-testid')).toBe(false);

    fixture.componentRef.setInput('testId', 'kpi-tip');
    await fixture.whenStable();

    expect(icon().getAttribute('data-testid')).toBe('kpi-tip');
  });
});
