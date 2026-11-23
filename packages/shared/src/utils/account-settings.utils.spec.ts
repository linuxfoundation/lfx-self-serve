// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { accountPathForProfileTab, profileTargetForAccountRoute } from './account-settings.utils';

describe('accountPathForProfileTab', () => {
  it('moves each hub tab to its Account & Settings page', () => {
    expect(accountPathForProfileTab('identities')).toBe('/account/identities');
    expect(accountPathForProfileTab('linux-email')).toBe('/account/linux-email');
    expect(accountPathForProfileTab('individual-enrollment')).toBe('/account/individual-enrollment');
    expect(accountPathForProfileTab('clas')).toBe('/account/clas');
    expect(accountPathForProfileTab('transactions')).toBe('/account/transactions');
  });

  it('sends each Settings section to its own page, and a bare Settings link to Email settings', () => {
    expect(accountPathForProfileTab('settings', 'password')).toBe('/account/password');
    expect(accountPathForProfileTab('settings', 'developer-settings')).toBe('/account/developer-settings');
    expect(accountPathForProfileTab('settings', 'email-settings')).toBe('/account/email-settings');
    expect(accountPathForProfileTab('settings', 'account-recovery')).toBe('/account/password');
    expect(accountPathForProfileTab('settings')).toBe('/account/email-settings');
    expect(accountPathForProfileTab('settings', 'nowhere')).toBe('/account/email-settings');
  });

  it('keeps the hub tabs that do not move, and ignores inherited keys', () => {
    expect(accountPathForProfileTab('attributions')).toBeNull();
    expect(accountPathForProfileTab('toString')).toBeNull();
  });
});

describe('profileTargetForAccountRoute', () => {
  it('falls back to the hub tab, with the Settings section as a fragment', () => {
    expect(profileTargetForAccountRoute('identities')).toEqual({ path: '/profile/identities' });
    expect(profileTargetForAccountRoute('work-history')).toEqual({ path: '/profile/attributions' });
    expect(profileTargetForAccountRoute('password')).toEqual({ path: '/profile/settings', fragment: 'password' });
  });

  it('falls back to the hub for the landing page, an unknown page or an inherited key', () => {
    expect(profileTargetForAccountRoute(undefined)).toEqual({ path: '/profile' });
    expect(profileTargetForAccountRoute('nowhere')).toEqual({ path: '/profile' });
    expect(profileTargetForAccountRoute('constructor')).toEqual({ path: '/profile' });
  });
});
