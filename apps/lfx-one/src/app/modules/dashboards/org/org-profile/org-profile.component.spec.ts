// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { OrgCanonicalRecord } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgProfileService } from '@services/org-profile.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgProfileComponent } from './org-profile.component';

/**
 * LFXV2-3288 — `onLogoUpdated` only. The rest of this component (the load pipeline, edit-mode
 * toggle, canEdit gating) predates this feature and has no existing spec coverage; backfilling it
 * is out of scope here.
 */
describe('OrgProfileComponent — onLogoUpdated', () => {
  const record: OrgCanonicalRecord = {
    uid: '001Dn00000ExAmPleA',
    accountId: '001Dn00000ExAmPleA',
    name: 'Acme',
    description: null,
    website: null,
    primaryDomain: null,
    logoUrl: 'https://cdn.example.com/logo.png?v=1',
    industry: null,
    sector: null,
    numberOfEmployees: null,
    crunchBaseUrl: null,
    updatedAt: null,
    parentUid: null,
    isMember: true,
  };

  let fixture: ComponentFixture<OrgProfileComponent>;
  let updateCanonicalRecord: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    updateCanonicalRecord = vi.fn();

    await TestBed.configureTestingModule({
      imports: [OrgProfileComponent],
      providers: [
        {
          provide: AccountContextService,
          useValue: { selectedAccount: signal({ uid: record.uid }), updateCanonicalRecord },
        },
        { provide: OrgProfileService, useValue: { getCanonicalRecord: () => of(record), getAddresses: () => of(null) } },
        { provide: OrgRoleGrantsService, useValue: { writerSet: signal(new Set<string>()) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgProfileComponent);
    await fixture.whenStable();
  });

  it('patches the local record and propagates it to AccountContextService without leaving edit mode', () => {
    const updated = { ...record, logoUrl: 'https://cdn.example.com/logo.png?v=2' };
    fixture.componentInstance['editMode'].set(true);

    fixture.componentInstance['onLogoUpdated'](updated);

    expect(fixture.componentInstance['record']()).toEqual(updated);
    expect(updateCanonicalRecord).toHaveBeenCalledWith(updated);
    // A logo upload saves independently of the form's Save/Cancel, so it must not kick the user out.
    expect(fixture.componentInstance['editMode']()).toBe(true);
  });
});
