// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isImpersonating: vi.fn(() => false) }));

vi.mock('../utils/auth-helper', () => ({ isImpersonating: () => mocks.isImpersonating() }));

const { isOrgLensEmployeeViewEnabled } = await import('./org-lens-employee-view-flag.helper');

const ENABLED = 'LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED';
const IMPERSONATION_ONLY = 'LFX_ORG_LENS_EMPLOYEE_VIEW_IMPERSONATION_ONLY';
const req = {} as unknown as Request;

describe('isOrgLensEmployeeViewEnabled', () => {
  beforeEach(() => {
    delete process.env[ENABLED];
    delete process.env[IMPERSONATION_ONLY];
    mocks.isImpersonating.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env[ENABLED];
    delete process.env[IMPERSONATION_ONLY];
  });

  it('is closed for everyone when neither flag is set, impersonating or not', () => {
    expect(isOrgLensEmployeeViewEnabled(req)).toBe(false);
    mocks.isImpersonating.mockReturnValue(true);
    expect(isOrgLensEmployeeViewEnabled(req)).toBe(false);
  });

  it('is open for every caller when the full flag is on', () => {
    process.env[ENABLED] = 'true';
    expect(isOrgLensEmployeeViewEnabled(req)).toBe(true);
    mocks.isImpersonating.mockReturnValue(true);
    expect(isOrgLensEmployeeViewEnabled(req)).toBe(true);
  });

  it('opens only under an active impersonation session when impersonation-only is on', () => {
    process.env[IMPERSONATION_ONLY] = 'true';
    expect(isOrgLensEmployeeViewEnabled(req)).toBe(false);
    mocks.isImpersonating.mockReturnValue(true);
    expect(isOrgLensEmployeeViewEnabled(req)).toBe(true);
  });

  it.each(['false', '0', 'flase', ''])('treats %j as off for impersonation-only, even while impersonating', (value) => {
    process.env[IMPERSONATION_ONLY] = value;
    mocks.isImpersonating.mockReturnValue(true);
    expect(isOrgLensEmployeeViewEnabled(req)).toBe(false);
  });
});
