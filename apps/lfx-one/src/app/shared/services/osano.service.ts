// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable } from '@angular/core';

/**
 * Loads the Osano Consent Management Platform (CMP) and drives the cookie
 * "Manage cookie preferences" link. Mirrors what the shared `<lfx-footer>` web
 * component does, so public pages that do not render that footer still get a
 * working cookie-consent experience. Browser-only — every method no-ops on SSR.
 */
@Injectable({
  providedIn: 'root',
})
export class OsanoService {
  // Public Osano CMP script for the Linux Foundation (same source the <lfx-footer> uses).
  private readonly scriptUrl = 'https://cmp.osano.com/16A0DbT9yDNIaQkvZ/d6ac078e-c71f-4b96-8c97-818cc1cc6632/osano.js';

  private isLoaded = false;

  // Injects the Osano consent script once. Safe to call repeatedly.
  public load(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    if (this.isLoaded || document.querySelector(`script[src="${this.scriptUrl}"]`)) {
      this.isLoaded = true;
      return;
    }

    this.appendInitScript();

    const script = document.createElement('script');
    script.src = this.scriptUrl;
    script.async = true;
    script.onerror = () => console.error('Osano: failed to load cookie consent script');
    (document.head ?? document.body)?.appendChild(script);

    this.isLoaded = true;
  }

  // Opens the Osano cookie-preferences drawer. No-op until the script has loaded.
  public showPreferences(): void {
    if (typeof window === 'undefined') {
      return;
    }
    if (window.Osano?.cm?.showDrawer) {
      window.Osano.cm.showDrawer();
    } else {
      console.warn('Osano: CMP not available for showing cookie preferences drawer');
    }
  }

  // Bootstraps the Osano command queue and hides the default floating widget.
  private appendInitScript(): void {
    if (document.querySelector('script[data-osano-init="true"]')) {
      return;
    }
    const initScript = document.createElement('script');
    initScript.setAttribute('data-osano-init', 'true');
    initScript.textContent = `
(function (w, o, d) {
  w[o] = w[o] || function () { w[o][d].push(arguments); };
  w[o][d] = w[o][d] || [];
})(window, 'Osano', 'data');
window.Osano('onInitialized', function () {
  var style = document.createElement('style');
  style.textContent = '.osano-cm-widget {display: none !important;}';
  document.head.appendChild(style);
});
    `;
    (document.head ?? document.body)?.appendChild(initScript);
  }
}
