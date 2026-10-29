// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_KEY_CONTACT_ROLE_PILL_CLASSES, ORG_KEY_CONTACT_ROLE_PILL_FALLBACK } from '../constants/org-people-key-contacts.constants';
import { orgKeyContactRolePillClass } from './org-key-contact.utils';
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
