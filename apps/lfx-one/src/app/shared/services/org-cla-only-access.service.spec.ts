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
  const claManagerLookupFailed = signal(false);
  const writerSet = signal(new Set<string>());
  const inheritedAuditorSet = signal(new Set<string>());
  const isStaff = signal(false);
  const getBooleanFlag = vi.fn(() => flag);
  let service: OrgClaOnlyAccessService;

  beforeEach(() => {
    flag.set(false);
    claManagerOrgSet.set(new Set([UID]));
    claManagerLookupFailed.set(false);
    writerSet.set(new Set());
    inheritedAuditorSet.set(new Set());
    isStaff.set(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: FeatureFlagService, useValue: { getBooleanFlag } },
        {
          provide: OrgRoleGrantsService,
          useValue: {
            claManagerOrgSet,
            claManagerLookupFailed,
            isStaff,
            writerSet,
            auditorSet: signal(new Set<string>()),
            inheritedWriterSet: signal(new Set<string>()),
            inheritedAuditorSet,
          },
        },
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

  it('reports a failed CLA-manager lookup only while the flag is on', () => {
    claManagerLookupFailed.set(true);
    expect(service.lookupFailed()).toBe(false);

    flag.set(true);
    expect(service.lookupFailed()).toBe(true);
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

    // The selected organization skips the resolver on later navigations, so refreshed grants must clear it.
    it('stops being CLA-only once refreshed role grants open the organization', () => {
      flag.set(true);
      service.noteAddressed(ADDRESSED, true);

      writerSet.set(new Set([ADDRESSED]));
      expect(service.isClaOnly(ADDRESSED)).toBe(false);

      writerSet.set(new Set());
      inheritedAuditorSet.set(new Set([ADDRESSED]));
      expect(service.isClaOnly(ADDRESSED)).toBe(false);

      inheritedAuditorSet.set(new Set());
      isStaff.set(true);
      expect(service.isClaOnly(ADDRESSED)).toBe(false);
    });

    it('stays CLA-only while the refreshed grants open only other organizations', () => {
      flag.set(true);
      service.noteAddressed(ADDRESSED, true);
      writerSet.set(new Set(['0014100000OtherOrg']));

      expect(service.isClaOnly(ADDRESSED)).toBe(true);
    });
  });
});
