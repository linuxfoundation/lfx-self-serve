// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiLoadingDotsComponent } from './loading-dots.component';

describe('UiLoadingDotsComponent', () => {
  let fixture: ComponentFixture<UiLoadingDotsComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiLoadingDotsComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiLoadingDotsComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('is hidden from assistive tech with no role by default, for use beside visible text', () => {
    expect(host.getAttribute('role')).toBeNull();
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.sr-only')).toBeNull();
  });

  it('becomes a status region whose only announced text is the hidden label when labelled', async () => {
    fixture.componentRef.setInput('label', 'Generating attendance report');
    await fixture.whenStable();

    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-hidden')).toBeNull();
    expect(host.getAttribute('aria-label')).toBeNull();
    expect(host.querySelector('.sr-only')?.textContent?.trim()).toBe('Generating attendance report');
  });

  it('draws three decorative dots, each delayed 0.2s after the last', () => {
    const dots = host.querySelectorAll('i');
    expect(dots.length).toBe(3);
    dots.forEach((dot) => expect(dot.getAttribute('aria-hidden')).toBe('true'));
    expect(Array.from(dots).map((dot) => dot.style.animationDelay)).toEqual(['0s', '0.2s', '0.4s']);
  });

  it('is 5px by default and takes the small and large sizes', async () => {
    const dot = (): HTMLElement => host.querySelector('i') as HTMLElement;
    expect(dot().className).toContain('size-[5px]');
    expect(host.className).toContain('gap-[4px]');

    fixture.componentRef.setInput('size', 'sm');
    await fixture.whenStable();
    expect(dot().className).toContain('size-[4px]');
    expect(host.className).toContain('gap-[3.2px]');

    fixture.componentRef.setInput('size', 'lg');
    await fixture.whenStable();
    expect(dot().className).toContain('size-[7px]');
    expect(host.className).toContain('gap-[5.6px]');
  });

  it('follows the parent text colour', () => {
    expect((host.querySelector('i') as HTMLElement).className).toContain('bg-current');
  });
});
