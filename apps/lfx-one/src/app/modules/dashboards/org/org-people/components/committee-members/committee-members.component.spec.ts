// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { OrgPeopleCommitteeMembersResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgPeopleDirectoryStateService } from '@services/org-people-directory-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { Subject } from 'rxjs';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { CommitteeMembersService } from '../../services/committee-members.service';
import { CommitteeMembersComponent } from './committee-members.component';

describe('CommitteeMembersComponent — render platform', () => {
  let getCommitteeMembers: Mock<(orgUid: string) => Subject<OrgPeopleCommitteeMembersResponse>>;
  let fixture: ComponentFixture<CommitteeMembersComponent>;

  async function mount(platformId: 'browser' | 'server'): Promise<void> {
    getCommitteeMembers = vi.fn(() => new Subject<OrgPeopleCommitteeMembersResponse>());
    await TestBed.configureTestingModule({
      imports: [CommitteeMembersComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: SYNTHETIC_ORG_ACCOUNT_ID, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: CommitteeMembersService, useValue: { getCommitteeMembers, reassignSeat: vi.fn() } },
        { provide: OrgRoleGrantsService, useValue: { editorSet: signal(new Set<string>()) } },
        { provide: OrgPeopleDirectoryStateService, useValue: { invalidate: vi.fn() } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeMembersComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  // The org-wide seat drain has not been observed holding SSR in prod, but the cause is not
  // established, so the server render requests nothing (guarded like org-groups, #2063).
  it('on the server, requests no roster and keeps the skeleton', async () => {
    await mount('server');

    expect(getCommitteeMembers).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="org-people-committee-table-skeleton"]')).not.toBeNull();
  });

  it('in the browser, requests the roster for the selected org', async () => {
    await mount('browser');

    expect(getCommitteeMembers).toHaveBeenCalledWith(SYNTHETIC_ORG_ACCOUNT_ID);
  });
});
