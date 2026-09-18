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

  it('dedupes repeated sponsor logos and caps the list at 10', () => {
    // 14 UNIQUE logos plus one duplicate. The previous fixture used `i % 3`, so 15 tags
    // collapsed to three URLs and never reached the cap -- `toBeLessThanOrEqual(10)` stayed
    // green with MAX_SPONSORS removed entirely. Both properties need more uniques than the cap.
    const unique = Array.from({ length: 14 }, (_, i) => `<img src="/sponsors/s${i}.png" alt="Sponsor ${i}" />`);
    const html = `<h2>Sponsors</h2>${[...unique, unique[0]].join('')}`;

    const result = extractHeroAndSponsors(html, BASE_URL);

    // EXACTLY 10, not at-most: the cap is the assertion, so a raised or removed limit fails.
    expect(result.sponsors).toHaveLength(10);
    const urls = result.sponsors.map((s) => s.logoUrl);
    expect(new Set(urls).size).toBe(urls.length);
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
    // is why the host is normalised before it is judged.
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
