// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { OsanoFunction } from '@lfx-one/shared/interfaces';

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
  private readonly platformId = inject(PLATFORM_ID);

  // Public Osano CMP script for the Linux Foundation (same source the <lfx-footer> uses).
  private readonly scriptUrl = 'https://cmp.osano.com/16A0DbT9yDNIaQkvZ/d6ac078e-c71f-4b96-8c97-818cc1cc6632/osano.js';

  private isLoaded = false;

  // Injects the Osano consent script once. Safe to call repeatedly.
  public load(): void {
    if (!isPlatformBrowser(this.platformId)) {
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
    script.onerror = () => {
      console.error('Osano: failed to load cookie consent script');
      // Clear the guard and drop the dead node so a later interaction can retry the load.
      this.isLoaded = false;
      script.remove();
    };
    (document.head ?? document.body)?.appendChild(script);

    this.isLoaded = true;
  }

  // Opens the Osano cookie-preferences drawer. If the CMP is still initializing — e.g. the footer
  // link is clicked before the async script settles — the request is queued through Osano's own
  // command shim so it replays once the CMP is ready, instead of being silently dropped.
  public showPreferences(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Ensure the CMP is (re)loading even if the drawer is opened before afterNextRender's load().
    this.load();

    // `@linuxfoundation/lfx-ui-core` globally types `window.Osano` as a plain object (no call
    // signature), but at runtime our bootstrap installs Osano's callable command-queue shim. Cast
    // to the shared model that captures both so a pre-init click can be queued, not dropped.
    const osano = window.Osano as OsanoFunction | undefined;
    if (osano?.cm?.showDrawer) {
      osano.cm.showDrawer();
      return;
    }

    // The init script installs a command-queue shim (`window.Osano(...)`) before the real CMP
    // loads; queueing `onInitialized` replays the drawer open once initialization completes.
    if (osano) {
      osano('onInitialized', () => window.Osano?.cm?.showDrawer?.());
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
