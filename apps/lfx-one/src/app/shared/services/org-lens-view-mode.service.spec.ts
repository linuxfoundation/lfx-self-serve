// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { AccountContextService } from './account-context.service';
import { OrgLensViewModeService } from './org-lens-view-mode.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

const ACME = '0016100000ACMEAAA1';
const OTHER = '0016100000OTHERAAA1';

describe('OrgLensViewModeService', () => {
  let employeeViewOrgUid: WritableSignal<string | null>;
  let addressed: WritableSignal<ReadonlySet<string>>;
  let fullAccess: WritableSignal<ReadonlySet<string>>;
  let writerSet: WritableSignal<Set<string>>;
  let isStaff: WritableSignal<boolean>;
  let claManagerOrgSet: WritableSignal<Set<string>>;
  let claManagerLookupFailed: WritableSignal<boolean>;
  let lookupOutcome: WritableSignal<string>;
  let selected: WritableSignal<{ uid: string }>;

  beforeEach(() => {
    employeeViewOrgUid = signal<string | null>(null);
    addressed = signal<ReadonlySet<string>>(new Set());
    fullAccess = signal<ReadonlySet<string>>(new Set());
    writerSet = signal(new Set<string>());
    isStaff = signal(false);
    claManagerOrgSet = signal(new Set<string>());
    claManagerLookupFailed = signal(false);
    lookupOutcome = signal('ok');
    selected = signal({ uid: ACME });

    TestBed.configureTestingModule({
      providers: [
        {
          provide: OrgRoleGrantsService,
          useValue: {
            employeeViewOrgUid,
            // Mirrors the real service: the role-grants company plus any an address or selector row marked.
            employeeViewOrgUids: computed(() => {
              const granted = employeeViewOrgUid();
              return granted ? new Set([granted, ...addressed()]) : addressed();
            }),
            noteEmployeeViewAddressed: (uid: string, on: boolean) => {
              const next = new Set(addressed());
              if (on) next.add(uid);
              else next.delete(uid);
              addressed.set(next);
            },
            fullAccessOrgUids: fullAccess,
            noteFullAccessAddressed: (uid: string, on: boolean) => {
              const next = new Set(fullAccess());
              if (on) next.add(uid);
              else next.delete(uid);
              fullAccess.set(next);
            },
            writerSet,
            isStaff,
            claManagerOrgSet,
            claManagerLookupFailed,
            lookupOutcome,
            auditorSet: signal(new Set<string>()),
            inheritedWriterSet: signal(new Set<string>()),
            inheritedAuditorSet: signal(new Set<string>()),
          },
        },
        { provide: AccountContextService, useValue: { selectedAccount: selected } },
      ],
    });
  });

  it('is the full view when the server named no employee-view company', () => {
    const service = TestBed.inject(OrgLensViewModeService);

    expect(service.viewMode()).toBe('full');
    expect(service.isEmployeeView()).toBe(false);
  });

  it('is the employee view for the selected company the server named, and only that company', () => {
    employeeViewOrgUid.set(ACME);
    const service = TestBed.inject(OrgLensViewModeService);

    expect(service.isEmployeeView()).toBe(true);
    selected.set({ uid: OTHER });
    expect(service.viewMode()).toBe('full');
  });

  it('lets a real grant or LF staff win over the employee view', () => {
    employeeViewOrgUid.set(ACME);
    const service = TestBed.inject(OrgLensViewModeService);

    writerSet.set(new Set([ACME]));
    expect(service.viewMode()).toBe('full');

    writerSet.set(new Set());
    isStaff.set(true);
    expect(service.viewMode()).toBe('full');
  });

  it('follows the resolver or selector-row answer for a company, and clears it', () => {
    const service = TestBed.inject(OrgLensViewModeService);

    service.noteAddressed(ACME, true);
    expect(service.isEmployeeView()).toBe(true);

    service.noteAddressed(ACME, false);
    expect(service.isEmployeeView()).toBe(false);
  });

  it('is correct from the selector row alone when the role-grants answer never arrives', () => {
    // role-grants timed out: employeeViewOrgUid stays null; the org-items row said employeeView.
    const service = TestBed.inject(OrgLensViewModeService);

    service.noteAddressed(ACME, true);

    expect(employeeViewOrgUid()).toBeNull();
    expect(service.modeFor(ACME)).toBe('employee');
  });

  it('is the full view, and a full-access reader, for a company read through the authorizer even if it also qualifies as an employee', () => {
    employeeViewOrgUid.set(ACME);
    const service = TestBed.inject(OrgLensViewModeService);

    service.noteFullAccessAddressed(ACME, true);

    expect(service.viewMode()).toBe('full');
    expect(service.isFullAccessReader()).toBe(true);

    service.noteFullAccessAddressed(ACME, false);
    expect(service.isFullAccessReader()).toBe(false);
  });

  it('is the full view when nothing is selected', () => {
    employeeViewOrgUid.set(ACME);
    selected.set({ uid: '' });

    expect(TestBed.inject(OrgLensViewModeService).viewMode()).toBe('full');
  });

  describe('hidden pages and CLA Managers', () => {
    it('hides nothing in the full view', () => {
      expect(TestBed.inject(OrgLensViewModeService).hiddenPages()).toEqual([]);
    });

    it('hides every hidden page, EasyCLA included, in the employee view', () => {
      employeeViewOrgUid.set(ACME);
      const service = TestBed.inject(OrgLensViewModeService);

      expect(service.managesSelectedCompanyClas()).toBe(false);
      expect(service.hiddenPages()).toEqual(ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES);
      expect(service.hiddenPages()).toEqual(expect.arrayContaining(['easycla', 'initiatives', 'donations']));
    });

    it('keeps EasyCLA for an employee who is also a CLA Manager of the selected company, and hides the rest', () => {
      employeeViewOrgUid.set(ACME);
      claManagerOrgSet.set(new Set([ACME]));
      const service = TestBed.inject(OrgLensViewModeService);

      expect(service.managesSelectedCompanyClas()).toBe(true);
      expect(service.hiddenPages()).toEqual(ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES.filter((page) => page !== 'easycla'));
      expect(service.hiddenPages()).toContain('initiatives');
    });

    it('keeps EasyCLA open while the CLA scope lookup failed, since an unknown answer is not a denial', () => {
      employeeViewOrgUid.set(ACME);
      claManagerLookupFailed.set(true);
      const service = TestBed.inject(OrgLensViewModeService);

      expect(service.managesSelectedCompanyClas()).toBe(true);
      expect(service.hiddenPages()).not.toContain('easycla');
      expect(service.hiddenPages()).toContain('initiatives');
    });

    it('keeps EasyCLA open when the whole role-grants request failed, which also leaves the scope set empty and unknown', () => {
      employeeViewOrgUid.set(ACME);
      lookupOutcome.set('failed');

      expect(TestBed.inject(OrgLensViewModeService).hiddenPages()).not.toContain('easycla');
    });

    it('does not carry a CLA scope on another company over to the selected one', () => {
      employeeViewOrgUid.set(ACME);
      claManagerOrgSet.set(new Set([OTHER]));

      expect(TestBed.inject(OrgLensViewModeService).hiddenPages()).toContain('easycla');
    });
  });
});
