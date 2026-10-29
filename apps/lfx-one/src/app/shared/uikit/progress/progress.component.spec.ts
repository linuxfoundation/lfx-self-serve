// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiProgressComponent } from './progress.component';

describe('UiProgressComponent', () => {
  let fixture: ComponentFixture<UiProgressComponent>;
  let host: HTMLElement;

  const bar = (): HTMLElement => host.querySelector('[data-testid="ui-progress-bar"]') as HTMLElement;
  const fill = (): HTMLElement => host.querySelector('[data-testid="ui-progress-fill"]') as HTMLElement;
  const set = async (name: string, value: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiProgressComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiProgressComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('value', 64);
    fixture.componentRef.setInput('label', 'Seats used');
    await fixture.whenStable();
  });

  it('is a named progressbar with value, min and max', () => {
    expect(bar().getAttribute('role')).toBe('progressbar');
    expect(bar().getAttribute('aria-label')).toBe('Seats used');
    expect(bar().getAttribute('aria-valuenow')).toBe('64');
    expect(bar().getAttribute('aria-valuemin')).toBe('0');
    expect(bar().getAttribute('aria-valuemax')).toBe('100');
  });

  it('shows the label and the percentage as text', () => {
    expect(host.querySelector('[data-testid="ui-progress-label"]')?.textContent).toContain('Seats used');
    expect(host.querySelector('[data-testid="ui-progress-value"]')?.textContent?.trim()).toBe('64%');
    expect(fill().style.width).toBe('64%');
  });

  it('computes the fill from the real maximum', async () => {
    await set('value', 32);
    await set('max', 50);

    expect(fill().style.width).toBe('64%');
    expect(bar().getAttribute('aria-valuemax')).toBe('50');
  });

  it('uses custom value text for the label row and aria-valuetext', async () => {
    await set('valueText', '32 of 50');

    expect(host.querySelector('[data-testid="ui-progress-value"]')?.textContent?.trim()).toBe('32 of 50');
    expect(bar().getAttribute('aria-valuetext')).toBe('32 of 50');
  });

  it('hides the label row but keeps the accessible name', async () => {
    await set('showLabel', false);

    expect(host.querySelector('[data-testid="ui-progress-label"]')).toBeNull();
    expect(bar().getAttribute('aria-label')).toBe('Seats used');
  });

  it('clamps the value to the range', async () => {
    await set('value', 140);
    expect(fill().style.width).toBe('100%');
    expect(bar().getAttribute('aria-valuenow')).toBe('100');

    await set('value', -5);
    expect(fill().style.width).toBe('0%');
  });

  it('treats a non-finite value or an invalid max as 0, including the ARIA range', async () => {
    await set('value', undefined);
    expect(fill().style.width).toBe('0%');
    expect(bar().getAttribute('aria-valuenow')).toBe('0');

    await set('value', 10);
    for (const max of [NaN, Infinity, -10]) {
      await set('max', max);
      expect(fill().style.width).toBe('0%');
      expect(bar().getAttribute('aria-valuenow')).toBe('0');
      expect(bar().getAttribute('aria-valuemin')).toBe('0');
      expect(bar().getAttribute('aria-valuemax')).toBe('0');
    }
  });

  it('shows an empty bar when max is not positive', async () => {
    await set('max', 0);

    expect(fill().style.width).toBe('0%');
  });

  it('is accent by default and takes every tone', async () => {
    expect(fill().className).toContain('bg-ui-accent-500');

    const expected = { success: 'bg-ui-success-600', warning: 'bg-ui-warning-500', error: 'bg-ui-danger-600', secondary: 'bg-ui-neutral-400' };
    for (const [tone, cls] of Object.entries(expected)) {
      await set('tone', tone);
      expect(fill().className).toContain(cls);
      expect(fill().className).not.toContain('bg-ui-accent-500');
    }
  });
});
