// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  isCanonicalOrgKeyContactRole,
  ORG_KEY_CONTACT_ROLE_PILL_CLASSES,
  ORG_KEY_CONTACT_ROLE_PILL_FALLBACK,
} from '../constants/org-people-key-contacts.constants';
import { ORG_KEY_CONTACT_EMAIL_LOOKUP_MAX_IDS } from '../constants/org-people.constants';
import { SALESFORCE_ID_PATTERN } from '../constants/regex.constants';
import type { OrgAllEmployeeKeyContactFilter } from '../interfaces/org-people.interface';

/** Tailwind pill classes for a role string; falls back when upstream returns an unknown role. Shared so the People tab and the person-detail drawer colour the same role the same way. */
export function orgKeyContactRolePillClass(role: string): string {
  return isCanonicalOrgKeyContactRole(role) ? ORG_KEY_CONTACT_ROLE_PILL_CLASSES[role] : ORG_KEY_CONTACT_ROLE_PILL_FALLBACK;
}

/** An 18-character Salesforce record id — the only shape a key-contact record id (`contactUid`) takes in the warehouse. */
export function isKeyContactRecordId(id: string): boolean {
  return id.length === 18 && SALESFORCE_ID_PATTERN.test(id);
}

/**
 * The key-contact record ids a drawer company-email lookup sends for a person: well-formed, deduplicated, at most
 * {@link ORG_KEY_CONTACT_EMAIL_LOOKUP_MAX_IDS}. Empty when none qualifies.
 */
export function keyContactEmailLookupIds(ids: readonly string[] | null | undefined): string[] {
  return [...new Set((ids ?? []).filter(isKeyContactRecordId))].slice(0, ORG_KEY_CONTACT_EMAIL_LOOKUP_MAX_IDS);
}

/** Whether a person holding `roles` passes the All Employees Key Contact filter (`all` passes everyone; a role matches by exact string). */
export function matchesKeyContactFilter(roles: readonly string[] | null | undefined, filter: OrgAllEmployeeKeyContactFilter): boolean {
  const held = roles ?? [];
  if (filter === 'all') return true;
  if (filter === 'any') return held.length > 0;
  if (filter === 'none') return held.length === 0;
  return held.includes(filter);
}
