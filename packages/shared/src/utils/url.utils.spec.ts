// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { extractUrls, isProfileHubPath } from './url.utils';

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
