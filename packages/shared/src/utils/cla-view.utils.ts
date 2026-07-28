// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure presentation helpers for the read-only "My CLAs" view. Kept framework-free so the
// branching logic (ICLA/ECLA split, empty/CTA rules, status labels) is unit-testable without
// an Angular component-test harness.

import { BadgeSeverity } from '../interfaces/components.interface';
import { ClaStatus, MyClaAgreement, MyClasIdentitySummary } from '../interfaces/cla.interface';

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

/** Human-readable status label (research R6). */
export function claStatusLabel(status: ClaStatus): string {
  switch (status) {
    case 'valid':
      return 'Valid';
    case 'superseded':
      return 'Superseded';
    default:
      return 'No longer valid';
  }
}

/** Badge severity for the status pill. */
export function claStatusSeverity(status: ClaStatus): BadgeSeverity {
  switch (status) {
    case 'valid':
      return 'success';
    case 'superseded':
      return 'warn';
    default:
      return 'secondary';
  }
}
