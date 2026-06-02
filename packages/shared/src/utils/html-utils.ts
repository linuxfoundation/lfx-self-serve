// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

const NAMED_HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Decodes a small set of named HTML entities plus all numeric ones (decimal
 * and hex) in a single regex pass. Single-pass is load-bearing: chaining
 * replacements would let a decoded `&` get re-interpreted as the start of a
 * fresh entity (e.g., `&amp;#39;` → `&#39;` → `'`), which is the
 * double-unescape pattern CodeQL flags. Pure string ops — SSR-safe.
 */
function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#\d+|#x[\da-fA-F]+|[a-z]+);/gi, (match, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number(lower.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_HTML_ENTITIES[lower] ?? match;
  });
}

/**
 * Strips HTML-like tag sequences until the string is stable. The inner
 * `[^<>]*` class is load-bearing: it disallows nested `<` inside a tag body,
 * which prevents the engine from trying every `<` position on adversarial
 * inputs like `<<<<<<<>` (the polynomial-regex pattern CodeQL flags). Looping
 * handles the residual case where one pass leaves a partial tag — each pass
 * runs in linear time, and the loop converges in a small constant number of
 * passes for any realistic input.
 */
function stripTagsToStable(s: string): string {
  let prev: string;
  let current = s;
  do {
    prev = current;
    current = current.replace(/<[^<>]*>/g, '');
  } while (current !== prev);
  return current;
}

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
  return decodeHtmlEntities(stripTagsToStable(html)).trim();
}

/**
 * Converts clipboard HTML to plain text while preserving hyperlinks.
 *
 * A `<textarea>` strips HTML on paste, so anchor `href` URLs are lost — only
 * the visible text survives. This helper rewrites anchors to a Markdown-style
 * `[text](url)` (or bare `url` when the visible text equals the href) so the
 * URLs can flow through plain-text fields (e.g., AI prompt inputs) and be
 * surfaced again downstream. SSR-safe — pure string operations, no DOM APIs.
 *
 * Output destination: the returned string flows into `textarea.value` /
 * `form.setValue()` and is treated as plain text by the browser. It is never
 * injected as `innerHTML`.
 *
 * Pipeline order matters:
 *   1. Carry anchor href/text through encoded — the `text === href` bare-URL
 *      collapse stays correct under entity equivalence.
 *   2. Strip remaining tags in a stable loop.
 *   3. Decode entities exactly once at the end, so no character is
 *      double-unescaped.
 *
 * @param html - The HTML string from `clipboardData.getData('text/html')`
 * @returns Plain text with anchors rewritten, block boundaries turned into
 *   newlines, remaining tags stripped, and entities decoded.
 *
 * @example
 * ```typescript
 * htmlClipboardToText('<p>See <a href="https://x.com/y">our guide</a> for more.</p>')
 * // Returns: "See [our guide](https://x.com/y) for more."
 *
 * htmlClipboardToText('<a href="https://x.com">https://x.com</a>')
 * // Returns: "https://x.com"
 * ```
 */
export function htmlClipboardToText(html: string | null | undefined): string {
  if (!html) return '';

  // Capture the full anchor tag first (with `[^<>]*` inside the open tag to
  // avoid polynomial backtracking on `<<<<<...>` inputs), then extract href
  // via a bounded inner regex on the captured tag string.
  let result = html.replace(/<a\b[^<>]*>([\s\S]*?)<\/a>/gi, (match, inner: string) => {
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match);
    const href = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? '').trim();
    const text = stripTagsToStable(inner).trim();
    if (!href) return text;
    if (!text || text === href) return href;
    return `[${text}](${href})`;
  });

  // Block-level boundaries → newlines (before stripping remaining tags).
  result = result.replace(/<br\s*\/?>/gi, '\n');
  result = result.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');

  // Strip remaining tags in a stable loop.
  result = stripTagsToStable(result);

  // Decode entities exactly once.
  result = decodeHtmlEntities(result);

  // Collapse runs of 3+ newlines down to 2.
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
