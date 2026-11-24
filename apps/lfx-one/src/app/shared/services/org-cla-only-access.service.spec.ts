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
  const employeeViewLookupFailed = signal(false);
  const writerSet = signal(new Set<string>());
  const inheritedAuditorSet = signal(new Set<string>());
  const isStaff = signal(false);
  const employeeViewOrgUids = signal<ReadonlySet<string>>(new Set());
  const fullAccessOrgUids = signal<ReadonlySet<string>>(new Set());
  let service: OrgClaOnlyAccessService;

  beforeEach(() => {
    employeeViewOrgUids.set(new Set());
    fullAccessOrgUids.set(new Set());
    claManagerOrgSet.set(new Set([UID]));
    claManagerLookupFailed.set(false);
    employeeViewLookupFailed.set(false);
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
            employeeViewLookupFailed,
            isStaff,
            writerSet,
            auditorSet: signal(new Set<string>()),
            inheritedWriterSet: signal(new Set<string>()),
            inheritedAuditorSet,
            employeeViewOrgUids,
            fullAccessOrgUids,
            // Mirrors the real service: a CLA-only answer drops the company from both reduced-mode sets.
            clearReducedModes: (uid: string) => {
              employeeViewOrgUids.set(new Set([...employeeViewOrgUids()].filter((value) => value !== uid)));
              fullAccessOrgUids.set(new Set([...fullAccessOrgUids()].filter((value) => value !== uid)));
            },
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

  it('lets proven employee access supersede CLA-only for the same company', () => {
    employeeViewOrgUids.set(new Set([UID]));

    expect(service.isClaOnly(UID)).toBe(false);
  });

  it('treats a company read at full width through the authorizer as full, not CLA-only, even for a CLA Manager', () => {
    fullAccessOrgUids.set(new Set([UID]));

    expect(service.isClaOnly(UID)).toBe(false);
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

  it('reports a failed all employee view lookup too, so the empty state offers Retry instead of "not an employee"', () => {
    expect(service.lookupFailed()).toBe(false);

    employeeViewLookupFailed.set(true);
    expect(service.lookupFailed()).toBe(true);

    employeeViewLookupFailed.set(false);
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

    it('becomes CLA-only even if an earlier role-grants answer had it as an employee-view or full-access company', () => {
      employeeViewOrgUids.set(new Set([ADDRESSED]));
      expect(service.isClaOnly(ADDRESSED)).toBe(false);

      service.noteAddressed(ADDRESSED, true);
      expect(service.isClaOnly(ADDRESSED)).toBe(true);

      fullAccessOrgUids.set(new Set([ADDRESSED]));
      expect(service.isClaOnly(ADDRESSED)).toBe(false);
      service.noteAddressed(ADDRESSED, true);
      expect(service.isClaOnly(ADDRESSED)).toBe(true);
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
