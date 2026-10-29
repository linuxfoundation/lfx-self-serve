// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Directive, HostListener, inject, PLATFORM_ID } from '@angular/core';
import { isValidUrl } from '@lfx-one/shared';

// Opens http(s) links inside author-supplied rich HTML (bound via [innerHTML]) in a new tab.
// Angular's HTML sanitizer strips `target` and `rel` from anchors, so the markup cannot carry
// them; handling the click here keeps the sanitizer untouched and works for any anchor the editor
// produced. Safe modified clicks (ctrl/cmd/shift/middle) are left to the browser. Rejected web URLs
// are blocked, while non-web schemes such as mailto: or tel: keep their native behaviour.
@Directive({
  selector: '[lfxExternalLinks]',
})
export class ExternalLinksDirective {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  @HostListener('click', ['$event'])
  @HostListener('auxclick', ['$event'])
  public onClick(event: MouseEvent): void {
    if (!this.isBrowser || event.defaultPrevented) {
      return;
    }

    const anchor = (event.target as Element | null)?.closest?.('a[href]');
    const href = anchor?.getAttribute('href');
    if (!anchor || !href || !/^https?:/i.test(href.trim())) {
      return;
    }

    if (!isValidUrl(href)) {
      event.preventDefault();
      return;
    }

    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}
