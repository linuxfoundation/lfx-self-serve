// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { googleExcludedPlacementsRefusal } from './campaign-google-placements.utils';

describe('googleExcludedPlacementsRefusal', () => {
  it('accepts bare domains, subdomains, hyphens, mixed case, xn-- names, padding and repeats', () => {
    expect(
      googleExcludedPlacementsRefusal(['example.com', ' news.example.co.uk ', 'my-site.org', 'EXAMPLE.com', 'example.com', 'xn--bcher-kva.example', 'a1.io'])
    ).toBeNull();
    expect(googleExcludedPlacementsRefusal([])).toBeNull();
  });

  it('accepts 500 entries and a 253-character domain, and refuses 501 and 254', () => {
    expect(googleExcludedPlacementsRefusal(Array.from({ length: 500 }, (_v, i) => `site${i}.com`))).toBeNull();
    expect(googleExcludedPlacementsRefusal(Array.from({ length: 501 }, (_v, i) => `site${i}.com`))).toBe(
      'A Display campaign takes at most 500 placement exclusions, and 501 are set. Remove 1 and create again.'
    );
    const label = 'a'.repeat(63);
    const domain253 = `${label}.${label}.${label}.${'b'.repeat(61)}`;
    expect(domain253.length).toBe(253);
    expect(googleExcludedPlacementsRefusal([domain253])).toBeNull();
    expect(googleExcludedPlacementsRefusal([`${domain253}c`])).toContain('is not a domain name');
  });

  it.each([
    ['a non-list', 'example.com', 'must be a list of website domains'],
    ['a non-string entry', ['example.com', 7], 'must be a list of website domains'],
    ['a blank entry', ['example.com', ' \u0085 '], 'Placement exclusion 2 is blank'],
    ['a scheme', ['https://example.com'], 'starts with a scheme'],
    ['a path', ['example.com/news'], 'must be a bare domain'],
    ['a query', ['example.com?a=1'], 'must be a bare domain'],
    ['a fragment', ['example.com#top'], 'must be a bare domain'],
    ['a port', ['example.com:8080'], 'must be a bare domain'],
    ['credentials', ['user@example.com'], 'must be a bare domain'],
    ['a non-ASCII name', ['bücher.example'], 'is not plain ASCII'],
    ['the Kelvin sign, which lower-cases to k', ['Kube.io'], 'is not plain ASCII'],
    ['a single label', ['localhost'], 'is not a domain name'],
    ['a trailing dot', ['example.com.'], 'is not a domain name'],
    ['an empty label', ['example..com'], 'is not a domain name'],
    ['a leading hyphen', ['-example.com'], 'is not a domain name'],
    ['a trailing hyphen', ['example-.com'], 'is not a domain name'],
    ['an underscore', ['my_site.com'], 'is not a domain name'],
    ['a wildcard', ['*.example.com'], 'is not a domain name'],
    ['an IPv4 literal', ['192.168.0.1'], 'is not a domain name'],
    ['a label over 63', [`${'a'.repeat(64)}.com`], 'is not a domain name'],
  ])('refuses %s', (_label, placements, fragment) => {
    expect(googleExcludedPlacementsRefusal(placements)).toContain(fragment);
  });

  it('checks the scheme before the other bare-domain characters, as upstream does', () => {
    expect(googleExcludedPlacementsRefusal(['http://example.com/path'])).toContain('starts with a scheme');
  });

  it('never echoes an entry', () => {
    const refusal = googleExcludedPlacementsRefusal(['https://user:secret@example.com/?token=abc']);
    expect(refusal).not.toContain('secret');
    expect(refusal).not.toContain('token');
  });
});
