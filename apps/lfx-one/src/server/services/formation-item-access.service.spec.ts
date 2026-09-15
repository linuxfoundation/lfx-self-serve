// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkLFStaff = vi.fn();

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { checkLFStaff: () => checkLFStaff() },
}));

const { FormationItemAccessService } = await import('./formation-item-access.service');

describe('FormationItemAccessService', () => {
  const service = new FormationItemAccessService();
  const req = {} as Request;

  beforeEach(() => {
    checkLFStaff.mockReset();
  });

  it('allows anyone to complete a non-gating item, without checking LF-staff membership', async () => {
    const result = await service.canComplete(req, { is_gating: false });

    expect(result).toBe(true);
    expect(checkLFStaff).not.toHaveBeenCalled();
  });

  it('allows a gating item only for an LF-staff caller', async () => {
    checkLFStaff.mockResolvedValue(true);

    const result = await service.canComplete(req, { is_gating: true });

    expect(result).toBe(true);
    expect(checkLFStaff).toHaveBeenCalledTimes(1);
  });

  // Spec 044 / DR-002 (FR-010): gating-item completion is a write and stays staff-only. A
  // contractor-only caller is "not LF staff" here even though Org Lens now reads for them.
  it('denies a gating item for a caller outside lf-staff, including a contractor-only caller', async () => {
    checkLFStaff.mockResolvedValue(false);

    const result = await service.canComplete(req, { is_gating: true });

    expect(result).toBe(false);
  });
});
