// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
});
