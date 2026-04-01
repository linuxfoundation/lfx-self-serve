// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'safeUrl',
  standalone: true,
  pure: true,
})
export class SafeUrlPipe implements PipeTransform {
  public transform(url: string | null | undefined): string | null {
    if (!url?.trim()) return null;

    // If the URL already has a valid protocol, return it only if http(s)
    try {
      const parsed = new URL(url);
      if (['http:', 'https:'].includes(parsed.protocol)) return url;
      return null;
    } catch {
      // No valid protocol — prepend https:// only if it looks like a domain with a valid TLD
      // Requires dot-separated segments with a letter-only TLD (2+ chars) to avoid false positives
      // like "v2.0", "2024.Q1", or "test.log"
      if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(\/.*)?$/i.test(url)) {
        return `https://${url}`;
      }
      return null;
    }
  }
}
