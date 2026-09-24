// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { extractHeroAndSponsors } from './event-hero-sponsors.helper';

const BASE_URL = 'https://example.com/events/kubecon';

describe('extractHeroAndSponsors', () => {
  it('extracts the hero image from an og:image meta tag', () => {
    const html = `<html><head><meta property="og:image" content="/images/banner.jpg" /></head><body></body></html>`;
    const result = extractHeroAndSponsors(html, BASE_URL);
    expect(result.heroImageUrl).toBe('https://example.com/images/banner.jpg');
  });

  it('extracts the hero image from og:image with attributes in reverse order', () => {
    const html = `<meta content="https://cdn.example.com/hero.png" property="og:image" />`;
    const result = extractHeroAndSponsors(html, BASE_URL);
    expect(result.heroImageUrl).toBe('https://cdn.example.com/hero.png');
  });

  it('decodes HTML entities in a scraped hero URL, keeping signed query params intact', () => {
    // As it appears in real HTML SOURCE: a serializer must escape `&` inside an attribute.
    const html = `<meta property="og:image" content="https://cdn.example.com/hero.png?width=1200&amp;sig=abc123&amp;exp=99" />`;
    const result = extractHeroAndSponsors(html, BASE_URL);

    // Parsed raw, this yields a parameter literally named `amp;sig` and NO `sig`, so a signed
    // CDN image 403s and the hero silently disappears.
    expect(result.heroImageUrl).toBe('https://cdn.example.com/hero.png?width=1200&sig=abc123&exp=99');
    expect(new URL(result.heroImageUrl).searchParams.get('sig')).toBe('abc123');
  });

  it('decodes entities in sponsor logo URLs too, not just the hero', () => {
    // The decode lives in the shared resolver, so every extractor gets it -- a new one cannot
    // forget to call it.
    //
    // `alt` carries the keyword, NOT `class`: the detector tests alt/src/context and ignores
    // class entirely, so a fixture marking sponsors with class="sponsor" would match nothing.
    // Asserting the length FIRST is what stops that failing silently: an assertion behind an
    // `if (length > 0)` skips instead of failing when the fixture stops matching.
    const html = `<img src="https://cdn.example.com/logo.png?v=2&amp;token=xyz" alt="Acme &amp; Co sponsor" />`;
    const result = extractHeroAndSponsors(html, BASE_URL);

    expect(result.sponsors).toHaveLength(1);
    // The NAME is decoded too, not just the URL -- it reaches a sent email as alt text.
    expect(result.sponsors[0].name).toBe('Acme & Co sponsor');
    expect(result.sponsors[0].logoUrl).toBe('https://cdn.example.com/logo.png?v=2&token=xyz');
    expect(new URL(result.sponsors[0].logoUrl).searchParams.get('token')).toBe('xyz');
  });

  it('strips markup that decoding the sponsor name would otherwise resurrect', () => {
    // Decoding alone turns `&lt;script&gt;` back into LIVE markup, in a value that reaches a
    // sent email as an attribute -- trading a cosmetic bug for an injection one.
    const html = `<img src="https://cdn.example.com/l.png" alt="Acme &lt;script&gt;alert(1)&lt;/script&gt; sponsor" />`;
    const result = extractHeroAndSponsors(html, BASE_URL);

    expect(result.sponsors).toHaveLength(1);
    expect(result.sponsors[0].name).not.toContain('<');
    expect(result.sponsors[0].name).not.toContain('>');
  });

  it('decodes &amp; LAST so an escaped entity does not become a real one', () => {
    // `&amp;lt;` is the literal TEXT `&lt;`, not `<`. Decoding `&amp;` first would turn one
    // escaped entity into a different real one -- the classic double-decode bug.
    const html = `<meta property="og:image" content="https://cdn.example.com/a.png?q=&amp;lt;x" />`;
    const result = extractHeroAndSponsors(html, BASE_URL);
    expect(result.heroImageUrl).toContain('&lt;x');
    expect(result.heroImageUrl).not.toContain('<x');
  });

  it('falls back to JSON-LD Event.image when there is no og:image tag', () => {
    const html = `
      <script type="application/ld+json">
        { "@type": "Event", "name": "KubeCon", "image": "https://cdn.example.com/jsonld-hero.png" }
      </script>
    `;
    const result = extractHeroAndSponsors(html, BASE_URL);
    expect(result.heroImageUrl).toBe('https://cdn.example.com/jsonld-hero.png');
  });

  it('returns an empty hero image when neither og:image nor JSON-LD provide one', () => {
    const result = extractHeroAndSponsors('<html><body>no images here</body></html>', BASE_URL);
    expect(result.heroImageUrl).toBe('');
  });

  it('extracts sponsor logos by alt text keyword', () => {
    const html = `<div class="partners"><img src="/logos/acme.png" alt="Acme Corp sponsor logo" /></div>`;
    const result = extractHeroAndSponsors(html, BASE_URL);
    expect(result.sponsors).toEqual([{ name: 'Acme Corp sponsor logo', logoUrl: 'https://example.com/logos/acme.png' }]);
  });

  it('extracts sponsor logos via nearby heading context', () => {
    const html = `<h2>Our Sponsors</h2><div><img src="/logos/widgetco.png" alt="WidgetCo" /></div>`;
    const result = extractHeroAndSponsors(html, BASE_URL);
    expect(result.sponsors).toEqual([{ name: 'WidgetCo', logoUrl: 'https://example.com/logos/widgetco.png' }]);
  });

  it('ignores images unrelated to sponsors', () => {
    const html = `<img src="/nav/logo.png" alt="Site logo" />`;
    const result = extractHeroAndSponsors(html, BASE_URL);
    expect(result.sponsors).toEqual([]);
  });

  // Split in two because one fixture cannot exercise both properties without going vacuous. A
  // fixture cycling `i % 3` yields three unique URLs, so the cap is never reached; moving the
  // duplicate past the cutoff instead puts it where the extraction loop breaks before seeing it.
  // Each property gets a fixture built for it.
  it('caps the sponsor list at 10', () => {
    // 14 UNIQUE logos: more than the cap, so the cap is what decides the length.
    const html = `<h2>Sponsors</h2>${Array.from({ length: 14 }, (_, i) => `<img src="/sponsors/s${i}.png" alt="Sponsor ${i}" />`).join('')}`;

    const result = extractHeroAndSponsors(html, BASE_URL);

    // EXACTLY 10, not at-most: a raised or removed limit must fail.
    expect(result.sponsors).toHaveLength(10);
  });

  it('dedupes a repeated sponsor logo', () => {
    // Three logos, one repeated INSIDE the cap so the loop actually reaches it. Deliberately
    // fewer than MAX_SPONSORS: with more, the cap could trim the list to the expected length and
    // the assertion would pass whether or not deduping happened.
    const html = `<h2>Sponsors</h2>
      <img src="/sponsors/a.png" alt="A" />
      <img src="/sponsors/b.png" alt="B" />
      <img src="/sponsors/a.png" alt="A again" />`;

    const result = extractHeroAndSponsors(html, BASE_URL);

    expect(result.sponsors.map((s) => s.logoUrl)).toEqual(['https://example.com/sponsors/a.png', 'https://example.com/sponsors/b.png']);
  });

  it('excludes the hero image itself from the sponsor list', () => {
    const html = `<meta property="og:image" content="/sponsors/hero-sponsor.png" /><h2>Sponsors</h2><img src="/sponsors/hero-sponsor.png" alt="Sponsor Hero" />`;
    const result = extractHeroAndSponsors(html, BASE_URL);
    expect(result.sponsors).toEqual([]);
  });

  it('rejects a non-http(s) scheme smuggled into an img src', () => {
    const html = `<h2>Sponsors</h2><img src="javascript:alert(1)" alt="sponsor" />`;
    const result = extractHeroAndSponsors(html, BASE_URL);
    expect(result.sponsors).toEqual([]);
  });

  it('never throws on malformed JSON-LD', () => {
    const html = `<script type="application/ld+json">{ not valid json </script>`;
    expect(() => extractHeroAndSponsors(html, BASE_URL)).not.toThrow();
  });

  it('returns empty results for a page with no matches', () => {
    const result = extractHeroAndSponsors('<html><body><p>Nothing here</p></body></html>', BASE_URL);
    expect(result).toEqual({ heroImageUrl: '', sponsors: [] });
  });
});

describe('extractHeroAndSponsors — SSRF', () => {
  // Scraped image URLs are persisted on the brief and forwarded to campaign-service, which
  // FETCHES the hero and re-hosts it as a publicly readable file. A protocol-only check let
  // `http://169.254.169.254/` reach that path: second-order SSRF, where the request is issued by
  // a service the scraped page never talked to.
  it.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data'],
    ['loopback', 'http://127.0.0.1/hero.png'],
    ['localhost', 'http://localhost:8080/hero.png'],
    ['rfc1918 ten', 'http://10.0.0.5/hero.png'],
    ['rfc1918 192.168', 'http://192.168.1.10/hero.png'],
    ['rfc1918 172.16', 'http://172.16.0.9/hero.png'],
    ['ipv6 loopback', 'http://[::1]/hero.png'],
    // The same address in another spelling. A pattern match on the raw host misses these, which
    // is why the host is normalized before it is judged.
    ['ipv4-mapped metadata', 'http://[::ffff:169.254.169.254]/latest/meta-data'],
    ['ipv4-mapped metadata, expanded', 'http://[0:0:0:0:0:ffff:169.254.169.254]/latest/meta-data'],
    ['ipv6 link-local', 'http://[fe80::1]/hero.png'],
    ['ipv6 unique-local', 'http://[fd00::1]/hero.png'],
    ['carrier-grade nat', 'http://100.64.0.1/hero.png'],
    ['this-host', 'http://0.0.0.0/hero.png'],
  ])('drops a hero image pointing at %s', (_label, url) => {
    const html = `<meta property="og:image" content="${url}" />`;

    expect(extractHeroAndSponsors(html, 'https://events.example/kubecon').heroImageUrl).toBe('');
  });

  it('drops a sponsor logo pointing at a private address while keeping the public ones', () => {
    const html = `<h2>Sponsors</h2>
      <img src="http://169.254.169.254/logo.png" alt="internal" />
      <img src="https://cdn.example.com/acme.png" alt="Acme" />`;

    const logos = extractHeroAndSponsors(html, 'https://events.example/kubecon').sponsors.map((s) => s.logoUrl);

    expect(logos).not.toContain('http://169.254.169.254/logo.png');
    expect(logos).toContain('https://cdn.example.com/acme.png');
  });

  it('still accepts an ordinary public image host', () => {
    const html = `<meta property="og:image" content="https://cdn.example.com/hero.png" />`;

    expect(extractHeroAndSponsors(html, 'https://events.example/kubecon').heroImageUrl).toBe('https://cdn.example.com/hero.png');
  });
});

describe('extractHeroAndSponsors — URL canonicalization', () => {
  // The helper resolved against the base URL and returned `resolved.toString()`, keeping
  // userinfo that the controller and the preview both strip — so a scraped credentialed image
  // URL was persisted onto the brief and travelled from there into a sent email.
  it('strips userinfo from a scraped hero image URL', () => {
    const html = `<meta property="og:image" content="https://user:secret@cdn.example.com/hero.png" />`;

    const result = extractHeroAndSponsors(html, BASE_URL);

    expect(result.heroImageUrl).toBe('https://cdn.example.com/hero.png');
    expect(result.heroImageUrl).not.toContain('secret');
  });

  it('still resolves a RELATIVE src against the page, which is why this path cannot just call the validator', () => {
    const html = `<meta property="og:image" content="/img/hero.png" />`;

    expect(extractHeroAndSponsors(html, BASE_URL).heroImageUrl).toBe('https://example.com/img/hero.png');
  });
  /**
   * A sponsor image with no usable `alt` falls back to a name derived from its URL, and that
   * name is forwarded as recipient-visible alt text in the sent email. Deriving it from the
   * whole URL therefore put a scraped signed URL's credentials into everyone's inbox:
   * `logo.png?X-Amz-Credential=AKIA...&X-Amz-Signature=...` became the sponsor NAME.
   *
   * Asserting on the absence of the credential rather than only on the happy-path string,
   * because a future change that reintroduces the query would still produce a name starting
   * with "acme logo" and pass a naive equality check on a prefix.
   */
  it('derives a fallback sponsor name from the PATH only, never a signed URL query', () => {
    const signed = 'https://cdn.example.com/logos/acme-logo.png?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE&X-Amz-Signature=deadbeef';
    const html = `<div class="partners"><h2>Our Sponsors</h2><img src="${signed}" alt="" /></div>`;

    const [sponsor] = extractHeroAndSponsors(html, BASE_URL).sponsors;

    expect(sponsor.name).toBe('acme logo');
    expect(sponsor.name).not.toContain('AKIA');
    expect(sponsor.name).not.toContain('Signature');
    // The extension strip only worked once the query was gone: with it attached, the `\.[a-z0-9]+$`
    // anchor matched nothing and the name kept its `.png` as well.
    expect(sponsor.name).not.toContain('.png');
    // The logo URL itself is untouched -- the query is load-bearing for FETCHING a signed asset.
    expect(sponsor.logoUrl).toBe(signed);
  });

  it('falls back to a generic name rather than a best-effort substring when the URL will not parse', () => {
    const html = `<div class="partners"><h2>Our Sponsors</h2><img src="https://cdn.example.com/logos/" alt="" /></div>`;

    const sponsors = extractHeroAndSponsors(html, BASE_URL).sponsors;

    // Either dropped or named generically -- never named after a URL fragment.
    for (const sponsor of sponsors) {
      expect(sponsor.name).toBe('Sponsor');
    }
  });
  /**
   * The percent-decode that keeps the name readable is also what makes sanitizing it necessary:
   * `%E2%80%AE` is a RIGHT-TO-LEFT OVERRIDE, so a crafted filename can render as something other
   * than what it contains -- the same display spoof `sanitizeDisplayText` was added to stop on
   * the `alt` path, arriving through the filename instead. Decoding without re-sanitizing trades
   * one bug for another.
   */
  it('sanitises the fallback name it decodes, not just the alt text', () => {
    const html = `<div class="partners"><h2>Our Sponsors</h2><img src="https://cdn.example.com/logos/%E2%80%AEevil%20gnp.png" alt="" /></div>`;

    const [sponsor] = extractHeroAndSponsors(html, BASE_URL).sponsors;

    expect(sponsor.name).not.toContain('\u202E');
    expect(sponsor.name).not.toContain('\u202D');
  });
});

/**
 * A scraped page is attacker-controlled input, and these extractors run on the SSR event loop.
 * The og:image pattern used to carry two unbounded `[^>]+`/`[^>]*` runs that both had to match
 * before the engine could conclude failure, so input that never supplies a closing `>` backtracked
 * quadratically: measured at 4x per doubling from 16 KiB (18 ms) to 256 KiB (4.4 s), which
 * extrapolates to roughly 28 minutes at the 5 MiB `MAX_RESPONSE_BYTES` ceiling that `fetchSafeUrl`
 * permits. One event URL would have hung the server for every user.
 *
 * These assert the BOUND, not a wall-clock number a slow CI box could flake on: the guard is that
 * cost grows linearly, so a 4x bigger page costs ~4x rather than ~16x.
 */
describe('extractHeroAndSponsors — runs linearly on adversarial HTML', () => {
  function timeMs(html: string): number {
    const started = process.hrtime.bigint();
    extractHeroAndSponsors(html, BASE_URL);
    return Number(process.hrtime.bigint() - started) / 1e6;
  }

  it('reads the sponsor context window from EACH image position, not the document start', () => {
    // The window is positional: an `<img>` is a sponsor because a sponsor heading sits shortly
    // BEFORE it. A scan that ignored each match's index would see the whole document as context
    // and mark every image a sponsor -- including one far below, under its own heading.
    //
    // This is what makes `openTags` return an index rather than just the tag text.
    const html =
      // NEITHER url nor alt carries a sponsor keyword, so the ONLY thing that can classify these
      // is the text shortly before each one -- which is exactly what the index is for.
      '<h2>Our Sponsors</h2><img src="https://cdn.example.com/a.png" alt="Acme" />' +
      `${'<p>filler</p>'.repeat(120)}` +
      '<h2>Speakers</h2><img src="https://cdn.example.com/b.png" alt="Jane" />';

    const names = extractHeroAndSponsors(html, BASE_URL).sponsors.map((s) => s.name);

    expect(names).toContain('Acme');
    expect(names).not.toContain('Jane');
  });

  it('extracts a sponsor: name from alt, logo canonicalized', () => {
    // The end-to-end case this file lacked -- the hero-image cases above never assert that a
    // sponsor comes back at all, only that one is not mistaken for the hero.
    const html = '<div class="sponsors"><img src="https://cdn.example.com/acme.png" alt="Acme Corp" /></div>';

    const [sponsor] = extractHeroAndSponsors(html, BASE_URL).sponsors;

    expect(sponsor).toEqual({ name: 'Acme Corp', logoUrl: 'https://cdn.example.com/acme.png' });
  });

  it('does not backtrack on unterminated meta tags', () => {
    // 256 KiB took 4.4 s before the fix and ~0.3 ms after; 1 s is far above the fixed cost and far
    // below the broken one, so this cannot flake either way.
    const html = '<meta '.repeat((256 * 1024) / 6);

    expect(timeMs(html)).toBeLessThan(1000);
  });

  it('does not backtrack on unterminated img tags', () => {
    const html = '<img src="'.repeat((256 * 1024) / 10);

    expect(timeMs(html)).toBeLessThan(1000);
  });

  it('does not backtrack on unterminated script tags', () => {
    // The JSON-LD fallback carried the IDENTICAL two-unbounded-run pattern as the og:image match,
    // and it is the MORE exposed of the two: it runs precisely on pages with no og:image.
    const html = '<script '.repeat((256 * 1024) / 8);

    expect(timeMs(html)).toBeLessThan(1000);
  });

  it('reads the second JSON-LD block when the first carries no image', () => {
    // Tokenizing the tags means finding each tag's OWN body: a naive `indexOf(openTag)` returns
    // the first match every time, so two identical `<script type=...>` tags would both read the
    // first one's body and the second block's image would never be seen.
    const html =
      '<script type="application/ld+json">{"@type":"Thing"}</script>' + '<script type="application/ld+json">{"@type":"Event","image":"/second.png"}</script>';

    expect(extractHeroAndSponsors(html, BASE_URL).heroImageUrl).toBe('https://example.com/second.png');
  });

  it.each([
    ['lowercase', '</script>'],
    ['uppercase', '</SCRIPT>'],
    ['mixed case', '</Script>'],
  ])('accepts a %s closing tag', (_label, closer) => {
    // HTML tag names are case-insensitive, so all three close the block. A case-SENSITIVE closer
    // search runs the body to the end of the document on an uppercased page and loses the image.
    const html = `<script type="application/ld+json">{"@type":"Event","image":"/x.png"}${closer}`;

    expect(extractHeroAndSponsors(html, BASE_URL).heroImageUrl).toBe('https://example.com/x.png');
  });

  it('reads a JSON-LD block whose own text mentions a script tag', () => {
    // Script content is RAW TEXT until the closer, so a `<script>` inside a JSON string is not a
    // nested tag. Treating an opener as one while a body is pending dropped the whole block --
    // and event pages legitimately carry such text in a description.
    const html = '<script type="application/ld+json">{"@type":"Event","image":"/b.png","description":"use <script> tags"}</script>';

    expect(extractHeroAndSponsors(html, BASE_URL).heroImageUrl).toBe('https://example.com/b.png');
  });

  it('does not backtrack on many unclosed ld+json tags', () => {
    // The shape that made two earlier fixes quadratic: every open tag scanning to EOF for a
    // closer that is not there. At 5 MiB that was 109 SECONDS; one left-to-right pass makes it
    // milliseconds. 256 KiB is far above the fixed cost and far below the broken one.
    const html = '<script type="application/ld+json">'.repeat((256 * 1024) / 35);

    expect(timeMs(html)).toBeLessThan(1000);
  });

  it('skips a non-JSON-LD script before the one that matters', () => {
    const html = '<script>var x = 1</script><script type="application/ld+json">{"@type":"Event","image":"/after.png"}</script>';

    expect(extractHeroAndSponsors(html, BASE_URL).heroImageUrl).toBe('https://example.com/after.png');
  });

  it('still finds the real og:image after a long adversarial run', () => {
    const html = `${'<meta '.repeat(20000)}<meta property="og:image" content="/real.png">`;

    expect(extractHeroAndSponsors(html, BASE_URL).heroImageUrl).toBe('https://example.com/real.png');
  });

  it('reads og:image when content precedes property', () => {
    // The old code needed a SECOND whole-page regex for this ordering; tokenizing the tag first
    // makes attribute order irrelevant, so this pins that the behaviour survived the rewrite.
    const html = '<meta content="/hero2.png" property="og:image">';

    expect(extractHeroAndSponsors(html, BASE_URL).heroImageUrl).toBe('https://example.com/hero2.png');
  });
});
