// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { TranscendService } from '@services/transcend.service';
import { describe, expect, it, vi } from 'vitest';

import { MeetingPageFooterComponent } from './meeting-page-footer.component';

describe('MeetingPageFooterComponent', () => {
  const render = (preferencesAvailable: boolean, showPreferences = vi.fn(), width?: 1016 | 1280): HTMLElement => {
    TestBed.configureTestingModule({
      imports: [MeetingPageFooterComponent],
      providers: [{ provide: TranscendService, useValue: { preferencesAvailable, showPreferences } }],
    });
    const fixture = TestBed.createComponent(MeetingPageFooterComponent);
    if (width) {
      fixture.componentRef.setInput('width', width);
    }
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

  it('keeps the meeting page width by default and widens on request', () => {
    expect(render(true).querySelector('footer')!.classList.contains('max-w-[1016px]')).toBe(true);
    TestBed.resetTestingModule();
    expect(render(true, vi.fn(), 1280).querySelector('footer')!.classList.contains('max-w-[1280px]')).toBe(true);
  });

  it('hides the cookie preferences where they cannot open', () => {
    const el = render(false);

    expect(el.querySelector('[data-testid="meeting-page-footer-cookies"]')!.classList.contains('hidden')).toBe(true);
  });
});
