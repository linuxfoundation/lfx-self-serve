// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_KEY_CONTACT_ROLE_PILL_CLASSES, ORG_KEY_CONTACT_ROLE_PILL_FALLBACK } from '../constants/org-people-key-contacts.constants';
import { matchesKeyContactFilter, orgKeyContactRolePillClass } from './org-key-contact.utils';
import { ORG_ALL_EMPLOYEE_KEY_CONTACT_OPTIONS } from '../constants/org-people.constants';
import { describe, expect, it } from 'vitest';

describe('orgKeyContactRolePillClass', () => {
  it('gives every canonical role its own pill classes', () => {
    for (const [role, classes] of Object.entries(ORG_KEY_CONTACT_ROLE_PILL_CLASSES)) {
      expect(orgKeyContactRolePillClass(role)).toBe(classes);
    }
  });

  // Upstream sends the role as a free string, so anything outside the canonical nine must still render.
  it.each(['Procurement Contact', '', 'billing contact'])('falls back for the non-canonical role %o', (role) => {
    expect(orgKeyContactRolePillClass(role)).toBe(ORG_KEY_CONTACT_ROLE_PILL_FALLBACK);
  });
});

describe('matchesKeyContactFilter', () => {
  it('lists everyone under all, including people with no roles or no array', () => {
    expect(matchesKeyContactFilter([], 'all')).toBe(true);
    expect(matchesKeyContactFilter(['Billing Contact'], 'all')).toBe(true);
    expect(matchesKeyContactFilter(undefined, 'all')).toBe(true);
  });

  it('splits the roster into any and none', () => {
    expect(matchesKeyContactFilter(['Billing Contact'], 'any')).toBe(true);
    expect(matchesKeyContactFilter(['Procurement Contact'], 'any')).toBe(true);
    expect(matchesKeyContactFilter([], 'any')).toBe(false);
    expect(matchesKeyContactFilter(null, 'any')).toBe(false);
    expect(matchesKeyContactFilter([], 'none')).toBe(true);
    expect(matchesKeyContactFilter(undefined, 'none')).toBe(true);
    expect(matchesKeyContactFilter(['Billing Contact'], 'none')).toBe(false);
  });

  it('matches a role for anyone holding it, among several', () => {
    expect(matchesKeyContactFilter(['Billing Contact', 'Legal Contact'], 'Legal Contact')).toBe(true);
    expect(matchesKeyContactFilter(['Billing Contact'], 'Legal Contact')).toBe(false);
    expect(matchesKeyContactFilter([], 'Legal Contact')).toBe(false);
  });

  it('offers every canonical role once as an option', () => {
    const roleOptions = ORG_ALL_EMPLOYEE_KEY_CONTACT_OPTIONS.map((o) => o.value).filter((v) => !['all', 'any', 'none'].includes(v));
    expect(new Set(roleOptions)).toEqual(new Set(Object.keys(ORG_KEY_CONTACT_ROLE_PILL_CLASSES)));
    expect(roleOptions).toHaveLength(9);
  });
});
