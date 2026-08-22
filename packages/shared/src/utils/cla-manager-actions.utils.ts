// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Visibility gates for the Contact CLA Manager kebab items. Framework-free so the
// branching is unit-testable without an Angular harness. The menu factory maps these
// to PrimeNG MenuItems; it does not re-derive the rules.

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
