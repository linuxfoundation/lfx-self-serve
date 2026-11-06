// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, Renderer2, RendererFactory2 } from '@angular/core';
import { CONSENT_PROMPT_HIDDEN_CLASS } from '@lfx-one/shared/constants';

/**
 * Opens the Transcend consent manager. The Transcend `airgap.js` script is loaded by `index.html`,
 * so this service only forwards the call. `showPreferences()` is browser-only; the prompt toggles
 * also run on the server so a suppressed prompt never flashes on first paint.
 */
@Injectable({
  providedIn: 'root',
})
export class TranscendService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly renderer: Renderer2 = inject(RendererFactory2).createRenderer(null, null);

  // Opens the cookie-preferences consent manager. Warns when airgap.js did not load (blocked or
  // failed), so a "Cookie settings" click that cannot open anything is visible in the console.
  public showPreferences(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // An explicit request always wins over a page's suppressed prompt.
    this.restorePrompt();

    const transcend = window.transcend;
    if (!transcend?.showConsentManager) {
      console.warn('Transcend: consent manager is not available (airgap.js did not load)');
      return;
    }

    transcend.showConsentManager();
  }

  /**
   * Hides the automatic consent prompt (`#transcend-consent-manager`) for a page that shows its own
   * privacy/terms consent line and a "Cookie settings" link. airgap.js keeps regulating scripts; only
   * the prompt UI is hidden. Pair with {@link restorePrompt} when the page is destroyed.
   */
  public suppressPrompt(): void {
    this.renderer.addClass(this.document.documentElement, CONSENT_PROMPT_HIDDEN_CLASS);
  }

  /** Lets the automatic consent prompt show again (see {@link suppressPrompt}). */
  public restorePrompt(): void {
    this.renderer.removeClass(this.document.documentElement, CONSENT_PROMPT_HIDDEN_CLASS);
  }
}
