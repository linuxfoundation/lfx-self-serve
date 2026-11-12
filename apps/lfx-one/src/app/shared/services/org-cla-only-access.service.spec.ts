// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgClaOnlyAccessService } from './org-cla-only-access.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

describe('OrgClaOnlyAccessService', () => {
  const UID = '0014100000ClaOnlyA';
  const claManagerOrgSet = signal(new Set<string>());
  const claManagerLookupFailed = signal(false);
  const writerSet = signal(new Set<string>());
  const inheritedAuditorSet = signal(new Set<string>());
  const isStaff = signal(false);
  let service: OrgClaOnlyAccessService;

  beforeEach(() => {
    claManagerOrgSet.set(new Set([UID]));
    claManagerLookupFailed.set(false);
    writerSet.set(new Set());
    inheritedAuditorSet.set(new Set());
    isStaff.set(false);
    TestBed.configureTestingModule({
      providers: [
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

  it('reports the server set', () => {
    expect([...service.claOnlyOrgUids()]).toEqual([UID]);
    expect(service.isClaOnly(UID)).toBe(true);
    expect(service.isClaOnly('0014100000OtherOrg')).toBe(false);
    expect(service.isClaOnly(null)).toBe(false);
  });

  it('never narrows an organization the grants hold, even when the server set names it', () => {
    writerSet.set(new Set([UID]));
    expect(service.isClaOnly(UID)).toBe(false);

    writerSet.set(new Set());
    inheritedAuditorSet.set(new Set([UID]));
    expect(service.isClaOnly(UID)).toBe(false);
  });

  it('reports a failed CLA-manager lookup', () => {
    expect(service.lookupFailed()).toBe(false);

    claManagerLookupFailed.set(true);
    expect(service.lookupFailed()).toBe(true);
  });

  describe('an organization an address resolved as CLA-only', () => {
    const ADDRESSED = '0014100000AddressB';

    beforeEach(() => {
      claManagerOrgSet.set(new Set());
    });

    it('is CLA-only without entering the selector set', () => {
      service.noteAddressed(ADDRESSED, true);

      expect(service.isClaOnly(ADDRESSED)).toBe(true);
      expect(service.claOnlyOrgUids().size).toBe(0);
    });

    it('stops being CLA-only once a later resolve says otherwise', () => {
      service.noteAddressed(ADDRESSED, true);
      service.noteAddressed(ADDRESSED, false);

      expect(service.isClaOnly(ADDRESSED)).toBe(false);
    });

    // The selected organization skips the resolver on later navigations, so refreshed grants must clear it.
    it('stops being CLA-only once refreshed role grants open the organization', () => {
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
      service.noteAddressed(ADDRESSED, true);
      writerSet.set(new Set(['0014100000OtherOrg']));

      expect(service.isClaOnly(ADDRESSED)).toBe(true);
    });
  });
});
