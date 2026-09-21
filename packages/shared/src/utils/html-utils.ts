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
/** Whether a numeric entity names a real code point — `String.fromCodePoint` throws otherwise. */
function isDecodableCodePoint(code: number): boolean {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff;
}

/**
 * Strip from display text anything that decoding could have resurrected.
 *
 * Drops what cannot legitimately appear in a display name: control characters (C0, C1, DEL),
 * BIDI overrides, and zero-width formatting. An earlier version checked only C0/DEL and five
 * ASCII characters, so `U+202E` survived -- and that one character visually REVERSES everything
 * after it, letting a sponsor name render as something other than what it contains.
 *
 * Denies by CODE POINT RANGE rather than by regex: a character-class regex over literal control
 * characters trips `no-control-regex` and is hard to read, while a numeric range check over the
 * decoded code points is both lintable and exhaustive for the ranges it names. Denying specific
 * ranges is right here; ALLOW-listing is not, because an allow-list refused `O'Reilly` and other
 * ordinary names.
 *
 * Shared because BOTH paths that produce a sponsor name feed the same sink (a HubSpot image
 * module's `alt` in a sent email): the scrape path, which decodes entities and so can resurrect
 * `<script>`, and the direct-request path, where the value is caller-supplied. Sanitising only
 * the first left the second open -- the partial-fix shape this belongs in one place to prevent.
 */
export function sanitizeDisplayText(value: string): string {
  return [...value]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      // C0 controls and DEL.
      if (code < 0x20 || code === 0x7f) return false;
      // C1 controls (U+0080-U+009F): invisible, and some legacy decoders map them to punctuation.
      if (code >= 0x80 && code <= 0x9f) return false;
      // BIDI overrides and embeddings. U+202E alone visually REVERSES the text after it, so a
      // sponsor name can render as something other than what it contains -- a spoof that
      // survives any check that only looks at ASCII. U+2066-U+2069 are the isolate forms.
      if (code >= 0x202a && code <= 0x202e) return false;
      if (code >= 0x2066 && code <= 0x2069) return false;
      // Zero-width and other invisible formatting: ZWSP/ZWNJ/ZWJ, LRM/RLM, word joiner, BOM.
      if (code === 0x200b || code === 0x200c || code === 0x200d) return false;
      if (code === 0x200e || code === 0x200f) return false;
      if (code === 0x2060 || code === 0xfeff) return false;
      // `<` and `>` only. Quotes, apostrophes and backticks are ordinary punctuation in real
      // names -- stripping them turned `O'Reilly` into `OReilly`, which is the over-stripping
      // this function's own doc warns against. They were never the risk: every consumer escapes
      // structurally rather than by interpolation -- Angular `[alt]` is a property binding, and
      // the Go side JSON-encodes the field -- so a quote cannot break out of either context.
      // Angle brackets stay dropped because the value is decoded first, and decoding is what can
      // turn `&lt;script&gt;` back into markup.
      return ch !== '<' && ch !== '>';
    })
    .join('')
    .trim();
}

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#\d+|#x[\da-fA-F]+|[a-z]+);/gi, (match, body: string) => {
    const lower = body.toLowerCase();
    // RANGE-checked, not just finite-checked. `Number.isFinite(999999999)` is true while
    // `String.fromCodePoint(999999999)` throws RangeError, and this function is reachable from
    // scraped third-party HTML (`&#999999999;`), so a finite-only guard turned attacker-
    // influenced input into an exception. An out-of-range escape is left as literal text --
    // it names no character, so there is nothing to decode it to.
    if (lower.startsWith('#x')) {
      const code = parseInt(lower.slice(2), 16);
      return isDecodableCodePoint(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number(lower.slice(1));
      return isDecodableCodePoint(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_HTML_ENTITIES[lower] ?? match;
  });
}

const HTML_ESCAPE_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes the five HTML-significant characters (`& < > " '`) so a string can be
 * safely embedded in markup. Single-pass is load-bearing: one regex replaces all
 * special characters at once, so an input like `&amp;` becomes `&amp;amp;` rather
 * than having its freshly-written `&` re-escaped by a later replace call.
 * Pure string ops — SSR-safe.
 *
 * @param text - The raw text to escape
 * @returns The text with HTML-significant characters entity-encoded
 *
 * @example
 * ```typescript
 * escapeHtml('I use <div> & "quotes"')
 * // Returns: "I use &lt;div&gt; &amp; &quot;quotes&quot;"
 *
 * escapeHtml(null)
 * // Returns: ""
 * ```
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPE_ENTITIES[char]);
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
