// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

import { DocsLayoutComponent } from './docs-layout.component';

describe('DocsLayoutComponent', () => {
  describe('openCookieSettings', () => {
    it('should prevent the link navigation and open the Transcend consent manager', () => {
      const showPreferences = vi.fn();
      const event = { preventDefault: vi.fn() } as unknown as Event;
      const layout = { transcendService: { showPreferences } } as unknown as DocsLayoutComponent;

      DocsLayoutComponent.prototype.openCookieSettings.call(layout, event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(showPreferences).toHaveBeenCalledTimes(1);
    });
  });
});
