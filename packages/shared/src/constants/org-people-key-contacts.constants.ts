// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgKeyContactRole, OrgKeyContactsResponse } from '../interfaces/org-people-key-contacts.interface';

/** Five required roles (min ≥ 1) — drives the org-wide Unfilled Role Types stat (PKC-5). */
export const ORG_KEY_CONTACT_REQUIRED_ROLES: readonly OrgKeyContactRole[] = [
  'Representative/Voting Contact',
  'Authorized Signatory',
  'Billing Contact',
  'Marketing Contact',
  'Technical Contact',
];

/** Tailwind pill classes per canonical role (FR-007a / FR-016 — LFX tokens, not prototype hex). */
export const ORG_KEY_CONTACT_ROLE_PILL_CLASSES: Readonly<Record<OrgKeyContactRole, string>> = {
  'Representative/Voting Contact': 'bg-purple-50 text-purple-700 border-purple-300',
  'Authorized Signatory': 'bg-indigo-50 text-indigo-700 border-indigo-300',
  'Billing Contact': 'bg-emerald-50 text-emerald-700 border-emerald-300',
  'Technical Contact': 'bg-sky-50 text-sky-700 border-sky-300',
  'Marketing Contact': 'bg-amber-50 text-amber-700 border-amber-300',
  'PO Contact': 'bg-teal-50 text-teal-700 border-teal-300',
  'PR Contact': 'bg-pink-50 text-pink-700 border-pink-300',
  'Legal Contact': 'bg-rose-50 text-rose-700 border-rose-300',
  'Event Sponsorship Contact': 'bg-orange-50 text-orange-700 border-orange-300',
};

/** Type guard for arbitrary upstream role strings — narrows to the canonical 9 for safe Record indexing.
 * Uses `Object.prototype.hasOwnProperty.call` so inherited keys (e.g. `toString`) don't pass the guard. */
export function isCanonicalOrgKeyContactRole(role: string): role is OrgKeyContactRole {
  return Object.prototype.hasOwnProperty.call(ORG_KEY_CONTACT_ROLE_PILL_CLASSES, role);
}

/** Fallback pill class for any role string not in the canonical 9. */
export const ORG_KEY_CONTACT_ROLE_PILL_FALLBACK = 'bg-slate-50 text-slate-600 border-slate-300';

/** Seed value for `toSignal` so the component never starts in an undefined state. */
export const EMPTY_ORG_KEY_CONTACTS_RESPONSE: OrgKeyContactsResponse = {
  assignments: [],
  stats: {
    individualCount: 0,
    foundationsCovered: 0,
    unfilledRequiredRoleCount: ORG_KEY_CONTACT_REQUIRED_ROLES.length,
  },
};
