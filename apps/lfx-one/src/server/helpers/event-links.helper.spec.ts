// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { documentBaseUrl, extractPageLinks, resolveRegistrationUrl, scanPageLinks, verifyPageLink } from './event-links.helper';

const BASE_URL = 'https://example.com/events/kubecon';

describe('extractPageLinks', () => {
  it('collects absolute and relative anchor hrefs', () => {
    const html = `<a href="/agenda/">Agenda</a><a href="https://other.example/cfp">CFP</a>`;
    const links = extractPageLinks(html, BASE_URL);
    expect(links.has('https://example.com/agenda')).toBe(true);
    expect(links.has('https://other.example/cfp')).toBe(true);
  });

  // The key is tolerant so matching works; the value is exact because it is what gets emailed.
  it("maps the tolerant key to the page's own href", () => {
    const links = extractPageLinks(`<a href="/agenda/">Agenda</a>`, BASE_URL);
    expect(links.get('https://example.com/agenda')).toBe('https://example.com/agenda/');
  });

  it('ignores non-http(s) hrefs', () => {
    const html = `<a href="mailto:hi@example.com">Mail</a><a href="javascript:alert(1)">X</a><a href="tel:+15550100">Call</a>`;
    expect(extractPageLinks(html, BASE_URL).size).toBe(0);
  });

  it('keeps the query string AND the fragment in the key', () => {
    // The fragment is part of the key now. Dropping it merged distinct destinations on one page:
    // `#agenda` and `#cfp` collapsed to a single entry, so verification returned whichever
    // anchor came first and a generated email sent readers to the wrong section.
    const links = extractPageLinks(`<a href="/agenda?day=2#morning">Day 2</a>`, BASE_URL);

    expect(links.has('https://example.com/agenda?day=2#morning')).toBe(true);
  });

  it('keeps two fragments on one page apart', () => {
    const links = extractPageLinks(`<a href="/info#agenda">A</a><a href="/info#cfp">C</a>`, BASE_URL);

    expect(verifyPageLink('https://example.com/info#cfp', links, BASE_URL)).toBe('https://example.com/info#cfp');
    expect(verifyPageLink('https://example.com/info#agenda', links, BASE_URL)).toBe('https://example.com/info#agenda');
  });

  it('resolves a fragment-less candidate only when one fragment link matches', () => {
    // The page links `/agenda#schedule` and a model writes `/agenda`: one destination, so it
    // resolves. Two fragments under the same path mean no single destination `/agenda` names, and
    // picking one would send readers to a section nobody chose.
    const one = extractPageLinks(`<a href="/agenda#schedule">S</a>`, BASE_URL);
    expect(verifyPageLink('https://example.com/agenda', one, BASE_URL)).toBe('https://example.com/agenda#schedule');

    const two = extractPageLinks(`<a href="/agenda#day1">1</a><a href="/agenda#day2">2</a>`, BASE_URL);
    expect(verifyPageLink('https://example.com/agenda', two, BASE_URL), 'an ambiguous fallback picked a section nobody chose').toBe('');
  });

  it('ignores anchors inside comments, scripts and styles', () => {
    // Scanning the raw source treated inert text as markup, so a commented-out or
    // script-embedded anchor entered the map and `verifyPageLink` vouched for a destination the
    // page does not link to at all.
    const html =
      `<!-- <a href="https://evil.example/fake">x</a> -->` +
      `<script>var s = '<a href="https://evil.example/js">y</a>';</script>` +
      `<style>/* <a href="https://evil.example/css">z</a> */</style>` +
      `<a href="/real">Agenda</a>`;

    const links = extractPageLinks(html, BASE_URL);

    expect(links.size, 'an anchor a browser never renders was collected').toBe(1);
    expect(verifyPageLink('https://evil.example/fake', links, BASE_URL)).toBe('');
    expect(verifyPageLink('https://example.com/real', links, BASE_URL)).toBe('https://example.com/real');
  });

  it('accepts an unquoted href', () => {
    // HTML permits `href=/agenda`. Requiring quotes dropped a real event link -- rejecting the
    // page's own destination is the same failure as accepting a forged one, just quieter.
    const links = extractPageLinks(`<a href=/agenda>Agenda</a>`, BASE_URL);

    expect(verifyPageLink('https://example.com/agenda', links, BASE_URL)).toBe('https://example.com/agenda');
  });

  it('keeps the first href when two hrefs share one key', () => {
    const links = extractPageLinks(`<a href="/agenda/">A</a><a href="/agenda">B</a>`, BASE_URL);
    expect(links.size).toBe(1);
    expect(links.get('https://example.com/agenda')).toBe('https://example.com/agenda/');
  });

  // `userinfo` is discarded because the href is rebuilt from the parsed parts, not passed through.
  it('drops userinfo from the stored href', () => {
    const links = extractPageLinks(`<a href="https://evil.example@example.com/agenda">A</a>`, BASE_URL);
    expect(links.get('https://example.com/agenda')).toBe('https://example.com/agenda');
  });

  it('reads hrefs when other attributes come first', () => {
    const html = `<a class="btn" data-x="1" href="/venue/">Venue</a>`;
    expect(extractPageLinks(html, BASE_URL).has('https://example.com/venue')).toBe(true);
  });

  it('returns an empty map for markup with no anchors', () => {
    expect(extractPageLinks('<p>Nothing here</p>', BASE_URL).size).toBe(0);
  });

  it('does not throw on an unparsable base URL', () => {
    expect(() => extractPageLinks('<a href="/agenda/">A</a>', 'not-a-url')).not.toThrow();
  });
});

describe('extractPageLinks — malformed and hostile markup', () => {
  // `[^>]*` let each `<a` scan to the end of the document before failing, so a page of repeated
  // `<a ` was QUADRATIC: 115ms at 20k tags, 454ms at 40k, 8.5s at 80k, against a 5 MiB fetch cap.
  // `matchAll` is synchronous and runs inside the scrape generator on an operator-supplied URL,
  // so that froze the single-threaded SSR process. The bound is `[^<>]*`.
  it('stays linear on a page of unclosed anchors', () => {
    const html = '<a '.repeat(80_000);

    const started = Date.now();
    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');
    const elapsed = Date.now() - started;

    expect(links.size).toBe(0);
    // Two orders of magnitude of headroom over the fixed cost, and three under the 8.5s the
    // unbounded pattern took at this size -- so this fails loudly if the bound is ever relaxed.
    expect(elapsed).toBeLessThan(500);
  });

  // The inert-region blanker had the SAME quadratic shape the anchor bound above fixed, and the
  // anchor test did not cover it: a lazy `[\s\S]*?` runs to the end of the input for every opener
  // with no closer. Measured on the regex version: 20k chars 19ms, 40k 75ms, 80k 297ms, 160k
  // 1250ms -- a clean 4x per doubling against a 5 MiB cap. It is an `indexOf` scan now, so each
  // opener is consumed once.
  it.each([
    ['comment openers', '<!--'],
    ['script openers', '<script>'],
    ['style openers', '<style>'],
  ])('stays linear on a page of unclosed %s', (_label, unit) => {
    const html = unit.repeat(Math.floor(160_000 / unit.length));

    const started = Date.now();
    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');
    const elapsed = Date.now() - started;

    expect(links.size).toBe(0);
    // An order of magnitude under the 1250ms the regex version took at this size, so relaxing it
    // back to a lazy quantifier fails here loudly.
    expect(elapsed).toBeLessThan(300);
  });

  // The unclosed-opener specs above passed while CLOSED regions were still quadratic: re-searching
  // all three kinds from the cursor on every region made a document of k closed regions O(n*k),
  // because a kind with no remaining opener scanned to the end of the input each time. Measured
  // before the opener cache: 70k chars 365ms, 140k 1442ms, 280k 5741ms. Now 5ms at 280k.
  it.each([
    ['closed comments', '<!---->'],
    ['closed scripts', '<script></script>'],
    ['closed styles', '<style></style>'],
  ])('stays linear on a page of %s', (_label, unit) => {
    const html = unit.repeat(Math.floor(560_000 / unit.length));

    const started = Date.now();
    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');
    const elapsed = Date.now() - started;

    expect(links.size).toBe(0);
    // 560k is 4x the size at which the uncached scan already took 1.4s, so a regression here is
    // measured in seconds and cannot hide under this bound.
    expect(elapsed).toBeLessThan(300);
  });

  // `toLowerCase()` lower-cases the WHOLE document and some characters change length doing so --
  // `İ` (U+0130) becomes two code units -- so every later offset drifted relative to the original.
  // The blanked span landed in the wrong place: a real link was dropped, and an attacker-controlled
  // prefix could shift a blank region off its script onto live markup. LF runs İstanbul events.
  it('keeps offsets aligned when the page contains a length-changing character', () => {
    const html = 'İİİİİ<script>x</script><a href="https://events.linuxfoundation.org/real">Real</a>';

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect([...links.values()], 'a length-changing character shifted the blanked region off its script').toEqual(['https://events.linuxfoundation.org/real']);
  });

  it('still blanks a script that follows a length-changing character', () => {
    // The other direction of the same drift: the region must not slide OFF the script either, or a
    // decoy inside it becomes a link the page is said to carry.
    const html = 'İ<script><a href="https://evil.example/fake">x</a></script><a href="https://events.linuxfoundation.org/real">Real</a>';

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect([...links.values()], 'a decoy inside a script was collected').toEqual(['https://events.linuxfoundation.org/real']);
  });

  it.each([
    ['comment', '<!--'],
    ['script', '<script>'],
    ['style', '<style>'],
  ])('ignores anchors after an unterminated %s, as a browser does', (_label, opener) => {
    // An unterminated opener swallows the rest of the document in a browser, so nothing after it
    // is a link the page shows. Stopping at the opener instead left every later anchor in the map
    // and `verifyPageLink` vouched for destinations the page never renders.
    const html = `<a href="https://events.linuxfoundation.org/real">Real</a>${opener}<a href="https://evil.example/fake">Fake</a>`;

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect([...links.values()]).toEqual(['https://events.linuxfoundation.org/real']);
  });

  it('closes a script whose end tag carries trailing characters', () => {
    // A browser ends the element at the tag NAME, so `</script >` closes it. Requiring the exact
    // `</script>` left the rest of the document inert and dropped every real link after it.
    const html = `<script><a href="https://evil.example/fake">x</a></script ><a href="https://events.linuxfoundation.org/real">Real</a>`;

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect([...links.values()]).toEqual(['https://events.linuxfoundation.org/real']);
  });

  it('treats an element that merely starts with a reserved name as ordinary markup', () => {
    // `<scriptfoo>` is an unknown element a browser renders normally. Matching the opener as a bare
    // prefix blanked from there to the end of the document, so every real link after it vanished.
    const html = `<scriptfoo><a href="https://events.linuxfoundation.org/real">Real</a>`;

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect([...links.values()], 'an unknown element was treated as a script').toEqual(['https://events.linuxfoundation.org/real']);
  });

  // The closer needs the same tag-name boundary as the opener. A browser ends script data only at
  // `</script` followed by whitespace, `/` or `>`, so `</scriptfoo>` is still script TEXT -- and
  // ending the region there exposed the decoy after it as a page link. Both directions are pinned:
  // the decoy stays inert, AND the real closer after it still ends the region.
  it.each([
    ['script', '<script>', '</scriptfoo>', '</script>'],
    ['style', '<style>', '</stylefoo>', '</style>'],
    ['upper-case script', '<SCRIPT>', '</SCRIPTFOO>', '</SCRIPT>'],
  ])('keeps a %s open past a closer that merely starts with its name', (_label, open, fakeClose, realClose) => {
    const html = `${open}${fakeClose}<a href="https://evil.example/fake">x</a>${realClose}<a href="https://events.linuxfoundation.org/real">Real</a>`;

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect([...links.values()], 'a prefix closer ended the region early').toEqual(['https://events.linuxfoundation.org/real']);
  });

  it.each([
    ['a slash', '</script/>'],
    ['a newline', '</script\n>'],
  ])('still closes a script on a real closer followed by %s', (_label, close) => {
    const html = `<script>var a = 1;${close}<a href="https://events.linuxfoundation.org/real">Real</a>`;

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect([...links.values()]).toEqual(['https://events.linuxfoundation.org/real']);
  });

  it('treats a closer cut off at the end of the input as closing the region', () => {
    // A `</script` cut off at end of input: the closer's name ends at EOF. The real
    // link BEFORE the script must survive and the decoy inside it must not.
    const html = `<a href="https://events.linuxfoundation.org/real">Real</a><script><a href="https://evil.example/fake">x</a></script`;

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect([...links.values()]).toEqual(['https://events.linuxfoundation.org/real']);
  });

  it('stays linear on many prefix closers inside one script', () => {
    const html = `<script>${'</scriptx'.repeat(40_000)}</script><a href="https://events.linuxfoundation.org/real">Real</a>`;

    const started = performance.now();
    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');
    const elapsed = performance.now() - started;

    expect([...links.values()]).toEqual(['https://events.linuxfoundation.org/real']);
    expect(elapsed, `${elapsed.toFixed(0)}ms`).toBeLessThan(500);
  });

  // `\b` matches between `a` and the HYPHEN of a custom element, so `<a-button href=...>` was
  // collected as an anchor and `verifyPageLink` then vouched for a URL no `<a>` on the page
  // carries. A custom element must contain a hyphen by spec, so this is reachable on any
  // component-built event page. `<article>` was never affected -- `\b` does not match between two
  // letters -- so the fix is a tag-name DELIMITER, not a longer list of element names.
  it.each([
    ['a hyphenated custom element', '<a-button href="https://evil.example/fake">x</a-button>'],
    ['a namespaced element', '<a-link href="https://evil.example/fake">x</a-link>'],
  ])('ignores %s that merely starts with the anchor name', (_label, decoy) => {
    const html = `${decoy}<a href="https://events.linuxfoundation.org/real">Real</a>`;

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect([...links.values()], 'a custom element was read as an anchor').toEqual(['https://events.linuxfoundation.org/real']);
  });

  it.each([
    ['a space', '<a href="https://events.linuxfoundation.org/real">Real</a>'],
    ['a newline', '<a\nhref="https://events.linuxfoundation.org/real">Real</a>'],
    ['a self-closing slash', '<a/href="https://events.linuxfoundation.org/real">Real</a>'],
    ['an immediate close', '<a href="https://events.linuxfoundation.org/real" >Real</a>'],
  ])('still reads a real anchor delimited by %s', (_label, html) => {
    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect([...links.values()], 'a legitimate anchor was rejected').toEqual(['https://events.linuxfoundation.org/real']);
  });

  it('stays linear on a page of unclosed custom elements', () => {
    // The delimiter is a zero-width lookahead, so the `[^<>]*` bound that made this linear in
    // round 1 still applies. Pinned so a future delimiter change cannot quietly consume a
    // character and reopen the backtracking.
    const html = '<a-'.repeat(80_000);

    const started = Date.now();
    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');
    const elapsed = Date.now() - started;

    expect(links.size).toBe(0);
    expect(elapsed).toBeLessThan(500);
  });

  it('reads the real href when the decoy is hidden behind MISMATCHED quotes', () => {
    // A pattern like `["']([^"']*)["']` lets the opening and closing quote differ, so `title="x'`
    // closes on the apostrophe and the scan resumes inside the title -- where the decoy then
    // matches as a real `href` attribute. The three alternations each pin their own quote
    // character, so the title's value is consumed as one unit.
    const html = `<a title="x' href='https://evil.example/agenda'" href="/real">Agenda</a>`;

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect([...links.values()], "a decoy behind mismatched quotes was read as the page's link").toEqual(['https://events.linuxfoundation.org/real']);
  });

  it('reads the real href, not one hidden inside another attribute value', () => {
    // A regex that scans the tag for `href=` finds it inside ANOTHER attribute's value, because
    // the quotes around that value are just characters to it. `verifyPageLink` would then vouch
    // for a URL the page never links to, carrying it into the brief as the event's agenda.
    const html = `<a title=" href='https://evil.example/agenda'" href="https://events.linuxfoundation.org/real">Agenda</a>`;

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect(verifyPageLink('https://events.linuxfoundation.org/real', links, 'https://events.linuxfoundation.org/')).toBe(
      'https://events.linuxfoundation.org/real'
    );
    expect(verifyPageLink('https://evil.example/agenda', links, 'https://events.linuxfoundation.org/')).toBe('');
  });

  it('takes the first href when a tag declares two, as a browser does', () => {
    const html = `<a href="https://events.linuxfoundation.org/first" href="https://evil.example/second">Agenda</a>`;

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect(verifyPageLink('https://evil.example/second', links, 'https://events.linuxfoundation.org/')).toBe('');
  });

  it('decodes an &amp; in an href so a multi-parameter link still compares equal', () => {
    // The page writes `&amp;`; the extraction model returns the decoded `&`. Stored raw, the two
    // never compared equal and a real agenda link with two query parameters was dropped.
    const html = '<a href="https://events.linuxfoundation.org/a?x=1&amp;y=2">Agenda</a>';

    const links = extractPageLinks(html, 'https://events.linuxfoundation.org/');

    expect(verifyPageLink('https://events.linuxfoundation.org/a?x=1&y=2', links, 'https://events.linuxfoundation.org/')).toBe(
      'https://events.linuxfoundation.org/a?x=1&y=2'
    );
  });

  it('ignores data-href, which is not the link the page renders', () => {
    // `\bhref=` also matches the tail of `data-href`, so a framework's lazy-load attribute was
    // read as the destination.
    const html = '<a data-href="https://evil.example/phish">Agenda</a>';

    expect(extractPageLinks(html, 'https://events.linuxfoundation.org/').size).toBe(0);
  });

  it('stops collecting at the link cap', () => {
    const html = Array.from({ length: 5_050 }, (_unused, i) => `<a href="https://events.linuxfoundation.org/p/${i}">x</a>`).join('');

    expect(extractPageLinks(html, 'https://events.linuxfoundation.org/').size).toBe(5_000);
  });
});

describe('extractPageLinks — links a browser does not render (tokenized, not scanned)', () => {
  const REAL = '<a href="https://events.linuxfoundation.org/real">Real</a>';
  const base = 'https://events.linuxfoundation.org/';

  // Each of these was reproduced against the hand-rolled scanner after #3220 merged. The parser
  // answers them by construction; the table pins that a regression back to scanning would fail.
  it.each([
    ['an href inside a framework attribute value', `<a @click="go href='https://evil.example/at'" href="https://events.linuxfoundation.org/real">Real</a>`],
    ['an href inside a bound attribute value', `<a :title="' href=https://evil.example/t'" href="https://events.linuxfoundation.org/real">Real</a>`],
    ["anchor markup inside another tag's attribute", `<div title="<a href='https://evil.example/attr'>">x</div>${REAL}`],
    ['an anchor inside <textarea>', `<textarea><a href="https://evil.example/ta">x</a></textarea>${REAL}`],
    ['an anchor inside <title>', `<title><a href="https://evil.example/title"></a></title>${REAL}`],
    ['an anchor inside <noscript>', `<noscript><a href="https://evil.example/ns">x</a></noscript>${REAL}`],
    ['an anchor inside <xmp>', `<xmp><a href="https://evil.example/xmp">x</a></xmp>${REAL}`],
    ['an anchor inside <template>', `<template><a href="https://evil.example/tpl">x</a></template>${REAL}`],
    ['an anchor inside a <? bogus comment', `<? <a href="https://evil.example/pi"> ?>${REAL}`],
    ['an anchor inside a <!x bogus comment', `<!x <a href="https://evil.example/bang">>${REAL}`],
    ['a tag name joined by U+00A0, which is not HTML whitespace', `<a\u00a0href="https://evil.example/nbsp">x</a>${REAL}`],
    // A self-closing slash is IGNORED on a non-void HTML element: `<textarea/>` still opens one.
    ['a self-closed <textarea/>', `<textarea/><a href="https://evil.example/ta">x</a></textarea>${REAL}`],
    ['a self-closed <script/>', `<script/><a href="https://evil.example/s">x</a></script>${REAL}`],
    ['a self-closed <title/>', `<title/><a href="https://evil.example/t">x</a></title>${REAL}`],
    ['a self-closed <iframe/>', `<iframe/><a href="https://evil.example/if">x</a></iframe>${REAL}`],
    ['a self-closed <template/>', `<template/><a href="https://evil.example/tpl">x</a></template>${REAL}`],
    // Reproduced against the previous revision of this scanner (fail-OPEN), each now inert.
    ['a template closer written inside an <iframe> in a template', `<template><iframe></template><a href="https://evil.example/a"></iframe></template>${REAL}`],
    [
      'a template closer inside a self-closed <textarea/> in a template',
      `<template><textarea/></template><a href="https://evil.example/a"></textarea></template>${REAL}`,
    ],
    ['<plaintext> inside a template', `${REAL}<template><plaintext></template><a href="https://evil.example/a">`],
    [
      'a declarative shadow root (validity depends on the host)',
      `<div><template shadowrootmode="open"><a href="https://evil.example/a"></template></div>${REAL}`,
    ],
    ['a shadow root nested in a template', `<template><template shadowrootmode="open"></template><a href="https://evil.example/a"></template>${REAL}`],
    ['a closer with a space after </, which is a bogus comment', `<iframe></ iframe><a href="https://evil.example/a"></iframe>${REAL}`],
    ['a template closer with a space after </', `<template></ template><a href="https://evil.example/a"></template>${REAL}`],
    ['a self-closed <script/> after a self-closed <svg/>', `<svg/><script src="a.js"/><a href="https://evil.example/a"></script>${REAL}`],
    ['a self-closed <script/> after </svg/>', `<svg></svg/><script src="a.js"/><a href="https://evil.example/a"></script>${REAL}`],
    ['a self-closed <textarea/> after an SVG breakout', `<svg><p><textarea/><a href="https://evil.example/a"></textarea>${REAL}`],
  ])('ignores %s', (_label, html) => {
    expect([...extractPageLinks(html, base).values()]).toEqual(['https://events.linuxfoundation.org/real']);
  });

  it('treats the rest of the page as inert after a double-escaped script', () => {
    // In a browser `<!--<script>` inside script data can run past the first `</script>`; the
    // tokenizer ends there. Unmodelled, so fail safe: nothing after it is kept.
    const html = `${REAL}<script><!--<script></script><a href="https://evil.example/a">--></script>`;

    expect([...extractPageLinks(html, base).values()]).toEqual(['https://events.linuxfoundation.org/real']);
  });

  it.each([
    ['a numeric entity', '<a href="&#47;agenda">Agenda</a>', 'https://events.linuxfoundation.org/agenda'],
    ['an upper-case named entity', '<a href="/agenda?day=2&AMP;track=main">Agenda</a>', 'https://events.linuxfoundation.org/agenda?day=2&track=main'],
  ])('decodes %s in a real href rather than keeping it literal', (_label, html, expected) => {
    expect([...extractPageLinks(html, base).values()]).toEqual([expected]);
  });

  it.each([
    [
      'a named entity outside the old six',
      '<a href="https&colon;//events.linuxfoundation.org/agenda">A</a>',
      'https&colon;//events.linuxfoundation.org/agenda',
    ],
    ['a legacy entity with no semicolon', '<a href="/agenda?a=1&copy=2">A</a>', '/agenda?a=1&copy=2'],
  ])("decodes a candidate with the tokenizer's own decoder: %s", (_label, html, candidate) => {
    // A narrower decoder on the candidate side rejected genuine page links the parser had decoded.
    const links = extractPageLinks(html, base);

    expect(verifyPageLink(candidate, links, base), 'a real page link was rejected').not.toBe('');
  });

  it('returns links and base from one pass, matching the separate helpers', () => {
    const html = '<base href="/kubecon-eu/"><a href="agenda">Agenda</a>';
    const both = scanPageLinks(html, 'https://events.example.org/kubecon-eu');

    expect([...both.links.values()]).toEqual([...extractPageLinks(html, 'https://events.example.org/kubecon-eu').values()]);
    expect(both.baseUrl).toBe(documentBaseUrl(html, 'https://events.example.org/kubecon-eu'));
  });

  it("verifies a model candidate written with the page's entities against the decoded link", () => {
    const links = extractPageLinks('<a href="/agenda?day=2&amp;track=main">Agenda</a>', base);

    expect(verifyPageLink('/agenda?day=2&amp;track=main', links, base)).toBe('https://events.linuxfoundation.org/agenda?day=2&track=main');
  });

  // Sized at the 5 MiB fetch cap, and HOSTILE rather than well-formed: a tree builder's open-element
  // stack made each of these quadratic (parse5: 400 KB of unclosed <div> took 20 s). This runs
  // synchronously on the SSR process, so the bound is the property, not a nicety.
  const CAP = 5 * 1024 * 1024;
  const fill = (unit: string): string => unit.repeat(Math.floor(CAP / unit.length));
  it.each([
    ['unclosed nesting', () => fill('<div>')],
    ['unclosed formatting elements', () => fill('<b>')],
    ['unmatched end tags over a deep stack', () => `${'<span>'.repeat(CAP / 12)}${'</q>'.repeat(CAP / 8)}`],
    ['one tag with a huge number of attributes', () => `<a href="/x" ${Array.from({ length: CAP / 8 }, (_unused, i) => `a${i}`).join(' ')}>`],
    ['many closed comments', () => fill('<!---->')],
    ['many unclosed openers', () => fill('<!--')],
  ])('stays linear on %s at the fetch cap', (_label, build) => {
    const html = `${build()}${REAL}`;

    const started = performance.now();
    extractPageLinks(html, base);
    const elapsed = performance.now() - started;

    expect(elapsed, `${html.length} chars in ${elapsed.toFixed(0)}ms`).toBeLessThan(3_000);
  });

  it.each([
    ['an iframe', `<iframe><a href="https://evil.example/if">x</a></iframe>${REAL}`],
    ['everything after <plaintext>', `${REAL}<plaintext><a href="https://evil.example/pt">x</a>`],
  ])('ignores anchors inside %s', (_label, html) => {
    expect([...extractPageLinks(html, base).values()]).toEqual(['https://events.linuxfoundation.org/real']);
  });

  // The fail-SAFE direction: these drop nothing a browser renders.
  it.each([
    ['an inert closer written with a slash', `<iframe>x</iframe/>${REAL}`],
    ['a template closer written with a slash', `<template>x</template/>${REAL}`],
    ['a nested iframe, which raw text does not nest', `<iframe><iframe></iframe>${REAL}`],
    ['an unclosed <math>', `<math><mi>x</mi><p>${REAL}`],
    ['a self-closed SVG shape', `<svg><path d="M0 0"/></svg>${REAL}`],
  ])('keeps a real link after %s', (_label, html) => {
    expect([...extractPageLinks(html, base).values()]).toEqual(['https://events.linuxfoundation.org/real']);
  });

  it('honours a <base> after a self-closed <svg/>, which leaves no svg open', () => {
    // Counted as an open <svg>, it never closed, and every later <base> was ignored.
    expect(documentBaseUrl('<svg/><base href="/sub/"><a href="agenda">x</a>', 'https://events.example.org/e')).toBe('https://events.example.org/sub/');
  });

  it('does not take a <base> inside <svg> as the document base', () => {
    expect(documentBaseUrl('<svg><base href="https://evil.example/"/></svg><a href="agenda">x</a>', 'https://events.example.org/e/')).toBe(
      'https://events.example.org/e/'
    );
  });

  it('reads an SVG anchor by its plain href, not xlink:href, as an SVG2 browser follows it', () => {
    const html = '<svg><a xlink:href="https://evil.example/x" href="https://events.linuxfoundation.org/real"><text>x</text></a></svg>';

    expect([...extractPageLinks(html, base).values()]).toEqual(['https://events.linuxfoundation.org/real']);
  });

  it('resolves relative links against the document <base href>, as a browser does', () => {
    // A sub-path deployment served without its trailing slash: resolving against the request URL
    // turned `agenda` into `/agenda`, a 404 inside a sent email.
    const html = '<head><base href="/kubecon-eu/"></head><a href="agenda">Agenda</a>';

    expect([...extractPageLinks(html, 'https://events.example.org/kubecon-eu').values()]).toEqual(['https://events.example.org/kubecon-eu/agenda']);
    expect(documentBaseUrl(html, 'https://events.example.org/kubecon-eu')).toBe('https://events.example.org/kubecon-eu/');
  });

  it.each([
    ['no <base>', '<a href="agenda">x</a>'],
    ['a non-http(s) <base>', '<base href="javascript:alert(1)"><a href="agenda">x</a>'],
    ['a <base> inside <template>', '<template><base href="https://evil.example/"></template><a href="agenda">x</a>'],
  ])('falls back to the request URL with %s', (_label, html) => {
    expect(documentBaseUrl(html, 'https://events.example.org/e/')).toBe('https://events.example.org/e/');
  });
});

describe('verifyPageLink', () => {
  const html = `<a href="/agenda/">Agenda</a><a href="https://example.com/sponsor-us">Sponsor</a><a href="https://other.example/cfp">CFP</a>`;
  const links = extractPageLinks(html, BASE_URL);

  // The page published `/agenda/`; the candidate omits the slash. What comes back is the PAGE's
  // form, because that is the URL the page sends its own readers to.
  it("returns the page's own href rather than the normalized key", () => {
    expect(verifyPageLink('https://example.com/agenda', links, BASE_URL)).toBe('https://example.com/agenda/');
  });

  it('accepts a relative candidate by resolving it first', () => {
    expect(verifyPageLink('/agenda', links, BASE_URL)).toBe('https://example.com/agenda/');
  });

  it('ignores a trailing-slash or host-case difference', () => {
    expect(verifyPageLink('https://EXAMPLE.com/sponsor-us/', links, BASE_URL)).toBe('https://example.com/sponsor-us');
  });

  // The whole point of the helper: a URL the extraction composed from the site's shape.
  it('drops a plausible URL the page does not link to', () => {
    expect(verifyPageLink('https://example.com/schedule', links, BASE_URL)).toBe('');
  });

  // These two are a PAIR. The contract is page membership, not same-origin: an event page
  // legitimately links its CFP off-host, and nothing here checks the host. Deleting the first
  // test would leave the second reading like a host check that does not exist.
  it('accepts an off-host URL the page does link to', () => {
    expect(verifyPageLink('https://other.example/cfp', links, BASE_URL)).toBe('https://other.example/cfp');
  });

  it('drops an off-host URL the page does not link to', () => {
    expect(verifyPageLink('https://evil.example/agenda', links, BASE_URL)).toBe('');
  });

  it('drops a non-http(s) candidate', () => {
    expect(verifyPageLink('javascript:alert(1)', links, BASE_URL)).toBe('');
  });

  it('returns an empty string for null, a non-string, or blank input', () => {
    expect(verifyPageLink(null, links, BASE_URL)).toBe('');
    expect(verifyPageLink(42, links, BASE_URL)).toBe('');
    expect(verifyPageLink('   ', links, BASE_URL)).toBe('');
  });

  it('drops everything when the page yielded no links', () => {
    expect(verifyPageLink('https://example.com/agenda', new Map<string, string>(), BASE_URL)).toBe('');
  });
});

describe('resolveRegistrationUrl', () => {
  const page = extractPageLinks('<a href="/register">Register</a><a href="register?ref=hero&amp;src=nav#form">Hero</a>', BASE_URL);

  it('makes a relative href absolute when the page links to it', () => {
    // A page publishing `href="/register"` produced `/register`, which the brief coercer blanked
    // because it accepts only absolute URLs -- losing the registration destination entirely.
    expect(resolveRegistrationUrl('/register', page, BASE_URL)).toBe('https://example.com/register');
  });

  it('decodes an escaped ampersand in a relative href, as a verified link does', () => {
    expect(resolveRegistrationUrl('register?ref=hero&amp;src=nav#form', page, BASE_URL)).toBe('https://example.com/events/register?ref=hero&src=nav#form');
  });

  it.each([
    ['a placeholder', 'TBD'],
    ['anchor text that names a host', 'www.cvent.com/reg/1'],
    ['a relative path the page does not link to', '/invented-register'],
  ])('refuses %s instead of resolving it into a same-site URL', (_label, candidate) => {
    // Resolving every string against the page turned unverified model output into a valid-looking
    // CTA. A relative value can only have come from an href, so it is checked against the anchors.
    expect(resolveRegistrationUrl(candidate, page, BASE_URL)).toBe('');
  });

  it('keeps an absolute http(s) URL unverified, including off-site registration hosts', () => {
    // Scripted CTAs carry no `<a href>`, so verifying an absolute URL would strip working links.
    expect(resolveRegistrationUrl('https://cvent.example/kubecon?code=A&amp;b=2', new Map(), BASE_URL)).toBe('https://cvent.example/kubecon?code=A&b=2');
  });

  it('unescapes JSON-escaped slashes from a JSON-LD offers.url', () => {
    // PHP/WordPress `json_encode` writes `https:\/\/…`; copied verbatim it became `https://host//register`.
    expect(resolveRegistrationUrl('https:\\/\\/cvent.example\\/kubecon\\/register', page, BASE_URL)).toBe('https://cvent.example/kubecon/register');
  });

  it('drops a non-http(s) scheme and userinfo', () => {
    expect(resolveRegistrationUrl('javascript:alert(1)', page, BASE_URL)).toBe('');
    expect(resolveRegistrationUrl('https://evil.example@example.com/register', page, BASE_URL)).toBe('https://example.com/register');
  });

  it('returns an empty string for blank or non-string input', () => {
    expect(resolveRegistrationUrl('', page, BASE_URL)).toBe('');
    expect(resolveRegistrationUrl(null, page, BASE_URL)).toBe('');
    expect(resolveRegistrationUrl(42, page, BASE_URL)).toBe('');
  });
});
