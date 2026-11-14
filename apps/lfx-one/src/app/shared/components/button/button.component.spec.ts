// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { ButtonComponent } from './button.component';

describe('ButtonComponent description idrefs', () => {
  it.each(['browser', 'server'])('declaratively forwards, updates and removes descriptions on the native button on %s', async (platform) => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('label', 'Synthetic action');
    fixture.componentRef.setInput('ariaDescribedBy', 'reason-one');
    fixture.componentRef.setInput('ariaPressed', false);
    fixture.componentRef.setInput('ariaControls', 'synthetic-form');
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    expect(button?.getAttribute('aria-describedby')).toBe('reason-one');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    fixture.componentRef.setInput('ariaDescribedBy', 'reason-two');
    await fixture.whenStable();
    expect(button?.getAttribute('aria-describedby')).toBe('reason-two');
    fixture.componentRef.setInput('ariaDescribedBy', undefined);
    await fixture.whenStable();
    expect(button?.hasAttribute('aria-describedby')).toBe(false);
    expect(button?.getAttribute('aria-controls')).toBe('synthetic-form');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
  });
  it.each(['href', 'routerLink'])('forwards descriptions to its native %s anchor', async (kind) => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput(kind, '/synthetic');
    fixture.componentRef.setInput('label', 'Synthetic link');
    fixture.componentRef.setInput('ariaDescribedBy', 'link-reason');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('a')?.getAttribute('aria-describedby')).toBe('link-reason');
  });
});

describe('ButtonComponent controlled region', () => {
  it('forwards disclosure state and controls to the native button, not just the wrapper host', async () => {
    TestBed.configureTestingModule({ imports: [ButtonComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('ariaControls', 'synthetic-intake-form');
    fixture.componentRef.setInput('ariaExpanded', false);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    expect(button?.getAttribute('aria-controls')).toBe('synthetic-intake-form');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    fixture.componentRef.setInput('ariaExpanded', true);
    await fixture.whenStable();
    expect(button?.getAttribute('aria-expanded')).toBe('true');
  });
});
