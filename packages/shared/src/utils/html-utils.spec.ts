// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { sanitizeDisplayText, decodeHtmlEntities, escapeHtml, hasVisibleText, htmlClipboardToText, stripHtml, stripResourceLoadingHtml } from './html-utils';

describe('sanitizeDisplayText', () => {
  it('drops a BIDI override that would visually reverse the name', () => {
    // U+202E reverses everything after it, so a name can RENDER as something other than what it
    // contains -- a spoof invisible to any check that only looks at ASCII.
    expect(sanitizeDisplayText('Acme\u202Emoc.evil')).toBe('Acmemoc.evil');
  });

  it('drops a lone surrogate, which is not a character', () => {
    // [...value] yields an UNPAIRED surrogate as its own element; a well-formed pair is already a
    // single code point above 0xFFFF and never reaches the filter. Encoders downstream either
    // throw on a lone surrogate or substitute U+FFFD, so the value that RENDERS stops matching
    // the value that was checked.
    const out = sanitizeDisplayText('Hello\uD800World');
    expect(out).toBe('HelloWorld');
    expect(/[\uD800-\uDFFF]/.test(out)).toBe(false);
  });

  it('keeps an astral character, whose surrogates are a valid PAIR', () => {
    // The guard must not over-strip: this is the negative case that separates a lone surrogate
    // from an emoji or a CJK extension character, both of which are legitimate sponsor names.
    expect(sanitizeDisplayText('Acme \u{1F680} Corp')).toBe('Acme \u{1F680} Corp');
    expect(sanitizeDisplayText('A\u2066B\u2069C')).toBe('ABC');
  });

  it('drops zero-width and C1 control characters', () => {
    expect(sanitizeDisplayText('Acme\u200BCorp')).toBe('AcmeCorp');
    expect(sanitizeDisplayText('Acme\uFEFFCorp')).toBe('AcmeCorp');
    expect(sanitizeDisplayText('Acme\u0085Corp')).toBe('AcmeCorp');
  });

  it('keeps ordinary punctuation, which is not the risk', () => {
    // Stripping quotes turned `O'Reilly` into `OReilly`. They were never the risk: every
    // consumer escapes structurally -- Angular `[alt]` is a property binding, the Go side
    // JSON-encodes -- so a quote cannot break out of either context.
    expect(sanitizeDisplayText("O'Reilly")).toBe("O'Reilly");
    expect(sanitizeDisplayText('The "Best" Corp')).toBe('The "Best" Corp');
    expect(sanitizeDisplayText('Ben & Jerry’s')).toBe('Ben & Jerry’s');
  });

  it('keeps accented and non-Latin names intact', () => {
    // Over-stripping would refuse legitimate sponsors, which is a real defect rather than a
    // safe default -- the same trap the host denylist kept falling into.
    expect(sanitizeDisplayText('Café München')).toBe('Café München');
    expect(sanitizeDisplayText('日本語スポンサー')).toBe('日本語スポンサー');
    expect(sanitizeDisplayText('Acme & Co')).toBe('Acme & Co');
  });

  // Why the joiners are kept lives in html-utils.ts; this pins the BEHAVIOUR, in both
  // directions plus the joiner-only floor between them.
  it.each([
    ['Devanagari with ZWJ', 'नमस्\u200Dते'],
    ['Telugu with ZWNJ', 'అమ్\u200Cమ'],
    ['an apostrophe', "O'Reilly"],
    ['a curly apostrophe', 'O\u2019Reilly'],
    ['an accent', 'Nestlé'],
    ['an Arabic name', 'مرحبا'],
    ['a joiner between real letters', 'a\u200Db'],
    ['a joiner at the end of real text', 'Acme\u200C'],
  ])('keeps %s intact', (_label, name) => {
    expect(sanitizeDisplayText(name)).toBe(name);
  });

  it.each([
    ['a right-to-left override', 'a\u202Eb'],
    ['a left-to-right override', 'a\u202Db'],
    ['a zero-width space', 'a\u200Bb'],
    ['a left-to-right mark', 'a\u200Eb'],
    ['a right-to-left mark', 'a\u200Fb'],
    ['an arabic letter mark', 'a\u061Cb'],
    ['a word joiner', 'a\u2060b'],
    ['a byte-order mark', 'a\uFEFFb'],
    ['an isolate', 'a\u2066b'],
  ])('still strips %s', (_label, input) => {
    expect(sanitizeDisplayText(input)).toBe('ab');
  });

  // The floor between the two tables above. A joiner-only value renders BLANK while reading as
  // non-empty, so `normalizeSponsors`' `name !== ''` check would admit it and the email would
  // carry a sponsor whose name shows nothing.
  it.each([
    ['a single ZWJ', '\u200D'],
    ['a single ZWNJ', '\u200C'],
    ['several joiners', '\u200D\u200C\u200D'],
    ['joiners around whitespace', '\u200D \u200C'],
  ])('returns empty for %s', (_label, input) => {
    expect(sanitizeDisplayText(input)).toBe('');
  });
});

describe('decodeHtmlEntities', () => {
  it('leaves an out-of-range numeric entity as literal text instead of throwing', () => {
    // `Number.isFinite(999999999)` is true but `String.fromCodePoint(999999999)` throws
    // RangeError. This helper is reachable from SCRAPED third-party HTML, so a finite-only
    // guard turned attacker-influenced input into an exception.
    expect(() => decodeHtmlEntities('&#999999999;')).not.toThrow();
    expect(decodeHtmlEntities('&#999999999;')).toBe('&#999999999;');
    expect(decodeHtmlEntities('&#x110000;')).toBe('&#x110000;');
  });

  it('still decodes valid named, decimal and hex entities', () => {
    expect(decodeHtmlEntities('&amp;')).toBe('&');
    expect(decodeHtmlEntities('&#65;')).toBe('A');
    expect(decodeHtmlEntities('&#x41;')).toBe('A');
  });

  it('decodes in a SINGLE pass, so an escaped entity cannot become a real one', () => {
    // `&amp;#39;` is the literal text `&#39;`. A chained implementation would decode `&amp;`
    // to `&` and then re-read `&#39;` as an apostrophe -- the double-unescape CodeQL flags.
    expect(decodeHtmlEntities('&amp;#39;')).toBe('&#39;');
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
  });
});

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml('I use <div> & "quotes" and \'apostrophes\'')).toBe('I use &lt;div&gt; &amp; &quot;quotes&quot; and &#39;apostrophes&#39;');
  });

  it('escapes in a single pass so existing entities are double-encoded, not corrupted', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('returns empty string for null / undefined / empty', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml('')).toBe('');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('see https://example.com?a=1~b')).toBe('see https://example.com?a=1~b');
  });
});

describe('stripHtml', () => {
  it('removes tags and decodes entities', () => {
    expect(stripHtml('<p>Hello &amp; <strong>World</strong></p>')).toBe('Hello & World');
  });

  it('returns empty string for null / undefined / empty', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
    expect(stripHtml('')).toBe('');
  });
});

describe('htmlClipboardToText', () => {
  it('returns empty string for null / undefined / empty', () => {
    expect(htmlClipboardToText(null)).toBe('');
    expect(htmlClipboardToText(undefined)).toBe('');
    expect(htmlClipboardToText('')).toBe('');
  });

  it('converts an anchor with distinct text to Markdown', () => {
    expect(htmlClipboardToText('<a href="https://docs.example.com/guide">contributor guide</a>')).toBe('[contributor guide](https://docs.example.com/guide)');
  });

  it('renders a bare URL when the anchor text equals the href', () => {
    expect(htmlClipboardToText('<a href="https://x.com">https://x.com</a>')).toBe('https://x.com');
  });

  it('uses just the text when the anchor has no href', () => {
    expect(htmlClipboardToText('<a>no href here</a>')).toBe('no href here');
  });

  it('uses just the text when the href is empty', () => {
    expect(htmlClipboardToText('<a href="">link text</a>')).toBe('link text');
  });

  it('preserves multiple anchors in one block', () => {
    const html = '<p>See <a href="https://a.com">A</a> and <a href="https://b.com">B</a>.</p>';
    expect(htmlClipboardToText(html)).toBe('See [A](https://a.com) and [B](https://b.com).');
  });

  it('strips nested formatting inside anchor text', () => {
    expect(htmlClipboardToText('<a href="https://x.com"><strong>bold</strong> link</a>')).toBe('[bold link](https://x.com)');
  });

  it('handles single-quoted href values', () => {
    expect(htmlClipboardToText("<a href='https://x.com'>x</a>")).toBe('[x](https://x.com)');
  });

  it('still finds the href when other attributes come first', () => {
    expect(htmlClipboardToText('<a class="link" data-foo="bar" href="https://x.com">x</a>')).toBe('[x](https://x.com)');
  });

  it('decodes entities in plain text', () => {
    expect(htmlClipboardToText('cats &amp; dogs')).toBe('cats & dogs');
  });

  it('decodes entities inside anchor text', () => {
    expect(htmlClipboardToText('<a href="https://x.com">cats &amp; dogs</a>')).toBe('[cats & dogs](https://x.com)');
  });

  it('decodes entities inside href so query-string URLs survive', () => {
    expect(htmlClipboardToText('<a href="https://example.com?a=1&amp;b=2">link</a>')).toBe('[link](https://example.com?a=1&b=2)');
  });

  it('collapses to a bare URL when text and href differ only by entity encoding', () => {
    const html = '<a href="https://example.com?a=1&amp;b=2">https://example.com?a=1&amp;b=2</a>';
    expect(htmlClipboardToText(html)).toBe('https://example.com?a=1&b=2');
  });

  it('decodes decimal numeric entities (em dash, NBSP, smart quote)', () => {
    expect(htmlClipboardToText('hello&#8212;world&#160;&#8217;tis')).toBe('hello—world ’tis');
  });

  it('decodes hexadecimal numeric entities', () => {
    expect(htmlClipboardToText('em dash &#x2014; and ndash &#x2013;')).toBe('em dash — and ndash –');
  });

  it('turns block boundaries into newlines', () => {
    expect(htmlClipboardToText('<p>Hello</p><p>World</p>')).toBe('Hello\nWorld');
  });

  it('turns <br> into a newline', () => {
    expect(htmlClipboardToText('Line 1<br>Line 2<br/>Line 3')).toBe('Line 1\nLine 2\nLine 3');
  });

  it('preserves list-item line breaks', () => {
    const html = '<ul><li>First item with <a href="https://a.com">A</a></li><li>Second item</li></ul>';
    expect(htmlClipboardToText(html)).toBe('First item with [A](https://a.com)\nSecond item');
  });

  it('collapses runs of 3+ newlines to 2', () => {
    expect(htmlClipboardToText('<p>A</p><br><br><br><br><p>B</p>')).toBe('A\n\nB');
  });

  it('strips remaining tags but keeps surrounding text', () => {
    expect(htmlClipboardToText('<span style="color:red">red text</span>')).toBe('red text');
  });

  it('handles a Notion-style mixed paragraph with a link and inline formatting', () => {
    const html = '<p>Check out the <a href="https://example.com/post">new post</a> — <strong>big</strong> update!</p>';
    expect(htmlClipboardToText(html)).toBe('Check out the [new post](https://example.com/post) — big update!');
  });
});

describe('invisible-only values and surrogate entities', () => {
  it('treats ANY invisible-only value as empty, not just the two joiners', () => {
    // The floor was a denylist naming U+200C and U+200D, so every other invisible-but-kept code
    // point still counted as content and rendered a blank name. Inverted to an allow-list:
    // "does anything here actually render".
    for (const invisible of ['\u200D', '\u200C', '\u2060', '\uFEFF', '\u00AD', '\u180E', '\u200D\u200C']) {
      expect(sanitizeDisplayText(invisible)).toBe('');
    }
  });

  it('strips invisible characters from the MIDDLE of a value, not just whole-value', () => {
    // The gap the earlier tests missed: they only asserted that an invisible-ONLY value came
    // back empty, which a whole-value emptiness check satisfies without removing anything. A
    // soft hyphen inside `Acme\u00ADCorp` survived into recipient-visible sponsor text.
    //
    // Enumerated by CATEGORY rather than by the code points that happened to be reported --
    // naming them individually is what made this filter wrong four rounds running.
    for (const [label, input] of [
      ['soft hyphen', 'Acme\u00ADCorp'],
      ['Mongolian vowel separator', 'Acme\u180ECorp'],
      ['word joiner', 'Acme\u2060Corp'],
      ['BOM', 'Acme\uFEFFCorp'],
      ['zero-width space', 'Acme\u200BCorp'],
      ['BIDI override', 'Acme\u202ECorp'],
      ['LRM', 'Acme\u200ECorp'],
      ['ALM', 'Acme\u061CCorp'],
    ] as const) {
      expect(sanitizeDisplayText(input), label).toBe('AcmeCorp');
    }
  });

  it('keeps the orthographic joiners mid-value, and an ordinary space', () => {
    // The negative half. ZWJ/ZWNJ are required orthography in Devanagari, Telugu, Bengali,
    // Arabic and Persian -- a category-wide strip would delete them and corrupt real names,
    // which is the over-strip this carve-out exists to prevent.
    expect(sanitizeDisplayText('Acme\u200DCorp')).toBe('Acme\u200DCorp');
    expect(sanitizeDisplayText('Acme\u200CCorp')).toBe('Acme\u200CCorp');
    expect(sanitizeDisplayText('नमस्\u200Dते')).toBe('नमस्\u200Dते');
    expect(sanitizeDisplayText('Acme Corp')).toBe('Acme Corp');
  });

  it('keeps every value that actually renders', () => {
    // The negative half. Without it, "strip all format characters" passes the test above and
    // deletes real sponsor names -- the over-strip this floor exists to avoid.
    for (const name of ['Acme Corp', '株式会社', '🚀 Labs', 'नमस्ते', "O'Reilly"]) {
      expect(sanitizeDisplayText(name)).toBe(name);
    }
  });

  it('refuses to decode a surrogate-range numeric entity', () => {
    // String.fromCodePoint accepts D800-DFFF without throwing and returns an unpaired surrogate,
    // so `&#xD800;` produced a string that is not well-formed UTF-16 -- the same lone-surrogate
    // class closed elsewhere, reached through the entity decoder.
    expect(decodeHtmlEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeHtmlEntities('&#55296;')).toBe('&#55296;');
    // Astral characters are a single code point above 0xFFFF and must still decode.
    expect(decodeHtmlEntities('&#x1F680;')).toBe('\u{1F680}');
    expect(decodeHtmlEntities('&#x4E2D;')).toBe('\u4E2D');
  });
});

describe('stripResourceLoadingHtml', () => {
  it('drops text inside svg and math rather than leaking it into the body', () => {
    // sanitize-html KEEPS a disallowed tag's text by default, which is right for `<span>` and
    // wrong here: the text in these is not copy. `<svg><text>` put the string straight into the
    // body recipients receive, with no element left to explain where it came from.
    expect(stripResourceLoadingHtml('<p>a</p><svg><text>LEAK</text></svg><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(stripResourceLoadingHtml('<p>a</p><math><mi>LEAK</mi></math><p>b</p>')).toBe('<p>a</p><p>b</p>');
  });

  it('still keeps the text of an ordinary disallowed wrapper', () => {
    // The negative case: dropping a tag must not delete the words inside it. Without this,
    // "add every unknown tag to nonTextTags" passes the svg test above and silently eats real
    // copy. Asserted EXACTLY rather than with toContain, so a change that also dropped the
    // surrounding paragraphs would still fail.
    //
    // `<span>` is ALLOWED, so it survives as a tag; `<section>` is not, and is the case that
    // proves the text of a dropped wrapper is kept rather than deleted with it.
    expect(stripResourceLoadingHtml('<p>a</p><span>KEEP</span><p>b</p>')).toBe('<p>a</p><span>KEEP</span><p>b</p>');
    expect(stripResourceLoadingHtml('<p>a</p><section>KEEP</section><p>b</p>')).toBe('<p>a</p>KEEP<p>b</p>');
  });

  it('drops what an UNCLOSED svg swallows, because the parser nests it inside', () => {
    // Deliberate, and not specific to svg. An unclosed element takes everything after it as its
    // own content -- htmlparser2 reports `+p-p+svg+text-text+p-p-svg` here, and exactly the same
    // shape for an unclosed `<div>`. So `<p>b</p>` really is inside the svg, and dropping it is
    // the parser's reading rather than a sanitizer quirk.
    //
    // Pinned because the alternative is worse in both directions: leaving svg out of nonTextTags
    // leaks `L` into the sent body, and hand-balancing the tag before parsing would mean
    // second-guessing the parser about where the element ends.
    expect(stripResourceLoadingHtml('<p>a</p><svg><text>L</text><p>b</p>')).toBe('<p>a</p>');
    // The CLOSED form is the case that must keep the tail, and it does.
    expect(stripResourceLoadingHtml('<p>a</p><svg><text>L</text></svg><p>b</p>')).toBe('<p>a</p><p>b</p>');
  });

  // An ALLOW-LIST, after a denylist of resource tags was bypassed four ways in one review round.
  // Every one of those is pinned here, plus two nobody reported, because the point is that the
  // rule no longer depends on having named them.
  it.each([
    ['a plain image', '<img src="https://evil.test/x">t'],
    ['an uppercase image', '<IMG SRC="https://evil.test/x">t'],
    ['a newline inside the tag', '<img\nsrc="https://evil.test/x">t'],
    ['the <image> alias', '<image href="https://evil.test/x">t'],
    ['input type=image', '<input type=image src="https://evil.test/x">t'],
    ['an UNQUOTED background attribute', '<td background=https://evil.test/x>t</td>'],
    ['an UNQUOTED style attribute', '<p style=background:url(https://evil.test/x)>t</p>'],
    ['a quoted background attribute', '<p background="https://evil.test/x">t</p>'],
    ['a picture/source set', '<picture><source srcset="https://evil.test/x"></picture>t'],
    ['a video poster', '<video poster="https://evil.test/x"></video>t'],
    ['an iframe', '<iframe src="https://evil.test/x">i</iframe>t'],
    ['an svg image', '<svg><image href="https://evil.test/x"/></svg>t'],
  ])('removes every fetch path in %s', (_label, input) => {
    const out = stripResourceLoadingHtml(input);
    // The URL is gone...
    expect(out).not.toContain('evil.test');
    // ...and so is every attribute that could carry one. `not.toContain` alone passed for a
    // blanket strip, which is the failure this pair exists to separate: four of the bugs found
    // in the hand-rolled versions deleted ordinary copy while removing the URL.
    expect(out).not.toMatch(/\b(src|srcset|background|poster|style)\s*=/i);
    // The surrounding copy SURVIVES. Every fixture above ends in a bare `t`.
    expect(out).toContain('t');
  });

  it('keeps a relative href and drops the shapes that only look like one', () => {
    // Relative is KEPT deliberately -- an earlier hand-rolled version refused it and silently
    // broke ordinary in-site links in generated copy.
    expect(stripResourceLoadingHtml('<a href="/about">x</a>')).toBe('<a href="/about">x</a>');
    expect(stripResourceLoadingHtml('<a href="https://ok.example/p">x</a>')).toBe('<a href="https://ok.example/p">x</a>');
    // `//host` is protocol-relative, not a path: it resolves to a remote origin.
    expect(stripResourceLoadingHtml('<a href="//evil.test/x">x</a>')).toBe('<a>x</a>');
    expect(stripResourceLoadingHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(stripResourceLoadingHtml('<a href="data:text/html,x">x</a>')).toBe('<a>x</a>');
  });

  it('drops the content of every nonTextTags entry, and only those', () => {
    // The three entries added this round plus the pre-existing ones, so a future edit that drops
    // one from the list fails here rather than silently leaking its text into the sent body.
    // `embed` is deliberately absent: it is a VOID element, so htmlparser2 emits `+embed -embed`
    // and the following text is a SIBLING rather than its content -- `nonTextTags` has nothing to
    // suppress. Verified against the tokenizer, and the surviving text is inert: a `<script>` or
    // `<img>` written inside an `<embed>` is still dropped by the allow-list, exactly as it is
    // inside a `<section>`. Listing it here would assert behaviour the parser cannot produce.
    for (const tag of ['script', 'style', 'iframe', 'object', 'noscript', 'textarea', 'title', 'svg', 'math']) {
      expect(stripResourceLoadingHtml(`<p>a</p><${tag}>SECRET</${tag}><p>b</p>`)).not.toContain('SECRET');
    }
    // The embed case, stated as what it actually is rather than omitted.
    expect(stripResourceLoadingHtml('<embed><script>alert(1)</script></embed>')).toBe('');
    expect(stripResourceLoadingHtml('<embed><img src="https://evil.test/x"></embed>')).toBe('');
    // And the negative half: a disallowed tag NOT on that list keeps its words.
    expect(stripResourceLoadingHtml('<p>a</p><section>KEEP</section><p>b</p>')).toContain('KEEP');
  });

  // The copy is the point of the preview: this must not become a blanket strip.
  it.each([
    ['paragraphs and emphasis', '<p><strong>keep</strong> <em>me</em></p>'],
    ['an http anchor', '<a href="https://x.test/r">link</a>'],
    ['lists', '<ul><li>one</li><li>two</li></ul>'],
    ['headings', '<h2>Title</h2>'],
    ['a table', '<table><tbody><tr><td>cell</td></tr></tbody></table>'],
    ['plain text', 'just words'],
  ])('leaves %s intact', (_label, input) => {
    expect(stripResourceLoadingHtml(input)).toBe(input);
  });

  // A SPLICED tag: removing the inner `<img>` leaves `g src="…">` behind as text. That residue
  // is inert -- it cannot reopen a tag -- but copying it verbatim showed raw attribute markup in
  // the preview, so text nodes are escaped rather than passed through.
  it.each([
    ['a spliced img', '<im<img>g src="https://evil.test/x">t'],
    ['a spliced script', '<scr<script>ipt>evil()</script>t'],
    ['a > inside an attribute value', '<img src="a>b" onerror=x>t'],
  ])('leaves no live markup from %s', (_label, input) => {
    const out = stripResourceLoadingHtml(input);
    expect(out).not.toMatch(/<(img|image|script|iframe)\b/i);
    // No `<` survives, so whatever residue remains is a TEXT node and cannot fetch. The URL
    // may still appear as visible text -- that is the parser reading malformed input as text
    // rather than inventing a tag, which is the correct reading.
    expect(out).not.toMatch(/</);
  });

  // A raw `<` in ordinary copy is NOT a tag opener. Treating it as one consumed everything to
  // the next `>`, so `<p>5 < 10 and more</p>` came out as `<p>5 ` -- silent data loss on
  // perfectly valid email copy, which is worse than the fetch this function exists to stop.
  it.each([
    ['a less-than in copy', '<p>5 < 10 and more</p>', '<p>5 &lt; 10 and more</p>'],
    ['a less-than before more markup', '<p>price < $5</p><p>keep</p>', '<p>price &lt; $5</p><p>keep</p>'],
    ['a lone less-than', 'a < b', 'a &lt; b'],
  ])('preserves %s', (_label, input, want) => {
    expect(stripResourceLoadingHtml(input)).toBe(want);
  });

  // Text nodes are decoded before re-escaping, for the same reason attribute values are: the
  // source is already html-escaped, so escaping again showed the reader a literal `&amp;`.
  // Fixed for attributes first and missed here, one line away.
  it.each([
    ['an ampersand entity', '<p>Tom &amp; Jerry</p>', '<p>Tom &amp; Jerry</p>'],
    ['an escaped less-than', '<p>5 &lt; 10</p>', '<p>5 &lt; 10</p>'],
  ])('round-trips %s in text', (_label, input, want) => {
    expect(stripResourceLoadingHtml(input)).toBe(want);
  });

  it('does not double-escape an attribute value', () => {
    // The source value is already html-escaped, so re-escaping turned `a&b` into `a&amp;amp;b`
    // in the rendered link.
    expect(stripResourceLoadingHtml('<a href="https://x.test/a&amp;b">t</a>')).toBe('<a href="https://x.test/a&amp;b">t</a>');
  });

  it('keeps the TEXT of a disallowed tag, but drops code content', () => {
    expect(stripResourceLoadingHtml('<marquee>keep this</marquee>')).toBe('keep this');
    expect(stripResourceLoadingHtml('<p>a</p><script>evil()</script><p>b</p>')).toBe('<p>a</p><p>b</p>');
  });

  // An href may only name an http(s) destination or a relative path. A RELATIVE href is kept
  // deliberately: it cannot reach an external host, so dropping it would lose a working link
  // for no safety gain -- the earlier hand-rolled version dropped it, which was over-strict.
  it.each([
    ['a javascript: url', '<a href="javascript:evil()">t</a>', '<a>t</a>'],
    ['a data: url', '<a href="data:text/html,x">t</a>', '<a>t</a>'],
    ['a protocol-relative url', '<a href="//evil.test/x">t</a>', '<a>t</a>'],
  ])('drops %s', (_label, input, want) => {
    expect(stripResourceLoadingHtml(input)).toBe(want);
  });

  it.each([
    ['an https url', '<a href="https://x.test/r">t</a>'],
    ['a relative path', '<a href="/relative">t</a>'],
  ])('keeps %s', (_label, input) => {
    expect(stripResourceLoadingHtml(input)).toBe(input);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
  ])('returns empty for %s', (_label, input) => {
    expect(stripResourceLoadingHtml(input)).toBe('');
  });
});

/**
 * The invisible-character filter was inverted to a Unicode CATEGORY test to stop a denylist of
 * named code points being outrun round after round. That inversion initially over-reached: it
 * deleted all of `\p{Z}` except U+0020, so NBSP and U+3000 -- which are VISIBLE word breaks, not
 * invisible characters -- were removed outright. `山田　太郎` became `山田太郎` and a scraped
 * `Linux&nbsp;Foundation` became `LinuxFoundation`.
 *
 * The two categories answer different questions and now get different treatment: `\p{C}` (format,
 * control, surrogate, private-use) carries no width and is DELETED; `\p{Z}` is a real word break
 * and is NORMALIZED to U+0020 -- which keeps the break while removing the spoofing value of a
 * separator that renders as a space but compares unequal.
 */
describe('sanitizeDisplayText — separators are word breaks, not invisibles', () => {
  it.each([
    ['NBSP', ' ', 'Linux Foundation'],
    ['ideographic space', '　', '山田 太郎'],
    ['narrow NBSP', ' ', '12 000'],
    ['en space', ' ', 'a b'],
    ['thin space', ' ', 'a b'],
  ])('keeps the word break for %s', (_label, separator, expected) => {
    const [left, right] = expected.split(' ');

    expect(sanitizeDisplayText(`${left}${separator}${right}`)).toBe(expected);
  });

  it('normalises separators to a plain space rather than preserving them', () => {
    // An NBSP renders identically to a space but compares unequal, which is the display spoof this
    // function exists to stop -- so the break survives, the ambiguity does not.
    const result = sanitizeDisplayText('Linux Foundation');

    expect(result).not.toContain(' ');
    expect(result).toBe('Linux Foundation');
  });

  it.each([
    ['zero-width space', '​'],
    ['soft hyphen', '­'],
    ['Mongolian vowel separator', '᠎'],
    ['word joiner', '⁠'],
  ])('still deletes %s, which has no width', (_label, invisible) => {
    expect(sanitizeDisplayText(`Foun${invisible}dation`)).toBe('Foundation');
  });

  it('still reports a separator-only value as empty', () => {
    // `hasVisibleText` asks a different question from the filter: a value of nothing but
    // separators renders blank, so it must not pass the floor even though the separators survive.
    expect(sanitizeDisplayText(' 　 ')).toBe('');
  });
});

/**
 * The category test (`\p{C}`/`\p{Z}`) was the fix for a denylist that kept being outrun, but it
 * had a gap of its own: invisible code points OUTSIDE those two categories. HANGUL FILLER is
 * category Lo (a Letter), and VARIATION SELECTOR-16 and COMBINING GRAPHEME JOINER are Mn (Mark) --
 * all three render nothing and all three passed as "visible".
 *
 * The fix is another PROPERTY rather than another list: `Default_Ignorable_Code_Point` is the
 * Unicode property that means exactly "renders nothing", so a default-ignorable added in a future
 * Unicode version needs no change here.
 */
describe('hasVisibleText — invisible code points outside C and Z', () => {
  it.each([
    ['HANGUL FILLER (category Lo)', '\u3164'],
    ['VARIATION SELECTOR-16 (Mn)', '\uFE0F'],
    ['COMBINING GRAPHEME JOINER (Mn)', '\u034F'],
    ['MONGOLIAN FREE VARIATION SELECTOR ONE (Mn)', '\u180B'],
  ])('reports %s as not visible', (_label, invisible) => {
    expect(hasVisibleText(invisible)).toBe(false);
  });

  it.each([
    ['Devanagari with conjuncts', 'नमस्ते'],
    ['Arabic with harakat', 'مُحَمَّد'],
    ['Thai with vowel signs', 'กำ'],
    ['a decomposed accented letter', 'e\u0301'],
    ['BRAILLE PATTERN BLANK, which is a real glyph', '\u2800'],
    ['a lone combining mark, which renders as a dotted circle', '\u0301'],
  ])('still reports %s as visible', (_label, visible) => {
    // Why `\p{M}` must NOT be added to the exclusion: marks carry meaning in these scripts, and
    // a lone mark still puts a glyph on screen.
    expect(hasVisibleText(visible)).toBe(true);
  });
});

/**
 * An `<a href>` in model-written copy is a PROMISE OF A DESTINATION, and campaign-service's
 * api-catalog says of `/email-copy` that its "every href must be the brief's url" prompt is
 * "a prompt instruction, NOT an enforced guarantee ... a caller needing certainty must check the
 * returned body itself."
 *
 * The link is dropped; the TEXT is kept. That matches what the assembly layer already does with
 * a button that has no usable url -- the words are the content, the link is the claim.
 */
describe('stripResourceLoadingHtml — anchor destinations', () => {
  const BRIEF = ['https://events.linuxfoundation.org/kubecon'];

  it('drops an href pointing at a host nobody vouched for, keeping its text', () => {
    const html = '<p>Hi <a href="https://evil.example/phish">Register</a></p>';

    expect(stripResourceLoadingHtml(html, BRIEF)).toBe('<p>Hi <a>Register</a></p>');
  });

  it('keeps an href pointing at a vouched-for host', () => {
    const html = '<p><a href="https://events.linuxfoundation.org/kubecon/register">Register</a></p>';

    expect(stripResourceLoadingHtml(html, BRIEF)).toContain('href="https://events.linuxfoundation.org/kubecon/register"');
  });

  it('keeps a subdomain of a vouched-for host', () => {
    // A brief pointing at `events.linuxfoundation.org` vouches for `cfp.events…` too.
    const html = '<p><a href="https://cfp.events.linuxfoundation.org/submit">Submit</a></p>';

    expect(stripResourceLoadingHtml(html, BRIEF)).toContain('href="https://cfp.events.linuxfoundation.org/submit"');
  });

  it.each([
    ['a suffix that is not a subdomain', 'https://evilevents.linuxfoundation.org/x'],
    ['the vouched host as a prefix of another', 'https://events.linuxfoundation.org.evil.test/x'],
  ])('refuses %s', (_label, href) => {
    // The dot in `.${allowed}` is what separates a subdomain from a lookalike; without it both
    // of these match by bare suffix.
    expect(stripResourceLoadingHtml(`<p><a href="${href}">x</a></p>`, BRIEF)).toBe('<p><a>x</a></p>');
  });

  it('treats an EMPTY destination list as vouching for nothing', () => {
    // Not the same as `undefined`. The stages that withhold a button (CFP Launch, Post-Event,
    // Final Countdown) arrive with an empty list, and they are the ones a model is most likely
    // to invent an address for.
    const html = '<p><a href="https://events.linuxfoundation.org/kubecon">Register</a></p>';

    expect(stripResourceLoadingHtml(html, [])).toBe('<p><a>Register</a></p>');
  });

  it('keeps every http(s) anchor when no list is supplied', () => {
    // `undefined` is "no opinion" -- the behaviour for callers with no destination to vouch
    // against, such as the operator-typed variant B body.
    const html = '<p><a href="https://sponsor.example/blog">the post</a></p>';

    expect(stripResourceLoadingHtml(html, undefined)).toContain('href="https://sponsor.example/blog"');
  });

  it('does not widen the allow-list from an unparseable destination', () => {
    // An unparseable destination is not evidence that a host is safe. Contributing nothing is
    // what stops a malformed brief url becoming "allow everything".
    const html = '<p><a href="https://evil.example/p">x</a></p>';

    expect(stripResourceLoadingHtml(html, ['not a url', 'javascript:alert(1)'])).toBe('<p><a>x</a></p>');
  });

  it('is idempotent, so a second pass at the request boundary changes nothing', () => {
    const html = '<p>Go <a href="https://events.linuxfoundation.org/kubecon">here</a> not <a href="https://evil.example/p">there</a></p>';
    const once = stripResourceLoadingHtml(html, BRIEF);

    expect(stripResourceLoadingHtml(once, BRIEF)).toBe(once);
  });

  it('emits the CANONICAL href, not the raw one', () => {
    // WHATWG normalises a backslash to a slash, so this is `events.linuxfoundation.org` with
    // `/@evil.example/` as its path -- a safe host in a shape that reads as a hostile one.
    // Shipping the form that was judged means the mail client sees what this function approved.
    const html = String.raw`<p><a href="https://events.linuxfoundation.org\@evil.example/">x</a></p>`;

    expect(stripResourceLoadingHtml(html, BRIEF)).toBe('<p><a href="https://events.linuxfoundation.org/@evil.example/">x</a></p>');
  });

  it.each([
    ['userinfo naming the vouched host', 'https://events.linuxfoundation.org@evil.example/p'],
    ['userinfo with a password', 'https://events.linuxfoundation.org:x@evil.example/p'],
    ['the vouched host in the PATH', 'https://evil.example/events.linuxfoundation.org'],
    ['a protocol-relative url', '//events.linuxfoundation.org/x'],
  ])('refuses %s', (_label, href) => {
    expect(stripResourceLoadingHtml(`<p><a href="${href}">x</a></p>`, BRIEF)).toBe('<p><a>x</a></p>');
  });

  it('keeps a vouched host regardless of case or port', () => {
    // DNS is case-insensitive and a port does not change the host.
    const html = '<p><a href="https://EVENTS.LINUXFOUNDATION.ORG:8443/x">x</a></p>';

    expect(stripResourceLoadingHtml(html, BRIEF)).toContain('href="https://events.linuxfoundation.org:8443/x"');
  });

  it.each([
    ['a root-relative path', '/register', 'https://events.linuxfoundation.org/register'],
    ['a document-relative path', 'register.html', 'https://events.linuxfoundation.org/register.html'],
    ['a fragment', '#agenda', 'https://events.linuxfoundation.org/kubecon#agenda'],
    ['a parent-relative path', '../x', 'https://events.linuxfoundation.org/x'],
    ['a query-only href', '?a=b', 'https://events.linuxfoundation.org/kubecon?a=b'],
  ])('resolves %s against the vouched destination', (_label, href, expected) => {
    // Forwarding a relative href unchanged was wrong for this sink: the body lands in an EMAIL,
    // so `/register` resolves against the mail client's document rather than the event site and
    // arrives as a link to nowhere. Resolving beats dropping -- the reader gets a working link --
    // and the result is judged by the SAME allow-list, so nothing skips the check.
    expect(stripResourceLoadingHtml(`<p><a href="${href}">x</a></p>`, BRIEF)).toBe(`<p><a href="${expected}">x</a></p>`);
  });

  it('agrees with itself across layers, whatever the model returns', () => {
    // The three call sites filter the SAME body in sequence: the service against the model's own
    // button url, then the client and controller against `emailCtaDestination()` -- which is ''
    // unless the model's url equals the brief's. What must hold is that the operator's preview
    // and the staged draft are identical, for every shape the model can return.
    const brief = 'https://events.linuxfoundation.org/kubecon';
    const body = `<p>Go <a href="${brief}/register">A</a> and <a href="https://evil.example/p">B</a></p>`;

    for (const modelUrl of [brief, 'https://evil.example/cfp', '']) {
      const fromService = stripResourceLoadingHtml(body, modelUrl === '' ? [] : [modelUrl]);
      // `emailCtaDestination` keeps the model's url ONLY when it matches the brief.
      const validated = modelUrl === brief ? [modelUrl] : [];
      const preview = stripResourceLoadingHtml(fromService, validated);
      const staged = stripResourceLoadingHtml(fromService, validated);

      expect(preview).toBe(staged);
      // And an invented destination never survives to the draft, however it entered.
      expect(staged).not.toContain('evil.example');
    }
  });

  it('drops a relative href when NOTHING is vouched for', () => {
    // An empty list is "vouched for nothing", and that has to mean every link -- a relative one
    // has no base to resolve against either. Keeping them contradicted the stated policy.
    expect(stripResourceLoadingHtml('<p><a href="/register">x</a></p>', [])).toBe('<p><a>x</a></p>');
  });

  it('leaves a relative href alone when no list is supplied', () => {
    // `undefined` is still "no opinion" -- the legacy behaviour for callers with no destination.
    expect(stripResourceLoadingHtml('<p><a href="/register">x</a></p>', undefined)).toContain('href="/register"');
  });

  it.each([
    ['a leading space', ' //evil.example/x'],
    ['a leading tab', '\t//evil.example/x'],
    ['a leading newline', '\n//evil.example/x'],
    ['a slash-backslash pair', '/\\evil.example/path'],
    ['a double backslash', '\\\\evil.example/path'],
    ['a backslash-slash pair', '\\/evil.example/x'],
  ])('refuses %s, which resolves to a host', (_label, href) => {
    // WHATWG strips leading C0/space and normalises `\` to `/`, so each of these resolves to the
    // host `evil.example` and must not be treated as a relative path.
    //
    // NOTE ON WHAT THIS PINS: two independent layers refuse these -- `hasScheme` normalises
    // before deciding, and sanitize-html's `allowProtocolRelative: false` refuses them anyway.
    // This test therefore pins the OUTCOME, not which layer produced it: it still passes if
    // `hasScheme` stops normalising. That is stated rather than hidden, because a test whose name
    // implies more than it checks is worse than no test. `hasScheme` is module-private, and
    // exporting it purely to test it would widen the module's surface for no caller.
    expect(stripResourceLoadingHtml(`<p><a href="${href}">x</a></p>`, BRIEF)).toBe('<p><a>x</a></p>');
  });

  it.each([
    ['a tab inside the scheme', 'ht\ttps://evil.example/p'],
    ['a newline inside the scheme', 'ht\ntps://evil.example/p'],
    ['a carriage return inside the scheme', 'ht\rtps://evil.example/p'],
    ['a tab before the colon', 'https\t://evil.example/p'],
    ['a tab after the colon', 'https:\t//evil.example/p'],
    ['a slash, tab, then backslash', '/\t\\evil.example/p'],
    ['a tab between the slashes', '/\t/evil.example/p'],
    ['a leading C0 control', '\x01//evil.example/p'],
  ])('refuses %s', (_label, href) => {
    // WHATWG removes tab, LF and CR from ANYWHERE in a url before parsing, so each of these is
    // `evil.example` to a browser while a regex anchored on `^https?:` sees a relative path.
    //
    // Unlike the protocol-relative cases above, these DO bind: sanitize-html does not fold
    // backslashes or strip interior control characters, so this is the only layer that refuses
    // them. Mutation-verified -- reverting the normalisation fails exactly these.
    expect(stripResourceLoadingHtml(`<p><a href="${href}">x</a></p>`, BRIEF)).toBe('<p><a>x</a></p>');
  });

  it.each([
    ['a non-breaking space', '\u00A0https://evil.example/p'],
    ['an ideographic space', '\u3000https://evil.example/p'],
    ['an en space', '\u2002https://evil.example/p'],
    ['a line separator', '\u2028https://evil.example/p'],
    ['a byte-order mark', '\uFEFFhttps://evil.example/p'],
    ['a non-breaking space before //', '\u00A0//evil.example/p'],
  ])('refuses a url prefixed with %s', (_label, href) => {
    // Narrowing the end-strip to C0/space to catch interior tabs opened this: NBSP, U+3000 and
    // U+2028 survived, the value read as relative, and a later `trim()` -- canonicalHttpUrl runs
    // one -- turned it back into a live destination. Both classes are stripped at both ends.
    expect(stripResourceLoadingHtml(`<p><a href="${href}">x</a></p>`, BRIEF)).toBe('<p><a>x</a></p>');
  });

  it('refuses every ignorable-character spelling a browser reads as a host', () => {
    // ENUMERATED, not sampled. Three consecutive review rounds each named one spelling
    // (protocol-relative, then interior tab, then NBSP prefix) and each fix opened the next,
    // because each closed the example instead of the class. This asserts the whole cross
    // product: every character WHATWG ignores or a trim() removes, at every position that could
    // change how the host is read.
    const ignorable = [
      0x00, 0x01, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1f, 0x20, 0xa0, 0x1680, 0x2000, 0x2002, 0x2003, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
    ].map((cp) => String.fromCodePoint(cp));
    const shapes = (c: string): string[] => [
      `${c}https://evil.example/p`,
      `ht${c}tps://evil.example/p`,
      `https${c}://evil.example/p`,
      `https:${c}//evil.example/p`,
      `/${c}/evil.example/p`,
      `/${c}\\evil.example/p`,
      `${c}//evil.example/p`,
    ];

    const leaked = ignorable
      .flatMap(shapes)
      // Only a spelling a BROWSER resolves to the hostile host is a leak; the rest are
      // unparseable and refused for a different reason.
      .filter((href) => {
        try {
          return new URL(href, 'https://events.linuxfoundation.org/').hostname === 'evil.example';
        } catch {
          return false;
        }
      })
      .filter((href) => stripResourceLoadingHtml(`<a href="${href}">x</a>`, BRIEF).includes('href'));

    expect(leaked).toEqual([]);
  });

  it('keeps a legitimate url whose PATH contains a space', () => {
    // The normalisation must not become an over-denial: stripping control characters is about
    // how the host is read, and an ordinary path is untouched.
    expect(stripResourceLoadingHtml('<p><a href="https://events.linuxfoundation.org/a b">x</a></p>', BRIEF)).toContain(
      'href="https://events.linuxfoundation.org/a%20b"'
    );
  });

  it('refuses a raw javascript: href inside the hook, not only via allowedSchemes', () => {
    // `transformTags` runs BEFORE sanitize-html's scheme check, so the hook sees raw hrefs. This
    // pins that `allowedDestinationHref` refuses the scheme itself -- the property the code
    // actually relies on, rather than the ordering an earlier comment wrongly claimed.
    expect(stripResourceLoadingHtml('<p><a href="javascript:alert(1)">x</a></p>', [])).toBe('<p><a>x</a></p>');
  });

  it('still refuses a non-http scheme even on a vouched-for host', () => {
    expect(stripResourceLoadingHtml('<p><a href="javascript:alert(1)">x</a></p>', BRIEF)).toBe('<p><a>x</a></p>');
  });
});
