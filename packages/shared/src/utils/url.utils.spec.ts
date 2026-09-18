// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { extractUrls, isPrivateHost, isProfileHubPath, isRelativeInAppPath } from './url.utils';

describe('extractUrls', () => {
  it('extracts http and https URLs from prose', () => {
    expect(extractUrls('see http://example.com and https://linuxfoundation.org today')).toEqual(['http://example.com', 'https://linuxfoundation.org']);
  });

  it('trims sentence punctuation following the URL', () => {
    expect(extractUrls('Visit https://example.com. Thanks!')).toEqual(['https://example.com']);
    expect(extractUrls('Visit https://example.com/path?a=1, then go')).toEqual(['https://example.com/path?a=1']);
  });

  it('trims closing brackets that wrap the URL in prose', () => {
    expect(extractUrls('(see https://linuxfoundation.org)')).toEqual(['https://linuxfoundation.org']);
    expect(extractUrls('[https://example.com],')).toEqual(['https://example.com']);
  });

  it('keeps balanced brackets that are part of the URL path', () => {
    expect(extractUrls('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
  });

  it('re-trims punctuation exposed by stripping an unmatched bracket', () => {
    expect(extractUrls('(see https://example.com/page.)')).toEqual(['https://example.com/page']);
    expect(extractUrls('(https://example.com/page,)')).toEqual(['https://example.com/page']);
  });

  it('trims curly quotes (U+2019/U+201D) that close around a URL in prose', () => {
    expect(extractUrls('“See https://example.com/page” for details')).toEqual(['https://example.com/page']);
    expect(extractUrls('it’s at https://example.com/page’')).toEqual(['https://example.com/page']);
  });

  it('returns an empty array for empty or URL-free text', () => {
    expect(extractUrls('')).toEqual([]);
    expect(extractUrls('no links here')).toEqual([]);
  });

  it('rejects non-http(s) and unsafe URLs', () => {
    expect(extractUrls('ftp://example.com javascript:alert(1)')).toEqual([]);
  });
});

describe('isProfileHubPath', () => {
  it('matches the exact /profile route', () => {
    expect(isProfileHubPath('/profile')).toBe(true);
  });

  it('matches nested /profile/ routes', () => {
    expect(isProfileHubPath('/profile/settings')).toBe(true);
    expect(isProfileHubPath('/profile/badges')).toBe(true);
  });

  it('does not match sibling routes that share the /profile prefix', () => {
    expect(isProfileHubPath('/profiles')).toBe(false);
    expect(isProfileHubPath('/profile-old')).toBe(false);
  });

  it('strips the query string before matching', () => {
    expect(isProfileHubPath('/profile?tab=account')).toBe(true);
    expect(isProfileHubPath('/profiles?x=1')).toBe(false);
  });

  it('strips the fragment before matching', () => {
    expect(isProfileHubPath('/profile#developer-settings')).toBe(true);
    expect(isProfileHubPath('/profile/settings#developer-settings')).toBe(true);
  });

  it('strips both query and fragment before matching', () => {
    expect(isProfileHubPath('/profile/settings?tab=account#developer-settings')).toBe(true);
  });

  it('does not match unrelated routes', () => {
    expect(isProfileHubPath('/org/profile')).toBe(false);
    expect(isProfileHubPath('/meetings')).toBe(false);
    expect(isProfileHubPath('/')).toBe(false);
  });
});

describe('isRelativeInAppPath', () => {
  it('accepts an in-app relative path', () => {
    expect(isRelativeInAppPath('/project/x')).toBe(true);
    expect(isRelativeInAppPath('/project/{{project.uid}}/committees/new')).toBe(true);
  });

  it('rejects a protocol-relative value', () => {
    expect(isRelativeInAppPath('//evil.com')).toBe(false);
  });

  it('rejects an absolute URL', () => {
    expect(isRelativeInAppPath('https://example.com')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isRelativeInAppPath('')).toBe(false);
  });
});

describe('isPrivateHost', () => {
  it.each([
    ['localhost', 'localhost'],
    ['localhost with a trailing root dot', 'localhost.'],
    ['a .localhost subdomain', 'api.localhost'],
    ['loopback', '127.0.0.1'],
    ['this-host', '0.0.0.0'],
    ['cloud metadata', '169.254.169.254'],
    ['rfc1918 ten', '10.1.2.3'],
    ['rfc1918 172.16', '172.20.0.1'],
    ['rfc1918 192.168', '192.168.1.1'],
    ['carrier-grade nat', '100.100.0.1'],
    ['ipv6 loopback', '[::1]'],
    ['ipv6 link-local', '[fe80::1]'],
    ['ipv6 unique-local', '[fd00::1]'],
    ['ipv4-mapped metadata in hex', '[::ffff:a9fe:a9fe]'],
  ])('blocks %s', (_label, hostname) => {
    expect(isPrivateHost(hostname)).toBe(true);
  });

  it.each([
    ['an ordinary CDN', 'cdn.example.com'],
    ['a public IPv4', '93.184.216.34'],
    ['a name merely containing localhost', 'notlocalhost.example.com'],
    ['a public IPv6', '[2606:2800:220:1:248:1893:25c8:1946]'],
  ])('allows %s', (_label, hostname) => {
    expect(isPrivateHost(hostname)).toBe(false);
  });

  // The trailing dot is the one that actually got through review: `new URL('http://localhost./x')`
  // keeps the dot in `hostname`, which failed both the exact match and the `.localhost` suffix
  // check, while a resolver treats the two as the same absolute name.
  it('treats a trailing root dot as the same name, not a different one', () => {
    expect(isPrivateHost('localhost.')).toBe(isPrivateHost('localhost'));
    expect(isPrivateHost('127.0.0.1.')).toBe(isPrivateHost('127.0.0.1'));
  });
});
