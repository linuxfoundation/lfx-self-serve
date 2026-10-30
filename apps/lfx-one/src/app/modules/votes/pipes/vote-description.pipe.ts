// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { inject, Pipe, PipeTransform, SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { isPrivateHost } from '@lfx-one/shared/utils';

/** Keeps textarea text literal while retaining sanitized descriptions from the legacy HTML editor. */
@Pipe({ name: 'voteDescription' })
export class VoteDescriptionPipe implements PipeTransform {
  private readonly document = inject(DOCUMENT);
  private readonly sanitizer = inject(DomSanitizer);

  public transform(value: string | null | undefined): string {
    if (!value) return '';

    const container = this.document.createElement('div');
    container.innerHTML = this.sanitizer.sanitize(SecurityContext.HTML, value) || '';

    // There is no stored format discriminator. Recognize supported formatting elements,
    // not arbitrary angle-bracket placeholders or entities in otherwise plain text.
    const richHtml = container.querySelector(
      'p, br, div, span, ul, ol, li, blockquote, pre, code, strong, b, em, i, u, s, a, h1, h2, h3, h4, h5, h6, table, hr, img'
    );
    if (!richHtml) {
      const text = this.document.createElement('span');
      text.className = 'whitespace-pre-wrap';
      text.textContent = value;
      return text.outerHTML;
    }

    // Strip destinations before binding, so browser context-menu navigation cannot bypass
    // click-time guards. A fixed public-shaped base keeps relative links SSR-consistent;
    // it is used only for parsing, never as the rendered href or a network destination.
    for (const anchor of Array.from(container.querySelectorAll('a[href]'))) {
      const href = anchor.getAttribute('href') || '';
      try {
        const destination = new URL(href, 'https://vote-description.invalid');
        if ((destination.protocol === 'http:' || destination.protocol === 'https:') && isPrivateHost(destination.hostname)) {
          anchor.removeAttribute('href');
        }
      } catch {
        anchor.removeAttribute('href');
      }
    }

    // No trusted-HTML bypass: the template sanitizer still applies.
    return container.innerHTML;
  }
}
