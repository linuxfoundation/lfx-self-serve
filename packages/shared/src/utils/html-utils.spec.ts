// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { sanitizeDisplayText, decodeHtmlEntities, escapeHtml, htmlClipboardToText, stripHtml, stripResourceLoadingHtml } from './html-utils';

describe('sanitizeDisplayText', () => {
  it('drops a BIDI override that would visually reverse the name', () => {
    // U+202E reverses everything after it, so a name can RENDER as something other than what it
    // contains -- a spoof invisible to any check that only looks at ASCII.
    expect(sanitizeDisplayText('Acme\u202Emoc.evil')).toBe('Acmemoc.evil');
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

describe('sanitizeDisplayText — joiner carve-out', () => {
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

describe('stripResourceLoadingHtml', () => {
  // Angular's `[innerHTML]` sanitizer covers scripts, handlers and `javascript:` urls; what it
  // KEEPS is a plain `<img src>`, which is safe for XSS and is precisely the browser-side fetch
  // the campaign preview must not make.
  it.each([
    ['a remote image', '<p>hi</p><img src="https://evil.test/x.png">', '<p>hi</p>'],
    ['a self-closing image', '<p>a</p><img src="x" />', '<p>a</p>'],
    ['an iframe and its content', '<iframe src="x">inner</iframe>ok', 'ok'],
    ['a picture/source set', '<picture><source srcset="x"></picture>t', 't'],
    ['a video', '<video src="x"></video>t', 't'],
    ['an object', '<object data="x">fallback</object>t', 't'],
    ['a stylesheet link', '<link rel="stylesheet" href="x">t', 't'],
    ['a style block', '<style>.a{background:url(x)}</style>t', 't'],
    ['an svg', '<svg><image href="x"/></svg>t', 't'],
    ['a background-image style attribute', '<p style="background:url(https://evil.test/x)">t</p>', '<p>t</p>'],
    ['a background attribute', '<td background="https://evil.test/x">t</td>', '<td>t</td>'],
  ])('strips %s', (_label, input, want) => {
    expect(stripResourceLoadingHtml(input)).toBe(want);
  });

  // The copy is the point of the preview -- this is a narrow strip, not a formatting allow-list.
  it.each([
    ['paragraphs and emphasis', '<p><strong>keep</strong> <em>me</em></p>'],
    ['an anchor', '<a href="https://x.test">link</a>'],
    ['lists', '<ul><li>one</li><li>two</li></ul>'],
    ['headings', '<h2>Title</h2>'],
    ['a divider', '<hr />'],
    ['plain text', 'just words'],
  ])('leaves %s intact', (_label, input) => {
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
