// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AccountContextService } from './account-context.service';
import { OrgLensViewModeService } from './org-lens-view-mode.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

const ACME = '0016100000ACMEAAA1';
const OTHER = '0016100000OTHERAAA1';

describe('OrgLensViewModeService', () => {
  let employeeViewOrgUid: WritableSignal<string | null>;
  let writerSet: WritableSignal<Set<string>>;
  let isStaff: WritableSignal<boolean>;
  let selected: WritableSignal<{ uid: string }>;

  beforeEach(() => {
    employeeViewOrgUid = signal<string | null>(null);
    writerSet = signal(new Set<string>());
    isStaff = signal(false);
    selected = signal({ uid: ACME });

    TestBed.configureTestingModule({
      providers: [
        {
          provide: OrgRoleGrantsService,
          useValue: {
            employeeViewOrgUid,
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

  it('follows the resolver answer for an addressed company, and clears it', () => {
    const service = TestBed.inject(OrgLensViewModeService);

    service.noteAddressed(ACME, true);
    expect(service.isEmployeeView()).toBe(true);

    service.noteAddressed(ACME, false);
    expect(service.isEmployeeView()).toBe(false);
  });

  it('is the full view when nothing is selected', () => {
    employeeViewOrgUid.set(ACME);
    selected.set({ uid: '' });

    expect(TestBed.inject(OrgLensViewModeService).viewMode()).toBe('full');
  });
});
