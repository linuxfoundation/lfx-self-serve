// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure presentation helpers for the read-only "CLAs" view. Kept framework-free so the
// branching logic (ICLA/ECLA split, empty/CTA rules, status labels) is unit-testable without
// an Angular component-test harness.

import { PROFILE_TABS } from '../constants/profile.constants';
import { BadgeSeverity, TagSeverity } from '../interfaces/components.interface';
import { ProfileTab } from '../interfaces';
import { ClaSignedVia, ClaStatus, MyClaAgreement, MyClasIdentitySummary } from '../interfaces/cla.interface';

/**
 * Profile subtab list, with the read-only "CLAs" tab appended (before Transactions)
 * when `my-clas-enabled` is on. Shared by both profile-hub nav entry points — the layout
 * subtab strip and the sidebar me-lens ⋯ menu — so they never disagree on whether the tab
 * is present. Returns the static PROFILE_TABS reference unchanged when the flag is off.
 */
export function buildProfileTabs(myClasEnabled: boolean): ProfileTab[] {
  if (!myClasEnabled) return PROFILE_TABS;
  const clasTab: ProfileTab = { id: 'clas', label: 'CLAs', route: 'clas' };
  const insertAt = PROFILE_TABS.findIndex((t) => t.id === 'transactions');
  if (insertAt === -1) return [...PROFILE_TABS, clasTab];
  return [...PROFILE_TABS.slice(0, insertAt), clasTab, ...PROFILE_TABS.slice(insertAt)];
}

/** Partitions agreements into ICLA and ECLA groups, preserving order. */
export function splitAgreementsByKind(agreements: MyClaAgreement[]): { iclas: MyClaAgreement[]; eclas: MyClaAgreement[] } {
  return {
    iclas: agreements.filter((a) => a.kind === 'ICLA'),
    eclas: agreements.filter((a) => a.kind === 'ECLA'),
  };
}

/** True when the list finished loading successfully with zero agreements (empty state). */
export function isMyClasEmpty(loaded: boolean, error: boolean, agreementCount: number): boolean {
  return loaded && !error && agreementCount === 0;
}

/**
 * Whether to show the "link your GitHub account" CTA: the identity has no linked GitHub
 * account (so GitHub-keyed CLA history can't be matched) or nothing matched at all.
 */
export function shouldShowGithubCta(identity: MyClasIdentitySummary | undefined): boolean {
  if (!identity) return false;
  return identity.githubLinked === false || identity.unmatched;
}

/** Badge severity for the ICLA/ECLA kind pill. */
export function claKindSeverity(kind: MyClaAgreement['kind']): BadgeSeverity {
  return kind === 'ICLA' ? 'info' : 'secondary';
}

/**
 * Human-readable status label. Exhaustive — a new ClaStatus member fails the build.
 *
 * "Revoked" belongs to `revoked` alone. It is the reviewed copy for a sanctions-screening
 * outcome, so applying it to `invalidated` would tell a contributor who asked to be removed
 * from an approved list, or whose project manager invalidated their ICLA, that they were
 * screened. `revoked` is employer-level and system-set; `invalidated` mirrors the stored
 * approval flag and attributes nothing.
 */
export function claStatusLabel(status: ClaStatus): string {
  switch (status) {
    case 'valid':
      return 'Valid';
    case 'needs_attention':
      return 'Needs attention';
    case 'revoked':
      return 'Revoked';
    case 'invalidated':
      return 'Invalidated';
    case 'unknown':
      return '—';
    case 'superseded':
      return 'Superseded';
  }
}

/** Tag severity for the status pill. Exhaustive — a new ClaStatus member fails the build. */
export function claStatusSeverity(status: ClaStatus): TagSeverity {
  switch (status) {
    case 'valid':
      return 'success';
    case 'needs_attention':
      return 'warn';
    case 'revoked':
      return 'secondary';
    case 'invalidated':
      return 'danger';
    case 'unknown':
      return 'secondary';
    case 'superseded':
      return 'warn';
  }
}

/**
 * Second line under the signed date (#1573). Undefined ⇒ the Signed cell is date-only.
 *
 * GitHub and GitLab take a platform suffix; Gerrit / LF SSO / email do not — that is the
 * committed prototype, not a missing label. A blank identity omits the line even when a
 * platform is present: `Signed as  (GitHub)` is worse than a date-only cell.
 */
export function signedAsLine(signedVia: ClaSignedVia | undefined, signedAs: string | undefined): string | undefined {
  const identity = signedAs?.trim();
  if (!identity) return undefined;
  switch (signedVia) {
    case 'github':
      return `Signed as ${identity} (GitHub)`;
    case 'gitlab':
      return `Signed as ${identity} (GitLab)`;
    case 'gerrit':
    default:
      return `Signed as ${identity}`;
  }
}
