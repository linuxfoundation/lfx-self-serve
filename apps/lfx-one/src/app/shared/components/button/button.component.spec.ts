// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { ButtonComponent } from './button.component';

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
