// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiSpinnerComponent } from './spinner.component';

describe('UiSpinnerComponent', () => {
  let fixture: ComponentFixture<UiSpinnerComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiSpinnerComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiSpinnerComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('is a status region named Loading', () => {
    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-label')).toBe('Loading');
  });

  it('draws twelve decorative bars', () => {
    const bars = host.querySelectorAll('i');
    expect(bars.length).toBe(12);
    bars.forEach((bar) => expect(bar.getAttribute('aria-hidden')).toBe('true'));
  });

  it('rotates each bar 30 degrees further and delays it 0.1s later', () => {
    const bars = host.querySelectorAll('i');
    expect(bars[0].style.transform).toBe('rotate(0deg)');
    expect(bars[11].style.transform).toBe('rotate(330deg)');
    expect(bars[0].style.animationDelay).toBe('-1.1s');
    expect(bars[11].style.animationDelay).toBe('0s');
  });

  it('is 20px by default and takes any size', async () => {
    expect(host.style.width).toBe('20px');
    expect(host.style.height).toBe('20px');
    expect(host.style.getPropertyValue('--size')).toBe('20px');

    fixture.componentRef.setInput('size', 32);
    await fixture.whenStable();

    expect(host.style.width).toBe('32px');
    expect(host.style.getPropertyValue('--size')).toBe('32px');
  });

  it('is neutral by default and follows the parent colour for the current tone', async () => {
    expect(host.className).toContain('text-ui-neutral-600');

    fixture.componentRef.setInput('tone', 'current');
    await fixture.whenStable();

    expect(host.className).toContain('text-current');
    expect(host.className).not.toContain('text-ui-neutral-600');
  });

  it('uses a custom accessible label', async () => {
    fixture.componentRef.setInput('label', 'Fetching members');
    await fixture.whenStable();

    expect(host.getAttribute('aria-label')).toBe('Fetching members');
  });
});
