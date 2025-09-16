// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Pipe, PipeTransform, SecurityContext } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { extractUrls } from '@lfx-one/shared';

@Pipe({
  name: 'linkify',
  standalone: true,
})
export class LinkifyPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  public transform(value: string | null | undefined): SafeHtml {
    if (!value) {
      return '';
    }

    // Extract and validate URLs first
    const validUrls = extractUrls(value);

    // Convert validated URLs to clickable links
    let linkedText = value;
    validUrls.forEach((url) => {
      // Escape the URL for use in regex to handle special characters
      const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const urlRegex = new RegExp(escapedUrl, 'g');

      linkedText = linkedText.replace(
        urlRegex,
        `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary-600 hover:underline">${url}</a>`
      );
    });

    // Sanitize and return the HTML content
    return this.sanitizer.sanitize(SecurityContext.HTML, linkedText) || '';
  }
}
