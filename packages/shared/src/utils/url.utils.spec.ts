// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isProfileHubPath, isValidUrl } from './url.utils';

describe('isValidUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://example.com/path?q=1')).toBe(true);
    expect(isValidUrl('https://sub.example.com/a/b')).toBe(true);
  });

  it('rejects dangerous schemes (the newsletter renderer / inline-link gate)', () => {
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
    expect(isValidUrl('JavaScript:alert(1)')).toBe(false); // case-insensitive
    expect(isValidUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isValidUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isValidUrl('file:///etc/passwd')).toBe(false);
    expect(isValidUrl('ftp://host/file')).toBe(false);
  });

  it('rejects non-http(s) protocols', () => {
    expect(isValidUrl('mailto:someone@example.com')).toBe(false);
  });

  it('rejects empty, relative, and scheme-less values', () => {
    expect(isValidUrl('')).toBe(false);
    expect(isValidUrl('   ')).toBe(false);
    expect(isValidUrl('/relative/path')).toBe(false);
    expect(isValidUrl('example.com')).toBe(false); // no protocol
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
