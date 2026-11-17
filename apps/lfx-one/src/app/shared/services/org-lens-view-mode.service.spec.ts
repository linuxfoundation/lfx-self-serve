// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AccountContextService } from './account-context.service';
import { OrgLensViewModeService } from './org-lens-view-mode.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

const ACME = '0016100000ACMEAAA1';
const OTHER = '0016100000OTHERAAA1';

describe('OrgLensViewModeService', () => {
  let employeeViewOrgUid: WritableSignal<string | null>;
  let addressed: WritableSignal<ReadonlySet<string>>;
  let writerSet: WritableSignal<Set<string>>;
  let isStaff: WritableSignal<boolean>;
  let selected: WritableSignal<{ uid: string }>;

  beforeEach(() => {
    employeeViewOrgUid = signal<string | null>(null);
    addressed = signal<ReadonlySet<string>>(new Set());
    writerSet = signal(new Set<string>());
    isStaff = signal(false);
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
            writerSet,
            isStaff,
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

  it('is the full view when nothing is selected', () => {
    employeeViewOrgUid.set(ACME);
    selected.set({ uid: '' });

    expect(TestBed.inject(OrgLensViewModeService).viewMode()).toBe('full');
  });
});
