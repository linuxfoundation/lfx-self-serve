// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable } from '@angular/core';

/**
 * Opens the Transcend consent manager. The Transcend airgap script is loaded by `index.html`,
 * so this service only forwards the call. Browser-only — it is invoked from click handlers.
 */
@Injectable({
  providedIn: 'root',
})
export class TranscendService {
  // Opens the cookie-preferences consent manager. No-op until airgap.js has defined `window.transcend`.
  public showPreferences(): void {
    window.transcend?.showConsentManager?.();
  }
}
