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
    const trimmed = url.trim();
    // If it already has http/https scheme, validate it directly
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        new URL(trimmed);
        return trimmed;
      } catch {
        return null;
      }
    }
    // Try prepending https:// and validate
    const withHttps = `https://${trimmed}`;
    try {
      const parsed = new URL(withHttps);
      // Only allow if the hostname looks real (has a dot, no spaces)
      if (parsed.hostname.includes('.') && !parsed.hostname.includes(' ')) {
        return withHttps;
      }
    } catch {
      // invalid
    }
    return null;
  }
}
