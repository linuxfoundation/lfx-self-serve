// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { MyClaAgreement } from '../interfaces/cla.interface';
import { canContactClaManager, canManageInCclaConsole, canRequestClaApproval, canRequestClaRemoval, cclaConsoleUrl } from './cla-manager-actions.utils';

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
  it('is true for Valid and Needs-attention ECLA', () => {
    expect(canContactClaManager(agreement({ status: 'valid' }))).toBe(true);
    expect(canContactClaManager(agreement({ status: 'needs_attention' }))).toBe(true);
  });

  it('is false for every other ECLA status', () => {
    expect(canContactClaManager(agreement({ status: 'invalidated' }))).toBe(false);
    expect(canContactClaManager(agreement({ status: 'revoked' }))).toBe(false);
    expect(canContactClaManager(agreement({ status: 'unknown' }))).toBe(false);
  });

  it('is false for ICLA, which has no covering CCLA and so no managers', () => {
    expect(canContactClaManager(agreement({ kind: 'ICLA', status: 'valid', pdfAvailable: true }))).toBe(false);
    expect(canContactClaManager(agreement({ kind: 'ICLA', status: 'needs_attention', pdfAvailable: true }))).toBe(false);
  });
});

describe('canManageInCclaConsole', () => {
  const managerEcla = { claGroupId: 'g-anuket-005', claManager: true };

  it('is true for a non-Revoked ECLA when the row is manager-flagged and the CLA group id is present', () => {
    expect(canManageInCclaConsole(agreement({ status: 'valid', ...managerEcla }))).toBe(true);
    expect(canManageInCclaConsole(agreement({ status: 'needs_attention', ...managerEcla }))).toBe(true);
    expect(canManageInCclaConsole(agreement({ status: 'invalidated', ...managerEcla }))).toBe(true);
    expect(canManageInCclaConsole(agreement({ status: 'unknown', ...managerEcla }))).toBe(true);
  });

  it('is false for non-managers, ICLA, Revoked, and a missing CLA group id', () => {
    expect(canManageInCclaConsole(agreement({ status: 'valid', ...managerEcla, claManager: false }))).toBe(false);
    expect(canManageInCclaConsole(agreement({ status: 'valid', claGroupId: 'g-anuket-005' }))).toBe(false);
    expect(canManageInCclaConsole(agreement({ kind: 'ICLA', pdfAvailable: true, ...managerEcla }))).toBe(false);
    expect(canManageInCclaConsole(agreement({ status: 'revoked', ...managerEcla }))).toBe(false);
    expect(canManageInCclaConsole(agreement({ status: 'valid', claManager: true }))).toBe(false);
    expect(canManageInCclaConsole(agreement({ status: 'valid', claManager: true, claGroupId: '   ' }))).toBe(false);
  });
});

describe('cclaConsoleUrl', () => {
  const base = 'https://lfx.dev.platform.linuxfoundation.org';

  it('strips every trailing slash from the configured base', () => {
    expect(cclaConsoleUrl(`${base}///`, 'found-1')).toBe(`${base}/foundation/found-1/cla`);
    expect(cclaConsoleUrl('///')).toBe('/company/dashboard');
  });

  it('joins a foundation-level CLA group as /foundation/{id}/cla', () => {
    expect(cclaConsoleUrl(`${base}/`, 'a09P000000DsCE5IAN')).toBe(`${base}/foundation/a09P000000DsCE5IAN/cla`);
    expect(cclaConsoleUrl(base, 'a09P000000DsCE5IAN', 'a09P000000DsCE5IAN')).toBe(`${base}/foundation/a09P000000DsCE5IAN/cla`);
  });

  it('joins a project-level CLA group under its foundation', () => {
    expect(cclaConsoleUrl(base, 'found-parent', 'proj-sfid-1')).toBe(`${base}/foundation/found-parent/project/proj-sfid-1/cla`);
  });

  it('falls back to the company dashboard when neither Salesforce id is present', () => {
    expect(cclaConsoleUrl(`${base}/`)).toBe(`${base}/company/dashboard`);
    expect(cclaConsoleUrl(base, '  ', '')).toBe(`${base}/company/dashboard`);
  });

  // Both console routes are keyed on the foundation, so a project id alone addresses nothing.
  // Putting it in the foundation segment would mint a URL that 404s instead of landing somewhere real.
  it('falls back to the company dashboard when only a project id is present', () => {
    expect(cclaConsoleUrl(base, undefined, 'proj-sfid-1')).toBe(`${base}/company/dashboard`);
    expect(cclaConsoleUrl(base, '  ', 'proj-sfid-1')).toBe(`${base}/company/dashboard`);
  });
});
