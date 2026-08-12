// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Pipe, PipeTransform, SecurityContext } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { escapeHtml, extractUrls } from '@lfx-one/shared';

@Pipe({
  name: 'linkify',
})
export class LinkifyPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  /**
   * Renders text with its URLs as anchor tags, escaping everything else.
   * @description Three phases: (1) extract and validate URLs from the RAW text (before escaping
   * alters characters like `&`), swapping each for a `\x00i\x00` placeholder so replaced output is
   * never re-scanned — duplicate or prefix-overlapping URLs can't nest anchors into already-inserted
   * markup; (2) escape all prose so user text renders literally; (3) restore the pre-built anchors
   * and sanitize. Returns trusted SafeHtml for [innerHTML] binding.
   * @param value - Raw user text (comment body, description, etc.)
   * @returns Sanitized HTML with valid URLs linkified; empty string for null/undefined input
   */
  public transform(value: string | null | undefined): SafeHtml {
    if (!value) {
      return '';
    }

    // Extract and validate URLs from the raw text, before escaping alters characters like &
    const validUrls = extractUrls(value);

    // Swap each URL occurrence for a unique placeholder, left to right. Single-occurrence
    // replacement is load-bearing: replaced output is never re-scanned, so duplicate or
    // prefix-overlapping URLs can't nest anchors into already-inserted markup.
    const anchors: string[] = [];
    let tokenized = value;
    validUrls.forEach((url, index) => {
      const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      tokenized = tokenized.replace(new RegExp(escapedUrl), `\x00${index}\x00`);
      const safeUrl = escapeHtml(url);
      anchors.push(`<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary-600 hover:underline">${safeUrl}</a>`);
    });

    // Escape the prose so user text renders literally, then restore the anchors
    let html = escapeHtml(tokenized);
    anchors.forEach((anchor, index) => {
      html = html.replaceAll(`\x00${index}\x00`, anchor);
    });

    // Sanitize, then mark trusted so the declared SafeHtml return type is honest — the string was
    // just run through SecurityContext.HTML, so bypassing carries no extra risk, and binding via
    // [innerHTML] skips a redundant second sanitize pass.
    return this.sanitizer.bypassSecurityTrustHtml(this.sanitizer.sanitize(SecurityContext.HTML, html) || '');
  }
}
