// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Strips HTML tags and decodes common HTML entities from a string.
 * This function works in both browser and Node.js (SSR) environments.
 *
 * @param html - The HTML string to strip tags from
 * @returns Plain text with HTML tags removed and entities decoded
 *
 * @example
 * ```typescript
 * stripHtml('<p>Hello &amp; <strong>World</strong></p>')
 * // Returns: "Hello & World"
 *
 * stripHtml(null)
 * // Returns: ""
 * ```
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';

  return (
    html
      // Remove HTML tags
      .replace(/<[^>]*>/g, '')
      // Decode common HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&apos;/g, "'")
      // Trim whitespace
      .trim()
  );
}
