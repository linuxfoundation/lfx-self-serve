// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiBadgeComponent } from './badge.component';

describe('UiBadgeComponent', () => {
  let fixture: ComponentFixture<UiBadgeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiBadgeComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiBadgeComponent);
    fixture.componentRef.setInput('value', 3);
    await fixture.whenStable();
  });

  it('shows the value', () => {
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('3');
  });

  it('is 18px tall with a 6px inline padding', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.className).toContain('h-[18px]');
    expect(host.className).toContain('px-[6px]');
    expect(host.className).toContain('text-[11px]');
  });

  it('is neutral by default and blue for the accent tone', async () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.className).toContain('bg-gray-100');

    fixture.componentRef.setInput('tone', 'accent');
    await fixture.whenStable();

    expect(host.className).toContain('bg-blue-100');
    expect(host.className).not.toContain('bg-gray-100');
  });
});
