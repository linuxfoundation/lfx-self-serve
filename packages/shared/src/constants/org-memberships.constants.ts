// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { KeyContactRoleConfig, MembershipDetailTab, OrgMembershipKeyContactType } from '../interfaces/org-memberships.interface';

// Spec 015 mock-save delay. Spec 024 wires real persistence; this is removed once the modal no
// longer simulates saving (tasks T020/T028). Retained only while the mock path still references it.
export const SIMULATED_SAVE_DELAY_MS = 400;

/**
 * Spec 024 — canonical 9-role key-contact catalog. Single source of truth for:
 *  - the upstream role string used on query-service reads and member-service writes,
 *  - the UI `contactType`, display label, and per-row tooltip,
 *  - requiredness (minContacts) and the maximum-contacts limit.
 *
 * Order is the fixed display order (FR-003 / legacy FR-034): Voting, Billing, Technical, PO,
 * Marketing, PR, Legal, Event Sponsorship, Authorized Signatory. Limits mirror the member-service
 * `KeyContactRoleLimits`; requiredness mirrors legacy FR-016 (required ⇒ minContacts = 1).
 */
export const KEY_CONTACT_ROLE_CATALOG: readonly KeyContactRoleConfig[] = [
  {
    role: 'Representative/Voting Contact',
    contactType: 'representative',
    contactTypeLabel: 'Representative/Voting Contact',
    required: true,
    minContacts: 1,
    maxContacts: 1,
    tooltip: 'Primary voting representative for your organization on this membership.',
  },
  {
    role: 'Billing Contact',
    contactType: 'billing',
    contactTypeLabel: 'Billing Contact',
    required: true,
    minContacts: 1,
    maxContacts: 3,
    tooltip: 'Receives invoices and billing communications for this membership.',
  },
  {
    role: 'Technical Contact',
    contactType: 'technical',
    contactTypeLabel: 'Technical Contact',
    required: true,
    minContacts: 1,
    maxContacts: 10,
    tooltip: 'Primary technical point of contact for this membership.',
  },
  {
    role: 'PO Contact',
    contactType: 'po',
    contactTypeLabel: 'PO Contact',
    required: false,
    minContacts: 0,
    maxContacts: 3,
    tooltip: 'Receives purchase-order communications.',
  },
  {
    role: 'Marketing Contact',
    contactType: 'marketing',
    contactTypeLabel: 'Marketing Contact',
    required: true,
    minContacts: 1,
    maxContacts: 10,
    tooltip: 'Coordinates marketing and co-branding activities.',
  },
  {
    role: 'PR Contact',
    contactType: 'pr',
    contactTypeLabel: 'PR Contact',
    required: false,
    minContacts: 0,
    maxContacts: 3,
    tooltip: 'Handles press and public-relations communications.',
  },
  {
    role: 'Legal Contact',
    contactType: 'legal',
    contactTypeLabel: 'Legal Contact',
    required: false,
    minContacts: 0,
    maxContacts: 3,
    tooltip: 'Receives legal and contractual communications.',
  },
  {
    role: 'Event Sponsorship Contact',
    contactType: 'event-sponsorship',
    contactTypeLabel: 'Event Sponsorship Contact',
    required: false,
    minContacts: 0,
    maxContacts: 3,
    tooltip: 'Coordinates event sponsorship for this membership.',
  },
  {
    role: 'Authorized Signatory',
    contactType: 'authorized-signatory',
    contactTypeLabel: 'Authorized Signatory',
    required: true,
    minContacts: 1,
    maxContacts: 1,
    tooltip: 'Authorized to sign membership agreements on behalf of your organization.',
  },
] as const;

/** Lookup: canonical upstream role string (trimmed) → UI contactType. Unknown roles ⇒ undefined (ignored per FR-006). */
export const ROLE_TO_CONTACT_TYPE: Readonly<Record<string, OrgMembershipKeyContactType>> = Object.freeze(
  KEY_CONTACT_ROLE_CATALOG.reduce<Record<string, OrgMembershipKeyContactType>>((acc, cfg) => {
    acc[cfg.role.toLowerCase()] = cfg.contactType;
    return acc;
  }, {})
);

/** Lookup: UI contactType → canonical upstream role string (used on write bodies). */
export const CONTACT_TYPE_TO_ROLE: Readonly<Record<OrgMembershipKeyContactType, string>> = Object.freeze(
  KEY_CONTACT_ROLE_CATALOG.reduce<Record<string, string>>((acc, cfg) => {
    acc[cfg.contactType] = cfg.role;
    return acc;
  }, {}) as Record<OrgMembershipKeyContactType, string>
);

/** Map a raw upstream role string to a UI contactType (case-insensitive, trimmed); null when outside the catalog. */
export function roleToContactType(role: string | null | undefined): OrgMembershipKeyContactType | null {
  if (!role) return null;
  return ROLE_TO_CONTACT_TYPE[role.trim().toLowerCase()] ?? null;
}

/** The only role whose writes set primary_contact=true (FR-014a). */
export const KEY_CONTACT_PRIMARY_CONTACT_TYPE: OrgMembershipKeyContactType = 'representative';

/** Spec 018 FR-032a: CSV header row, 9 columns, in this exact order. */
export const MEMBERSHIP_AGREEMENT_CSV_HEADERS = [
  'Organization',
  'Foundation',
  'Agreement Name',
  'Signed Date',
  'Format',
  'Status',
  'Tier',
  'Current',
  'Download URL',
] as const;

export const TAB_FRAGMENTS: readonly MembershipDetailTab[] = ['key-contacts', 'board', 'docs', 'governance'] as const;
export const DEFAULT_TAB: MembershipDetailTab = 'key-contacts';

// Also accepts 'board-committee' → 'board' and 'documentation' → 'docs' aliases.
const TAB_FRAGMENT_ALIASES: Readonly<Record<string, MembershipDetailTab>> = {
  'board-committee': 'board',
  documentation: 'docs',
};

export function fragmentToTab(fragment: string | null | undefined): MembershipDetailTab {
  const candidate = (fragment ?? '').toLowerCase().trim();
  if ((TAB_FRAGMENTS as readonly string[]).includes(candidate)) {
    return candidate as MembershipDetailTab;
  }
  return TAB_FRAGMENT_ALIASES[candidate] ?? DEFAULT_TAB;
}
