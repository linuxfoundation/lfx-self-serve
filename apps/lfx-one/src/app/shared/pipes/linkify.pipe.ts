// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Pipe, PipeTransform, SecurityContext } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { escapeHtml, extractUrlCandidates, isValidUrl } from '@lfx-one/shared/utils';

@Pipe({
  name: 'linkify',
})
export class LinkifyPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  /**
   * Renders text with its URLs as anchor tags, escaping everything else.
   * @description Extract and validate URL candidates from RAW text before escaping alters
   * characters like `&`. Build escaped prose and anchors using original offsets, so rejected
   * candidates, duplicates, and prefix-overlapping URLs cannot redirect replacement to the
   * wrong occurrence or re-scan generated markup. Sanitize the assembled HTML before trusting it.
   * @param value - Raw user text (comment body, description, etc.)
   * @returns Sanitized HTML with valid URLs linkified; empty string for null/undefined input
   */
  public transform(value: string | null | undefined): SafeHtml {
    if (!value) {
      return '';
    }

    const validUrls = extractUrlCandidates(value).filter(({ url }) => isValidUrl(url));
    let html = '';
    let offset = 0;
    for (const { url, index } of validUrls) {
      html += escapeHtml(value.slice(offset, index));
      const safeUrl = escapeHtml(url);
      html += `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary-600 hover:underline">${safeUrl}</a>`;
      offset = index + url.length;
    }
    html += escapeHtml(value.slice(offset));

    // Sanitize, then mark trusted so the declared SafeHtml return type is honest — the string was
    // just run through SecurityContext.HTML, so bypassing carries no extra risk, and binding via
    // [innerHTML] skips a redundant second sanitize pass.
    return this.sanitizer.bypassSecurityTrustHtml(this.sanitizer.sanitize(SecurityContext.HTML, html) || '');
  }
}
