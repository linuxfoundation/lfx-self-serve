// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it } from 'vitest';

import { buildAvatarUrl, deriveAvatarUrl, getAvatarCdnPrefix, toAvatarKeySegment, toAvatarObjectKey } from './avatar-url.util';

const ORIGINAL_ENV = { ...process.env };

describe('avatar-url.util', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env['CDN_URL_PREFIX'];
  });

  describe('getAvatarCdnPrefix', () => {
    it('returns null when unset', () => {
      expect(getAvatarCdnPrefix()).toBeNull();
    });

    it('strips trailing slashes from an absolute URL', () => {
      process.env['CDN_URL_PREFIX'] = 'https://cdn.example.com/';
      expect(getAvatarCdnPrefix()).toBe('https://cdn.example.com');
    });

    it('accepts http (not just https)', () => {
      process.env['CDN_URL_PREFIX'] = 'http://cdn.example.com';
      expect(getAvatarCdnPrefix()).toBe('http://cdn.example.com');
    });

    it('rejects a bare hostname with no scheme', () => {
      process.env['CDN_URL_PREFIX'] = 'avatars-public.dev.downloads.lfx.community';
      expect(() => getAvatarCdnPrefix()).toThrow(/CDN_URL_PREFIX must be an absolute http\(s\) URL/);
    });

    it('rejects a scheme-only value with no hostname', () => {
      process.env['CDN_URL_PREFIX'] = 'https://';
      expect(() => getAvatarCdnPrefix()).toThrow(/CDN_URL_PREFIX must be an absolute http\(s\) URL/);
    });

    it('rejects a non-http(s) scheme', () => {
      process.env['CDN_URL_PREFIX'] = 'ftp://cdn.example.com';
      expect(() => getAvatarCdnPrefix()).toThrow(/CDN_URL_PREFIX must be an absolute http\(s\) URL/);
    });

    it('trims leading/trailing whitespace from the returned prefix', () => {
      process.env['CDN_URL_PREFIX'] = '  https://cdn.example.com/  ';
      expect(getAvatarCdnPrefix()).toBe('https://cdn.example.com');
    });

    it('rejects a prefix with a query string', () => {
      process.env['CDN_URL_PREFIX'] = 'https://cdn.example.com?token=x';
      expect(() => getAvatarCdnPrefix()).toThrow(/CDN_URL_PREFIX must be an absolute http\(s\) URL/);
    });

    it('rejects a prefix with a fragment', () => {
      process.env['CDN_URL_PREFIX'] = 'https://cdn.example.com/base#frag';
      expect(() => getAvatarCdnPrefix()).toThrow(/CDN_URL_PREFIX must be an absolute http\(s\) URL/);
    });
  });

  describe('toAvatarKeySegment / toAvatarObjectKey', () => {
    it('escapes % before / so the mapping stays collision-free', () => {
      expect(toAvatarKeySegment('a%2Fb/c')).toBe('a%252Fb%2Fc');
    });

    it('builds a lowercased, trimmed object key', () => {
      expect(toAvatarObjectKey('  SomeUser  ')).toBe('avatars/someuser');
    });
  });

  describe('buildAvatarUrl / deriveAvatarUrl', () => {
    it('joins prefix and percent-encoded key segment under avatars/', () => {
      expect(buildAvatarUrl('https://cdn.example.com', 'a b')).toBe('https://cdn.example.com/avatars/a%20b');
    });

    it('returns null when CDN_URL_PREFIX is unset', () => {
      expect(deriveAvatarUrl('someuser')).toBeNull();
    });

    it('derives the CDN URL for a normalized username', () => {
      process.env['CDN_URL_PREFIX'] = 'https://cdn.example.com';
      expect(deriveAvatarUrl('  SomeUser  ')).toBe('https://cdn.example.com/avatars/someuser');
    });
  });
});
