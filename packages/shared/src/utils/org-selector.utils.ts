// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgRolePersona } from '../interfaces';

/** Filter-grammar safety allowlist for usernames — accepts every char OIDC username/nickname claims actually use AND excludes the query-service separators `:` and `,`. Not a strict OIDC-claim format check. */
const FILTER_SAFE_USERNAME = /^[A-Za-z0-9._+\-@|]+$/;

/** Filter-grammar safety allowlist for path-segment identifiers — covers UUIDs and Salesforce IDs as a superset (`[A-Za-z0-9_-]`) AND excludes the query-service separators `:` and `,`. Not a strict UUID/SF-ID format check. */
const FILTER_SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;

/** True when the value can be safely interpolated into a `writers.username:<value>` / `auditors.username:<value>` query-service filter without altering the filter shape. */
export function isFilterSafeUsername(value: string): boolean {
  return value.length > 0 && value.length <= 256 && FILTER_SAFE_USERNAME.test(value);
}

/** True when the value can be safely interpolated into a `uid:<value>` / `sfid:<value>` query-service filter without altering the filter shape. Note: this is a SAFETY check, not a strict UUID/SF-ID format validator. */
export function isFilterSafeIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 64 && FILTER_SAFE_IDENTIFIER.test(value);
}

/**
 * The one `OrgItem.status` value the app gives meaning to: an LF membership that is currently in
 * force. `status` is an `omitempty` passthrough from the indexed doc — free-form upstream text
 * that other consumers only render — so the comparison is normalized (trim, case-fold) rather
 * than a literal, and callers degrade to "not known active" for anything else.
 */
const ORG_MEMBERSHIP_STATUS_ACTIVE = 'active';

/** True when the indexed membership status reads as currently active; false for absent, null or any other value. */
export function isActiveStatus(status: string | null | undefined): boolean {
  return status?.trim().toLowerCase() === ORG_MEMBERSHIP_STATUS_ACTIVE;
}

/** The four grant sets a viewer holds on organizations, direct and roll-up-derived, as `OrgRoleGrantsService` publishes them. */
export interface OrgRoleGrantSets {
  writerSet: ReadonlySet<string>;
  inheritedWriterSet: ReadonlySet<string>;
  auditorSet: ReadonlySet<string>;
  inheritedAuditorSet: ReadonlySet<string>;
}

/**
 * LFXV2-3029 — authority-first precedence over a viewer's grants on one organization: direct
 * writer, inherited writer, direct auditor, inherited auditor. The one ordering both the selector's
 * persona badge and the default-organization ranking read, so the two cannot drift. The BFF's four
 * arrays are already disjoint per this precedence, so at most one entry matches a given uid — the
 * order is defense-in-depth there, load-bearing when the same list is ranked into bands.
 */
export const ORG_ROLE_AUTHORITY_ORDER: readonly (readonly [OrgRolePersona, keyof OrgRoleGrantSets])[] = [
  ['direct-writer', 'writerSet'],
  ['inherited-writer', 'inheritedWriterSet'],
  ['direct-auditor', 'auditorSet'],
  ['inherited-auditor', 'inheritedAuditorSet'],
];

/** The highest-authority persona the viewer holds on `uid`, or null with no grant at all. */
export function resolveOrgRolePersona(uid: string, grants: OrgRoleGrantSets): OrgRolePersona | null {
  for (const [persona, set] of ORG_ROLE_AUTHORITY_ORDER) {
    if (grants[set].has(uid)) return persona;
  }
  return null;
}
