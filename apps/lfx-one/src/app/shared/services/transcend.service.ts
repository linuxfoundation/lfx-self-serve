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
   * cookie notice, privacy/terms line and "Cookie settings" link — but only where hiding it cannot let
   * tracking run unannounced. airgap.js keeps regulating scripts; only the prompt UI is hidden.
   *
   * The class is set on the server too, so the prompt never flashes; in the browser it is lifted again
   * at once when any tracking purpose is on by default (`'Auto'`) or consented without a confirmed
   * choice — a notice/opt-out regime, where the prompt is the notice that tracking is running. It stays
   * hidden only when nothing tracks until the visitor agrees (opt-in regime, every purpose `false`) or
   * the visitor already made a choice (the prompt would not show anyway). Pair with
   * {@link restorePrompt} when the page is destroyed.
   */
  public suppressPrompt(): void {
    this.renderer.addClass(this.document.documentElement, CONSENT_PROMPT_HIDDEN_CLASS);
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    if (this.trackingRunsWithoutChoice()) {
      this.restorePrompt();
      return;
    }
    window.airgap?.addEventListener?.('consent-resolution', this.onConsentResolution);
  }

  /** Lets the automatic consent prompt show again (see {@link suppressPrompt}). */
  public restorePrompt(): void {
    this.renderer.removeClass(this.document.documentElement, CONSENT_PROMPT_HIDDEN_CLASS);
    if (isPlatformBrowser(this.platformId)) {
      window.airgap?.removeEventListener?.('consent-resolution', this.onConsentResolution);
    }
  }

  /** Re-checks a suppressed prompt once airgap.js has resolved the page's consent (its regime may resolve late). */
  private readonly onConsentResolution = (): void => {
    if (this.trackingRunsWithoutChoice()) this.restorePrompt();
  };

  /**
   * True when some tracking purpose is on although the visitor has not confirmed a choice. Without
   * airgap.js (blocked or failed) there is no prompt to hide, so this is false.
   */
  private trackingRunsWithoutChoice(): boolean {
    const consent = window.airgap?.getConsent?.();
    if (!consent || consent.confirmed) {
      return false;
    }
    return Object.values(consent.purposes ?? {}).some((value) => value === true || value === 'Auto');
  }
}
