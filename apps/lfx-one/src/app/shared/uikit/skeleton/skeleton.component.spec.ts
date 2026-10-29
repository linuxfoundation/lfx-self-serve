// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiSkeletonComponent } from './skeleton.component';

describe('UiSkeletonComponent', () => {
  let fixture: ComponentFixture<UiSkeletonComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiSkeletonComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiSkeletonComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('is hidden from assistive tech', () => {
    expect(host.getAttribute('aria-hidden')).toBe('true');
  });

  it('is a 20px line with a 6px radius and a neutral shimmer by default', () => {
    expect(host.style.height).toBe('20px');
    expect(host.className).toContain('rounded-ui-xs');
    expect(host.className).toContain('from-ui-neutral-50');
    expect(host.className).toContain('via-ui-neutral-100');
    expect(host.className).toContain('skeleton-shimmer');
  });

  it('fills the container until given a width', async () => {
    expect(host.style.width).toBe('');

    fixture.componentRef.setInput('width', '46%');
    await fixture.whenStable();

    expect(host.style.width).toBe('46%');
  });

  it('takes a custom height', async () => {
    fixture.componentRef.setInput('height', '96px');
    await fixture.whenStable();

    expect(host.style.height).toBe('96px');
  });

  it.each([
    ['pill', 'rounded-ui-full'],
    ['circle', 'rounded-ui-full'],
  ] as const)('rounds the %s shape fully', async (shape, radius) => {
    fixture.componentRef.setInput('shape', shape);
    await fixture.whenStable();

    expect(host.className).toContain(radius);
    expect(host.className).not.toContain('rounded-ui-xs');
  });
});
