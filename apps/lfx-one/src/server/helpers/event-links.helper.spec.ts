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

  it('ignores non-http(s) hrefs', () => {
    const html = `<a href="mailto:hi@example.com">Mail</a><a href="javascript:alert(1)">X</a><a href="tel:+15550100">Call</a>`;
    expect(extractPageLinks(html, BASE_URL).size).toBe(0);
  });

  it('keeps the query string but drops the fragment', () => {
    const html = `<a href="/agenda?day=2#morning">Day 2</a>`;
    const links = extractPageLinks(html, BASE_URL);
    expect(links.has('https://example.com/agenda?day=2')).toBe(true);
  });

  it('reads hrefs when other attributes come first', () => {
    const html = `<a class="btn" data-x="1" href="/venue/">Venue</a>`;
    expect(extractPageLinks(html, BASE_URL).has('https://example.com/venue')).toBe(true);
  });

  it('returns an empty set for markup with no anchors', () => {
    expect(extractPageLinks('<p>Nothing here</p>', BASE_URL).size).toBe(0);
  });

  it('does not throw on an unparsable base URL', () => {
    expect(() => extractPageLinks('<a href="/agenda/">A</a>', 'not-a-url')).not.toThrow();
  });
});

describe('verifyPageLink', () => {
  const html = `<a href="/agenda/">Agenda</a><a href="https://example.com/sponsor-us">Sponsor</a>`;
  const links = extractPageLinks(html, BASE_URL);

  it('accepts a link the page actually carries', () => {
    expect(verifyPageLink('https://example.com/agenda/', links, BASE_URL)).toBe('https://example.com/agenda');
  });

  it('accepts a relative candidate by resolving it first', () => {
    expect(verifyPageLink('/agenda', links, BASE_URL)).toBe('https://example.com/agenda');
  });

  it('ignores a trailing-slash or host-case difference', () => {
    expect(verifyPageLink('https://EXAMPLE.com/sponsor-us/', links, BASE_URL)).toBe('https://example.com/sponsor-us');
  });

  // The whole point of the helper: a URL the extraction composed from the site's shape.
  it('drops a plausible URL the page does not link to', () => {
    expect(verifyPageLink('https://example.com/schedule', links, BASE_URL)).toBe('');
  });

  it('drops a link on a different host', () => {
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
    expect(verifyPageLink('https://example.com/agenda', new Set<string>(), BASE_URL)).toBe('');
  });
});
