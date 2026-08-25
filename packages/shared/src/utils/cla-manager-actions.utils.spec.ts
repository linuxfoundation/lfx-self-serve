// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MyClaAgreement } from '../interfaces/cla.interface';
import { canContactClaManager, canRequestClaApproval, canRequestClaRemoval } from './cla-manager-actions.utils';

function agreement(overrides: Partial<MyClaAgreement> = {}): MyClaAgreement {
  return {
    id: 's1',
    kind: 'ECLA',
    claGroupName: 'CNCF',
    signedOn: '2022-01-01',
    status: 'valid',
    pdfAvailable: false,
    ...overrides,
  };
}

describe('canRequestClaApproval', () => {
  it('is true only for an ECLA whose reason is not_on_approval_list', () => {
    expect(canRequestClaApproval(agreement({ status: 'needs_attention', statusReason: 'not_on_approval_list' }))).toBe(true);
  });

  it('is false when Needs attention has some other reason', () => {
    expect(canRequestClaApproval(agreement({ status: 'needs_attention', statusReason: 'unknown' }))).toBe(false);
    expect(canRequestClaApproval(agreement({ status: 'needs_attention' }))).toBe(false);
  });

  it('is false for ICLA even when the reason is set', () => {
    expect(canRequestClaApproval(agreement({ kind: 'ICLA', status: 'valid', statusReason: 'not_on_approval_list', pdfAvailable: true }))).toBe(false);
  });
});

describe('canRequestClaRemoval', () => {
  it('is true for non-Revoked ECLA rows', () => {
    expect(canRequestClaRemoval(agreement({ status: 'valid' }))).toBe(true);
    expect(canRequestClaRemoval(agreement({ status: 'needs_attention' }))).toBe(true);
    expect(canRequestClaRemoval(agreement({ status: 'invalidated' }))).toBe(true);
    expect(canRequestClaRemoval(agreement({ status: 'unknown' }))).toBe(true);
  });

  it('is false for Revoked ECLA and for every ICLA', () => {
    expect(canRequestClaRemoval(agreement({ status: 'revoked' }))).toBe(false);
    expect(canRequestClaRemoval(agreement({ kind: 'ICLA', pdfAvailable: true }))).toBe(false);
  });
});

describe('canContactClaManager', () => {
  it('is true only for Needs-attention ECLA', () => {
    expect(canContactClaManager(agreement({ status: 'needs_attention' }))).toBe(true);
    expect(canContactClaManager(agreement({ status: 'valid' }))).toBe(false);
    expect(canContactClaManager(agreement({ status: 'invalidated' }))).toBe(false);
    expect(canContactClaManager(agreement({ kind: 'ICLA', status: 'needs_attention', pdfAvailable: true }))).toBe(false);
  });
});
