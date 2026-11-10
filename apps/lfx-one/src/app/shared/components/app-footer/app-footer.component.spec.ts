// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { TranscendService } from '@services/transcend.service';
import { describe, expect, it, vi } from 'vitest';

import { AppFooterComponent } from './app-footer.component';

describe('AppFooterComponent', () => {
  describe('openCookieSettings', () => {
    it('should open the Transcend consent manager', () => {
      const showPreferences = vi.fn();
      const footer = { transcendService: { showPreferences } } as unknown as AppFooterComponent;

      (AppFooterComponent.prototype as unknown as { openCookieSettings(): void }).openCookieSettings.call(footer);

      expect(showPreferences).toHaveBeenCalledTimes(1);
    });
  });

  // The clause hides inside an iframe, where Transcend's consent manager cannot open (lfx-self-serve-ops#1438).
  describe('Cookie settings clause', () => {
    const CLAUSE = '[data-testid="app-footer-cookie-clause"]';
    const render = (preferencesAvailable: boolean): HTMLElement => {
      TestBed.configureTestingModule({
        imports: [AppFooterComponent],
        providers: [{ provide: TranscendService, useValue: { preferencesAvailable, showPreferences: vi.fn() } }],
      });
      const fixture = TestBed.createComponent(AppFooterComponent);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    it('should end the sentence with the Cookie settings link on a top-level page', () => {
      const el = render(true);

      expect(el.querySelector(CLAUSE)!.classList.contains('hidden')).toBe(false);
      // Whitespace-normalized: a stray space inside the inline button would render "Cookie settings ."
      expect(el.querySelector('p')!.textContent!.replace(/\s+/g, ' ').trim()).toMatch(/Policies page, or manage your Cookie settings\.$/);
    });

    it('should hide the clause and still end the sentence with a period where preferences cannot open', () => {
      const el = render(false);
      const visible = el.querySelector('p')!.cloneNode(true) as HTMLElement;
      visible.querySelector(CLAUSE)!.remove();

      expect(el.querySelector(CLAUSE)!.classList.contains('hidden')).toBe(true);
      expect(visible.textContent!.replace(/\s+/g, ' ').trim()).toMatch(/Policies page\.$/);
    });
  });
});
