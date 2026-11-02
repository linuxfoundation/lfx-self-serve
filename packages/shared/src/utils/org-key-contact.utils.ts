// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  isCanonicalOrgKeyContactRole,
  ORG_KEY_CONTACT_ROLE_PILL_CLASSES,
  ORG_KEY_CONTACT_ROLE_PILL_FALLBACK,
} from '../constants/org-people-key-contacts.constants';

/** Tailwind pill classes for a role string; falls back when upstream returns an unknown role. Shared so the People tab and the person-detail drawer colour the same role the same way. */
export function orgKeyContactRolePillClass(role: string): string {
  return isCanonicalOrgKeyContactRole(role) ? ORG_KEY_CONTACT_ROLE_PILL_CLASSES[role] : ORG_KEY_CONTACT_ROLE_PILL_FALLBACK;
}
