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
    const repeated = Array.from({ length: 15 }, (_, i) => `<img src="/sponsors/s${i % 3}.png" alt="Sponsor ${i % 3}" />`).join('');
    const result = extractHeroAndSponsors(`<h2>Sponsors</h2>${repeated}`, BASE_URL);
    expect(result.sponsors.length).toBeLessThanOrEqual(10);
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
