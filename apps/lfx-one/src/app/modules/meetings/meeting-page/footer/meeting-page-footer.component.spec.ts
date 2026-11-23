// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { TranscendService } from '@services/transcend.service';
import { describe, expect, it, vi } from 'vitest';

import { MeetingPageFooterComponent } from './meeting-page-footer.component';

describe('MeetingPageFooterComponent', () => {
  const render = (preferencesAvailable: boolean, showPreferences = vi.fn()): HTMLElement => {
    TestBed.configureTestingModule({
      imports: [MeetingPageFooterComponent],
      providers: [{ provide: TranscendService, useValue: { preferencesAvailable, showPreferences } }],
    });
    const fixture = TestBed.createComponent(MeetingPageFooterComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('links the legal pages and opens the cookie preferences', () => {
    const showPreferences = vi.fn();
    const el = render(true, showPreferences);

    expect(Array.from(el.querySelectorAll('a')).map((a) => a.textContent?.trim())).toEqual(['Platform Usage', 'Privacy Policy', 'Trademark Usage', 'Policies']);
    const cookies = el.querySelector('[data-testid="meeting-page-footer-cookies"]') as HTMLButtonElement;
    expect(cookies.classList.contains('hidden')).toBe(false);
    cookies.click();
    expect(showPreferences).toHaveBeenCalledTimes(1);
  });

  it('hides the cookie preferences where they cannot open', () => {
    const el = render(false);

    expect(el.querySelector('[data-testid="meeting-page-footer-cookies"]')!.classList.contains('hidden')).toBe(true);
  });
});
