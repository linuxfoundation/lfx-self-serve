// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { extractPageLinks, verifyPageLink } from './event-links.helper';

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
