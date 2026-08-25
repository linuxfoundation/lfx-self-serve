// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Visibility gates for the My CLAs manager kebab items (Contact modal + Manage in CCLA Console).
// Framework-free so the branching is unit-testable without an Angular harness. The menu
// factories map these to PrimeNG MenuItems; they do not re-derive the rules.

import { MyClaAgreement } from '../interfaces/cla.interface';

/** Request approval — ECLA that is off the current Approved List (#1372). */
export function canRequestClaApproval(agreement: MyClaAgreement): boolean {
  return agreement.kind === 'ECLA' && agreement.statusReason === 'not_on_approval_list';
}

/** Request Removal — any ECLA that is not Revoked (#1574). Never ICLA. */
export function canRequestClaRemoval(agreement: MyClaAgreement): boolean {
  return agreement.kind === 'ECLA' && agreement.status !== 'revoked';
}

/**
 * Contact CLA Manager — Needs-attention ECLA only (v17). Send is a no-op; this gate
 * only decides whether the item is offered.
 */
export function canContactClaManager(agreement: MyClaAgreement): boolean {
  return agreement.kind === 'ECLA' && agreement.status === 'needs_attention';
}

/**
 * Manage in CCLA Console — non-Revoked ECLA whose managers GET said the caller is a
 * CLA manager, and whose CLA group id is present (#1575). Salesforce ids on the
 * agreement pick the Corporate Console path; missing ids fall back to the dashboard.
 */
export function canManageInCclaConsole(agreement: MyClaAgreement, isClaManager: boolean): boolean {
  return agreement.kind === 'ECLA' && agreement.status !== 'revoked' && isClaManager && Boolean(agreement.claGroupId?.trim());
}

/**
 * LFX Corporate CLA Console address for a CLA group (#1575).
 *
 * Both console routes are keyed on the foundation, so a `projectSfid` with no
 * `foundationSfid` cannot address one — that falls back to the company dashboard
 * rather than putting a project id in the foundation segment and minting a 404.
 */
export function cclaConsoleUrl(corporateConsoleBase: string, foundationSfid?: string, projectSfid?: string): string {
  const base = corporateConsoleBase.replace(/\/+$/, '');
  const foundation = foundationSfid?.trim();
  const project = projectSfid?.trim();
  if (!foundation) {
    return `${base}/company/dashboard`;
  }
  if (project && project !== foundation) {
    return `${base}/foundation/${encodeURIComponent(foundation)}/project/${encodeURIComponent(project)}/cla`;
  }
  return `${base}/foundation/${encodeURIComponent(foundation)}/cla`;
}
