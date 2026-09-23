// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import sanitizeHtml from 'sanitize-html';

import { canonicalHttpUrl } from './url.utils';

const NAMED_HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Whether a numeric entity names a real code point — `String.fromCodePoint` throws otherwise. */
/**
 * Whether a string contains anything a reader would actually SEE.
 *
 * The one predicate for "is this visually empty", because the question has now been asked in
 * three places and answered three different ways: a `!== ''` string check, a `.trim() === ''`
 * check, and a `stripHtml(...).trim()` check. Each passed a value the previous one caught --
 * an empty paragraph, then a lone `<br>`, then a body of only zero-width spaces.
 *
 * Three PROPERTIES, each answering part of "does a glyph appear", rather than a list of
 * spellings -- naming spellings is what made this wrong four times before:
 *
 * - `\p{C}` is Other: control, format, surrogate, private-use, unassigned.
 * - `\p{Z}` is Separator: real word breaks, but nothing a reader sees as content.
 * - `\p{Default_Ignorable_Code_Point}` is the Unicode property that MEANS "renders nothing",
 *   and it is the one the category test alone missed. HANGUL FILLER (U+3164) is category Lo,
 *   VARIATION SELECTOR-16 and COMBINING GRAPHEME JOINER are Mn -- all outside C and Z, all
 *   invisible. Because it is a property rather than an enumeration, a default-ignorable added
 *   to a later Unicode version is covered without a change here.
 *
 * NFC first, so a decomposed sequence is judged as the glyph it composes to.
 *
 * Deliberately NOT `\p{M}`: a lone combining mark renders as a dotted circle, the property above
 * already covers the invisible marks, and excluding every mark would misjudge scripts where marks
 * carry meaning.
 *
 * @param value - Text, already stripped of markup if the caller has markup
 * @returns true when at least one character renders
 */
export function hasVisibleText(value: string): boolean {
  return /[^\p{C}\p{Z}\p{Default_Ignorable_Code_Point}]/u.test(value.normalize('NFC'));
}

/**
 * Whether an HTML fragment renders any text a reader can see.
 *
 * `hasVisibleText(stripHtml(html))` is the composition every caller wants, and writing it out at
 * each site is how this question drifted before: the markup must come off FIRST, or the tag names
 * themselves count as visible characters and `<p>\u200B</p>` reads as content.
 *
 * Markup that renders without text -- an `<img>`, an `<hr>` -- is deliberately NOT visible text
 * here. Callers that accept an image-only body check for that separately.
 *
 * @param html - An HTML fragment
 * @returns true when stripping the markup leaves at least one rendering character
 */
export function hasVisibleHtmlText(html: string): boolean {
  return hasVisibleText(stripHtml(html));
}

function isDecodableCodePoint(code: number): boolean {
  // The SURROGATE range is excluded, not just the out-of-range values. `String.fromCodePoint`
  // accepts 0xD800-0xDFFF without throwing and returns an unpaired surrogate, so `&#xD800;`
  // decoded into a string that is not well-formed UTF-16. Downstream that either throws in an
  // encoder or is substituted with U+FFFD, meaning the value that renders stops matching the
  // value that was checked -- the same class as the lone-surrogate hole already closed in
  // sanitizeDisplayText, reached through the entity decoder instead.
  //
  // A well-formed astral character is a single code point ABOVE 0xFFFF and never lands in this
  // range, so emoji and CJK extensions decode exactly as before.
  if (code >= 0xd800 && code <= 0xdfff) return false;
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff;
}

/**
 * Strip from display text anything that decoding could have resurrected.
 *
 * Drops what cannot legitimately appear in a display name: control characters (C0, C1, DEL),
 * BIDI overrides and marks, and invisible formatting -- with ONE carve-out: U+200C (ZWNJ) and
 * U+200D (ZWJ) are kept, because they are required orthography in Devanagari, Telugu, Bengali,
 * Arabic and Persian rather than formatting. A value consisting only of INVISIBLE characters
 * still comes back empty -- joiners, but also soft hyphens, word joiners, the BOM and every
 * other Unicode format or separator character -- since it would render blank while reading as
 * non-empty downstream. The floor asks whether anything RENDERS rather than naming spellings,
 * so a format character added to Unicode later needs no change here.
 *
 * The BIDI overrides matter most: `U+202E` visually REVERSES everything after it, letting a
 * sponsor name render as something other than what it contains. Checking C0/DEL and a handful of
 * ASCII characters does not reach them.
 *
 * Denies by CODE POINT RANGE rather than by regex: a character-class regex over literal control
 * characters trips `no-control-regex` and is hard to read, while a numeric range check over the
 * decoded code points is both lintable and exhaustive for the ranges it names. Denying specific
 * ranges is right here; ALLOW-listing is not, because an allow-list refused `O'Reilly` and other
 * ordinary names.
 *
 * Shared because BOTH paths that produce a sponsor name feed the same sink (a HubSpot image
 * module's `alt` in a sent email): the scrape path, which decodes entities and so can resurrect
 * `<script>`, and the direct-request path, where the value is caller-supplied. Sanitizing only
 * the first left the second open -- the partial-fix shape this belongs in one place to prevent.
 */
export function sanitizeDisplayText(value: string): string {
  const cleaned = [...value]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      // ORTHOGRAPHY, kept deliberately. U+200C (ZWNJ) and U+200D (ZWJ) select conjunct and
      // joined forms in Devanagari, Telugu, Bengali, Arabic and Persian; stripping them corrupts
      // correctly-spelled names. Safe for the threat this function stops: a joiner cannot
      // REORDER text the way a BIDI override can -- it renders two adjacent glyphs as one, which
      // is legibility rather than spoofing.
      if (code === 0x200c || code === 0x200d) return true;

      // Everything else invisible goes, BY CATEGORY rather than by name.
      //
      // `\p{C}` is Other: control (C0/C1/DEL), format (BIDI overrides and isolates, LRM/RLM/ALM,
      // ZWSP, word joiner, BOM, soft hyphen, U+180E), surrogate, private-use and unassigned.
      // `\p{Z}` is Separator, which the trim already handled for the ends but not the middle.
      //
      // Naming code points individually is what made this filter wrong four times: each round
      // found a spelling the list had not enumerated -- U+061C, then lone surrogates, then
      // U+00AD and U+180E surviving mid-value. The category cannot be outrun, and a format
      // character added to Unicode later needs no change here.
      //
      // `\p{C}` is DELETED: a format or control character carries no width, so removing it
      // joins nothing that was not already adjacent.
      if (/\p{C}/u.test(ch)) return false;

      return ch !== '<' && ch !== '>';
    })
    .join('')
    // `\p{Z}` is Separator, and every member of it is a VISIBLE word break: NBSP (U+00A0) from a
    // decoded `&nbsp;`, U+3000 in CJK names, U+202F in French digit grouping. Deleting them was a
    // real defect -- `山田　太郎` became `山田太郎` and `Linux&nbsp;Foundation` became
    // `LinuxFoundation`. They are still normalized rather than kept verbatim, because an NBSP
    // renders identically to a space while comparing unequal, which is the spoof this function
    // exists to stop. Mapping the CATEGORY to U+0020 keeps the word break and removes the
    // ambiguity, and needs no change when Unicode adds another separator.
    .replace(/\p{Z}/gu, ' ')
    .trim();

  // A joiner-only result is EMPTY in every sense that matters downstream.
  //
  // ZWJ/ZWNJ are kept because they are orthography, but they are orthography ATTACHED TO TEXT.
  // A value made of nothing else renders as blank while reading as non-empty, so
  // `normalizeSponsors`' `name !== ''` check would admit it and the email would carry a sponsor
  // with an invisible name. The carve-out needs this floor, or it trades an over-strip for a
  // silently blank field.
  // An ALLOW-list of what counts as visible, not a denylist of invisible spellings. The earlier
  // version named `\u200C` and `\u200D` explicitly, which left every other invisible-but-kept
  // code point counting as content: a name of only U+00AD (soft hyphen) or U+180E passed the
  // floor and rendered blank. Naming spellings cannot converge here -- the Unicode format
  // category keeps growing -- so the test is inverted to "does anything here actually render".
  //
  // `\p{C}` covers format, control, surrogate, private-use and unassigned; `\p{Z}` covers every
  // separator including the whitespace the trim already handled. Anything outside both is a
  // character with a glyph, which is exactly the question being asked.
  return hasVisibleText(cleaned) ? cleaned : '';
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
 * `href` as WHATWG will read it, for the purpose of deciding what it addresses.
 *
 * Tab, LF and CR are removed from ANYWHERE in the string, not just the ends: the URL parser
 * strips them wholesale before it does anything else, so `ht<TAB>tps://evil.example` is
 * `https://evil.example` to a browser while any regex anchored on `^https?:` sees a relative
 * path. Leading C0 controls and spaces go too, and `\` becomes `/` -- the parser's own order.
 *
 * This is the ONLY layer that folds backslashes; sanitize-html does not. So a spelling that
 * survives here survives into the recipient's inbox.
 */
function normalizeHrefForJudgement(href: string): string {
  return href
    .replace(/[\t\n\r]/g, '')
    .replace(/^[\x00-\x20]+/, '')
    .replace(/[\x00-\x20]+$/, '')
    .replace(/\\/g, '/');
}

/** Whether an already-normalized href names a host. */
function hasSchemeNormalized(normalized: string): boolean {
  return normalized.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(normalized);
}

/**
 * Whether `href` carries a scheme, i.e. makes a claim about WHICH HOST it addresses.
 *
 * A relative href (`/register`, `x.html`, `#frag`, `?a=b`) names no host and resolves against
 * whatever document renders it, so there is no destination to vouch for.
 */
function hasScheme(href: string): boolean {
  // TRIMMED first, and backslashes treated as slashes. WHATWG strips leading C0/space before
  // parsing and normalises `\` to `/`, so ` //evil.example`, `/\evil.example` and
  // `\\evil.example` all resolve to the host `evil.example`. Testing the raw string would send
  // them down the relative branch, which returns them UNJUDGED.
  //
  // sanitize-html's `allowProtocolRelative: false` also refuses these, so this is the second of
  // two independent layers rather than the only one -- but the allow-list must not depend on
  // that, or removing this normalisation becomes a silent bypass rather than a visible one.
  return hasSchemeNormalized(normalizeHrefForJudgement(href));
}

/**
 * The set of hosts an anchor may point at, from the caller's vouched-for destinations.
 *
 * A destination that will not parse contributes NOTHING rather than widening the set -- an
 * unparseable value is not evidence that a host is safe, and treating it as one would turn a
 * malformed brief url into "allow everything".
 */
function buildAllowedHosts(destinations: readonly string[] | undefined): Set<string> | null {
  // `undefined` means "no opinion" -- the legacy behaviour, every http(s) anchor kept. An EMPTY
  // ARRAY is the opposite and is the case that matters: the caller looked for a destination and
  // found none, so nothing is vouched for and every link is dropped. The stages that withhold a
  // button (CFP Launch, Post-Event, Final Countdown) arrive exactly this way, and they are the
  // ones a model is most likely to invent an address for.
  if (destinations === undefined) return null;

  const hosts = new Set<string>();
  for (const destination of destinations) {
    const canonical = canonicalHttpUrl(destination);
    if (canonical === '') continue;
    try {
      hosts.add(new URL(canonical).hostname.toLowerCase());
    } catch {
      // canonicalHttpUrl already parsed it; this is unreachable, and swallowing beats throwing
      // out of a sanitizer.
    }
  }
  // An allow-list that ended up EMPTY is not the same as no allow-list. The caller vouched for
  // something and none of it parsed, so nothing is vouched for: keep the text, drop every link.
  return hosts;
}

/**
 * The CANONICAL form of `href` when it points at a vouched-for host, or '' when it does not.
 *
 * Returns the canonical URL rather than a boolean so the anchor that ships carries it. The raw
 * value can address a safe host in a shape that reads as a hostile one --
 * `https://events.linuxfoundation.org\@evil.example/` is `events.linuxfoundation.org` with
 * `/@evil.example/` as its PATH, because WHATWG normalises a backslash to a slash. Emitting the
 * form that was actually judged means the recipient's mail client sees the same URL this
 * function approved, instead of one it has to re-derive.
 */
function allowedDestinationHref(href: string, allowedHosts: Set<string>): string {
  const canonical = canonicalHttpUrl(href);
  if (canonical === '') return '';
  let hostname: string;
  try {
    hostname = new URL(canonical).hostname.toLowerCase();
  } catch {
    return '';
  }
  // Subdomains included: a brief pointing at `events.linuxfoundation.org` vouches for
  // `cfp.events.linuxfoundation.org`. The dot is what stops `notevents.linuxfoundation.org.evil`
  // and `evilevents.linuxfoundation.org` matching by suffix alone.
  const allowed = [...allowedHosts].some((host) => hostname === host || hostname.endsWith(`.${host}`));
  return allowed ? canonical : '';
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
 * Delegates to `sanitize-html`, which PARSES rather than pattern-matches. A regex or hand-rolled
 * scanner cannot do this job: `<image>`, `<input type=image>`, unquoted `background=`/`style=`,
 * spliced tags, a `dropContent` tag whose attribute merely ends in `/`, and mismatched close tags
 * all defeat one, and tightening a scanner against them tends to start DELETING ordinary copy
 * instead (a raw `<` truncating the body, entities double-escaped). Tag and attribute allow-lists
 * still express the policy; the parsing is not ours.
 *
 * ANCHORS. An `<a href>` is a PROMISE OF A DESTINATION, and this body is model-written text that
 * a scraped third-party page influenced. campaign-service's api-catalog states the position
 * plainly for `/email-copy`: the model "is INSTRUCTED that every `href` in the generated body
 * must be the brief's `url`", but "that is a prompt instruction, NOT an enforced guarantee ... a
 * caller needing certainty must check the returned body itself." This is that check.
 *
 * `allowedDestinations` is that certainty. A host on it keeps its link; every other host keeps
 * its TEXT and loses only the `href`. That matches what this file already does one layer up,
 * where a button with no usable url keeps its label as text rather than vanishing -- the words
 * are the content, the link is the claim we cannot back.
 *
 * Two failure modes were considered and rejected:
 *   - Allowing any `http(s)` host (what `canonicalHttpUrl` alone does). It stops `javascript:`
 *     and private hosts, but `https://evil.example/phish` is an ordinary public https URL, so
 *     the phishing vector survives untouched.
 *   - Requiring exact equality with the brief url. Generated copy legitimately links to sponsor
 *     sites, documentation and social profiles; stripping those is an over-denial that silently
 *     rewrites correct copy.
 * Host-level matching (the destination's host, plus its subdomains) is the narrowest rule that
 * admits the legitimate cases and refuses an invented address.
 *
 * Omitting `allowedDestinations` keeps every `http(s)` anchor -- the prior behaviour, for callers
 * that have no destination to vouch against. Pass it wherever one is known.
 */
export function stripResourceLoadingHtml(html: string | null | undefined, allowedDestinations?: readonly string[]): string {
  if (!html) return '';

  const allowedHosts = buildAllowedHosts(allowedDestinations);

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
    transformTags: {
      // Runs BEFORE `allowedSchemes` / `allowProtocolRelative`, which sanitize-html applies in
      // the attribute loop after `transformTags` has been dispatched. So `href` arrives RAW here
      // -- `javascript:` and `//evil.example` both reach this hook. That is safe because
      // `allowedDestinationHref` goes through `canonicalHttpUrl`, which refuses a non-http(s)
      // scheme and a protocol-relative url on its own; the scheme check afterwards is a second
      // line, not the first. Do not simplify this to a bare host comparison on the assumption
      // that the scheme was already validated.
      a: (tagName, attribs) => {
        if (allowedHosts === null) return { tagName, attribs };
        const raw = typeof attribs['href'] === 'string' ? attribs['href'] : '';
        // A RELATIVE href names no host, so it makes no destination claim to check -- it resolves
        // against whatever document renders it. Judging one against the allow-list would drop
        // every ordinary in-site link, which is the defect the docstring below already records
        // having fixed once.
        if (raw !== '' && !hasScheme(raw)) return { tagName, attribs };
        const href = allowedDestinationHref(raw, allowedHosts);
        if (href !== '') return { tagName, attribs: { ...attribs, href } };
        // The anchor SURVIVES without its href, so the words stay in the copy. Dropping the tag
        // would delete the call to action; dropping only the promise is the narrower answer.
        const { href: _dropped, ...rest } = attribs;
        return { tagName, attribs: rest };
      },
    },
    // An `href` may name an http(s) destination or a RELATIVE path; `javascript:`, `data:` and
    // protocol-relative `//host` are dropped. Relative is kept deliberately: an earlier
    // hand-rolled version refused it, which silently broke ordinary in-site links in generated
    // copy. `allowProtocolRelative: false` is what stops `//evil.com` masquerading as one.
    allowedSchemes: ['http', 'https'],
    // ONLY `href`, narrowing sanitize-html's default (href, src, cite, action). That is safe
    // here because `allowedAttributes` above permits no other URL-bearing attribute -- src and
    // friends are already gone. Adding one to `allowedAttributes` without adding it here would
    // leave it scheme-unchecked, so the two lists have to move together.
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    // Content is DROPPED for these, not just the tag. Everywhere else a disallowed tag's TEXT
    // survives -- dropping `<section>` must not delete the words inside it, and the copy is the
    // point of the preview -- so this list is exactly the set whose contents are not copy:
    //
    //   script, style              code
    //   iframe, object, embed      an embedded document's fallback, not this email's copy
    //   noscript, textarea         alternate or form content the preview never renders
    //   title                      document metadata that would otherwise appear mid-body
    //   svg, math                  glyph and markup internals -- `<svg><text>LEAK</text></svg>`
    //                              put LEAK into the body recipients receive, with no element
    //                              left to explain where it came from
    nonTextTags: ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'textarea', 'title', 'svg', 'math'],
  });
}
