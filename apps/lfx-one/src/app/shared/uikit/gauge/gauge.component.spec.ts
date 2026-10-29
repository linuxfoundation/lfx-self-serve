// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiGaugeComponent } from './gauge.component';

describe('UiGaugeComponent', () => {
  let fixture: ComponentFixture<UiGaugeComponent>;
  let host: HTMLElement;

  const arc = (): SVGElement => host.querySelector('[data-testid="ui-gauge-arc"]') as SVGElement;
  const value = (): HTMLElement | null => host.querySelector('[data-testid="ui-gauge-value"]');
  const set = async (name: string, val: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, val);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiGaugeComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiGaugeComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('label', 'Health score');
    fixture.componentRef.setInput('value', 92);
    await fixture.whenStable();
  });

  it('is a named progressbar with value text', () => {
    expect(host.getAttribute('role')).toBe('progressbar');
    expect(host.getAttribute('aria-label')).toBe('Health score');
    expect(host.getAttribute('aria-valuenow')).toBe('92');
    expect(host.getAttribute('aria-valuemin')).toBe('0');
    expect(host.getAttribute('aria-valuemax')).toBe('100');
    expect(host.getAttribute('aria-valuetext')).toBe('92 percent');
  });

  it('shows the number inside without a percent sign and hides the ring from assistive tech', () => {
    expect(value()?.textContent?.trim()).toBe('92');
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws the arc length as circumference times value', async () => {
    const circumference = 2 * Math.PI * 42;
    expect(Number(arc().getAttribute('stroke-dasharray'))).toBeCloseTo(circumference, 5);
    expect(Number(arc().getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * 0.08, 5);

    await set('value', 0);
    expect(Number(arc().getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference, 5);
  });

  it('clamps the value to 0 to 100', async () => {
    await set('value', 150);
    expect(host.getAttribute('aria-valuenow')).toBe('100');
    expect(value()?.textContent?.trim()).toBe('100');

    await set('value', -3);
    expect(host.getAttribute('aria-valuenow')).toBe('0');
  });

  it('colours the arc by level at the 67 and 34 thresholds', async () => {
    expect(arc().getAttribute('class')).toContain('stroke-ui-success-600');
    await set('value', 67);
    expect(arc().getAttribute('class')).toContain('stroke-ui-success-600');
    await set('value', 66);
    expect(arc().getAttribute('class')).toContain('stroke-ui-warning-500');
    await set('value', 34);
    expect(arc().getAttribute('class')).toContain('stroke-ui-warning-500');
    await set('value', 33);
    expect(arc().getAttribute('class')).toContain('stroke-ui-danger-600');
  });

  it('uses the accent for the accent tone', async () => {
    await set('tone', 'accent');

    expect(arc().getAttribute('class')).toContain('stroke-ui-accent-500');
    expect(arc().getAttribute('class')).not.toContain('stroke-ui-success-600');
  });

  it('is 64px by default and takes every size', async () => {
    expect(host.style.width).toBe('64px');
    expect(host.style.getPropertyValue('--size')).toBe('64px');

    for (const [size, px] of [
      ['tiny', '20px'],
      ['small', '32px'],
      ['large', '128px'],
    ]) {
      await set('size', size);
      expect(host.style.width).toBe(px);
      expect(host.style.height).toBe(px);
    }
  });

  it('only shows the number at default and large sizes', async () => {
    await set('size', 'tiny');
    expect(value()).toBeNull();
    await set('size', 'small');
    expect(value()).toBeNull();
    await set('size', 'large');
    expect(value()).not.toBeNull();
  });

  it('hides the number when showValue is off', async () => {
    await set('showValue', false);

    expect(value()).toBeNull();
  });

  it('spins a partial accent arc and drops the value attributes while indeterminate', async () => {
    await set('indeterminate', true);

    expect(host.hasAttribute('aria-valuenow')).toBe(false);
    expect(host.hasAttribute('aria-valuetext')).toBe(false);
    expect(host.getAttribute('aria-label')).toBe('Health score');
    expect(host.querySelector('svg')?.getAttribute('class')).toContain('gauge-spin');
    expect(arc().getAttribute('class')).toContain('stroke-ui-accent-500');
    expect(value()).toBeNull();
  });
});
