// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';

/**
 * Opens the Transcend consent manager. The Transcend `airgap.js` script is loaded by `index.html`,
 * so this service only forwards the call. Browser-only — every method no-ops on SSR.
 */
@Injectable({
  providedIn: 'root',
})
export class TranscendService {
  private readonly platformId = inject(PLATFORM_ID);

  // Opens the cookie-preferences consent manager. Warns when airgap.js did not load (blocked or
  // failed), so a "Cookie settings" click that cannot open anything is visible in the console.
  public showPreferences(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const transcend = window.transcend;
    if (!transcend?.showConsentManager) {
      console.warn('Transcend: consent manager is not available (airgap.js did not load)');
      return;
    }

    transcend.showConsentManager();
  }
}
