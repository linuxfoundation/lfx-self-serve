// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import sanitizeHtml from 'sanitize-html';

const NAMED_HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Whether a numeric entity names a real code point — `String.fromCodePoint` throws otherwise. */
function isDecodableCodePoint(code: number): boolean {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff;
}

/**
 * Strip from display text anything that decoding could have resurrected.
 *
 * Drops what cannot legitimately appear in a display name: control characters (C0, C1, DEL),
 * BIDI overrides and marks, and invisible formatting -- with ONE carve-out: U+200C (ZWNJ) and
 * U+200D (ZWJ) are kept, because they are required orthography in Devanagari, Telugu, Bengali,
 * Arabic and Persian rather than formatting. A value consisting ONLY of joiners still comes back
 * empty, since it would render blank while reading as non-empty downstream.
 *
 * An earlier version checked only C0/DEL and five
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
  const cleaned = [...value]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      // C0 controls and DEL.
      if (code < 0x20 || code === 0x7f) return false;
      // C1 controls (U+0080-U+009F): invisible, and some legacy decoders map them to punctuation.
      if (code >= 0x80 && code <= 0x9f) return false;
      // Lone surrogates. Iterating with [...value] yields an UNPAIRED surrogate as its own
      // element -- a well-formed pair is already a single code point above 0xFFFF and never
      // reaches here. They are not characters, and encoders downstream either throw on them or
      // substitute U+FFFD, so the value that renders is not the value that was checked.
      if (code >= 0xd800 && code <= 0xdfff) return false;
      // BIDI overrides and embeddings. U+202E alone visually REVERSES the text after it, so a
      // sponsor name can render as something other than what it contains -- a spoof that
      // survives any check that only looks at ASCII. U+2066-U+2069 are the isolate forms.
      if (code >= 0x202a && code <= 0x202e) return false;
      if (code >= 0x2066 && code <= 0x2069) return false;
      // ZERO WIDTH SPACE only. U+200C (ZWNJ) and U+200D (ZWJ) are KEPT: they are required
      // orthography in Devanagari, Telugu, Bengali, Arabic and Persian, where they select
      // conjunct or joined forms -- stripping them corrupts real sponsor names. `नमस्‍ते` and
      // `అమ్‌మ` came back altered, which is the same over-stripping that once turned `O'Reilly`
      // into `OReilly`, and that this function's own doc warns against.
      //
      // Keeping them is safe for the threat this function exists to stop: a joiner cannot
      // REORDER text the way a BIDI override can. It can only render two adjacent glyphs as one,
      // which is a legibility question rather than a spoof -- and the alternative is refusing to
      // display a correctly-spelled name in five writing systems.
      if (code === 0x200b) return false;
      // LRM/RLM are directional MARKS, not joiners: they alter how the surrounding run is laid
      // out, which is the same class as the overrides denied above.
      // LRM/RLM/ALM are directional MARKS, not joiners: they alter how the surrounding run is
      // laid out, which is the same class as the overrides denied above. U+061C (ARABIC LETTER
      // MARK) belongs with them and was missed -- it is invisible and directional, so it does
      // the spoofing job of LRM in Arabic-script text.
      if (code === 0x200e || code === 0x200f || code === 0x061c) return false;
      // WORD JOINER and BOM: invisible, and neither is orthography in any script.
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

  // A joiner-only result is EMPTY in every sense that matters downstream.
  //
  // ZWJ/ZWNJ are kept because they are orthography, but they are orthography ATTACHED TO TEXT.
  // A value made of nothing else renders as blank while reading as non-empty, so
  // `normalizeSponsors`' `name !== ''` check would admit it and the email would carry a sponsor
  // with an invisible name. The carve-out needs this floor, or it trades an over-strip for a
  // silently blank field.
  // Whitespace does not count as real text here: `"\u200D \u200C"` survives the trim (the
  // joiners are not whitespace, so they anchor the ends) and would otherwise read as a name made
  // of one space. The test is for a character that actually renders.
  return /[^\s\u200C\u200D]/u.test(cleaned) ? cleaned : '';
}

/**
 * Decodes HTML entities in a text value, in a SINGLE pass.
 *
 * Single-pass is the security property, not an optimisation. Decoding repeatedly until the
 * output stops changing turns `&amp;lt;script&amp;gt;` into live markup in two rounds -- the
 * double-unescape CodeQL flags -- so one pass over the input is what makes the result
 * structurally unable to resurrect an escape the author wrote literally.
 *
 * Numeric escapes are RANGE-checked rather than merely finite-checked, because this is reachable
 * from scraped third-party HTML; see isDecodableCodePoint.
 */
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

/**
 * Reduces html to formatting that cannot make the renderer fetch anything.
 *
 * For html destined for `[innerHTML]`. Angular's sanitizer already removes scripts, event
 * handlers and `javascript:` urls -- what it deliberately KEEPS is a plain
 * `<img src="https://…">`, which is no XSS risk and is exactly the browser-side fetch a preview
 * of model-generated content must not make. campaign-service's `/email-copy` path applies no
 * sanitizer of its own, so this is the only place it can be stopped.
 *
 * A dropped tag KEEPS its text -- `<section>hello</section>` renders `hello` -- because the copy
 * is what the preview is for. The exception is `nonTextTags` below, whose contents are code or
 * markup internals rather than words; those are dropped with the tag.
 *
 * Delegates to `sanitize-html`, which PARSES rather than pattern-matches. Three hand-written
 * versions preceded it -- a regex denylist and two hand-rolled scanners -- and review found
 * eleven defects across them: `<image>`, `<input type=image>`, unquoted `background=`/`style=`,
 * spliced tags, a `dropContent` tag whose attribute merely ended in `/`, a mismatched close
 * tag, and twice a bug that DELETED ordinary copy (a raw `<` truncating the body, entities
 * double-escaped). None of those exist in a real parser, and each fix I wrote created the next
 * finding. Tag and attribute allow-lists still express the policy; the parsing is no longer ours.
 */
export function stripResourceLoadingHtml(html: string | null | undefined): string {
  if (!html) return '';

  return sanitizeHtml(html, {
    // Formatting only. Every resource-loading element is absent by omission rather than by
    // being named, so an element added to HTML later cannot become a bypass.
    allowedTags: [
      'p',
      'br',
      'hr',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'ul',
      'ol',
      'li',
      'blockquote',
      'a',
      'span',
      'div',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th',
    ],
    // `src`, `srcset`, `background`, `style` and `poster` are all absent for the same reason.
    allowedAttributes: { a: ['href'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    // An `href` may only name an absolute http(s) destination; anything else is dropped.
    allowedSchemes: ['http', 'https'],
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    // Content is DROPPED for these, not just the tag. Everywhere else a disallowed tag's TEXT
    // survives -- dropping `<span>` must not delete the words inside it, and the copy is the
    // point of the preview -- so this list is exactly the set whose contents are not copy:
    // code for script/style, and glyph/markup internals for svg and math, where
    // `<svg><text>LEAK</text></svg>` otherwise put LEAK into the body recipients receive with no
    // element left to explain where it came from.
    nonTextTags: ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'textarea', 'title', 'svg', 'math'],
  });
}
