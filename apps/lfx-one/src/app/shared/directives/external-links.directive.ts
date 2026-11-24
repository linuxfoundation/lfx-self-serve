// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Directive, HostListener, inject, PLATFORM_ID } from '@angular/core';
import { isPrivateHost } from '@lfx-one/shared/utils';

// Opens http(s) links inside author-supplied rich HTML (bound via [innerHTML]) in a new tab.
// Delegation supplies consistent behaviour even when stored HTML omits target/rel, without
// bypassing Angular's HTML sanitizer. Resolve relative links before checking their protocol/host
// so equivalent web destinations receive the same policy. Safe modified clicks are left to the
// browser; non-web schemes such as mailto: or tel: keep their native behaviour.
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
    if (!anchor || href == null) {
      return;
    }

    if (href.trim() === '') {
      event.preventDefault();
      return;
    }

    let url: URL;
    try {
      url = new URL(href, anchor.baseURI);
    } catch {
      event.preventDefault();
      return;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return;
    }

    if (isPrivateHost(url.hostname)) {
      event.preventDefault();
      return;
    }

    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }
}
