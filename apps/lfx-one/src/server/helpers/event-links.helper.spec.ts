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

  it('keeps the query string but drops the fragment from the key', () => {
    const html = `<a href="/agenda?day=2#morning">Day 2</a>`;
    const links = extractPageLinks(html, BASE_URL);
    expect(links.has('https://example.com/agenda?day=2')).toBe(true);
  });

  it('keeps the fragment on the stored href', () => {
    const links = extractPageLinks(`<a href="/program#day-2">Day 2</a>`, BASE_URL);
    expect(links.get('https://example.com/program')).toBe('https://example.com/program#day-2');
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
