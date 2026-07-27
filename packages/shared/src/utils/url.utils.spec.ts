// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isProfileHubPath } from './url.utils';

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
