// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ORG_LENS_CLA_M3_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FeatureFlagService } from './feature-flag.service';
import { OrgClaOnlyAccessService } from './org-cla-only-access.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

describe('OrgClaOnlyAccessService', () => {
  const UID = '0014100000ClaOnlyA';
  const flag = signal(false);
  const claManagerOrgSet = signal(new Set<string>());
  const getBooleanFlag = vi.fn(() => flag);
  let service: OrgClaOnlyAccessService;

  beforeEach(() => {
    flag.set(false);
    claManagerOrgSet.set(new Set([UID]));
    TestBed.configureTestingModule({
      providers: [
        { provide: FeatureFlagService, useValue: { getBooleanFlag } },
        { provide: OrgRoleGrantsService, useValue: { claManagerOrgSet } },
      ],
    });
    service = TestBed.inject(OrgClaOnlyAccessService);
  });

  it('reads org-lens-cla-m3-enabled, defaulting off', () => {
    expect(getBooleanFlag).toHaveBeenCalledWith(ORG_LENS_CLA_M3_ENABLED_FLAG, false);
  });

  it('reports no CLA-only organization while the flag is off', () => {
    expect(service.claOnlyOrgUids().size).toBe(0);
    expect(service.isClaOnly(UID)).toBe(false);
  });

  it('reports the server set while the flag is on', () => {
    flag.set(true);

    expect([...service.claOnlyOrgUids()]).toEqual([UID]);
    expect(service.isClaOnly(UID)).toBe(true);
    expect(service.isClaOnly('0014100000OtherOrg')).toBe(false);
    expect(service.isClaOnly(null)).toBe(false);
  });

  describe('an organization an address resolved as CLA-only', () => {
    const ADDRESSED = '0014100000AddressB';

    beforeEach(() => {
      claManagerOrgSet.set(new Set());
    });

    it('is CLA-only while the flag is on, without entering the selector set', () => {
      flag.set(true);
      service.noteAddressed(ADDRESSED, true);

      expect(service.isClaOnly(ADDRESSED)).toBe(true);
      expect(service.claOnlyOrgUids().size).toBe(0);
    });

    it('is not CLA-only while the flag is off', () => {
      service.noteAddressed(ADDRESSED, true);

      expect(service.isClaOnly(ADDRESSED)).toBe(false);
    });

    it('stops being CLA-only once a later resolve says otherwise', () => {
      flag.set(true);
      service.noteAddressed(ADDRESSED, true);
      service.noteAddressed(ADDRESSED, false);

      expect(service.isClaOnly(ADDRESSED)).toBe(false);
    });
  });
});
