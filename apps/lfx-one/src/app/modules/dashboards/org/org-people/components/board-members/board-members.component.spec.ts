// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { OrgPeopleBoardMembersResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgPeopleDirectoryStateService } from '@services/org-people-directory-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { Subject } from 'rxjs';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { BoardMembersService } from '../../services/board-members.service';
import { BoardMembersComponent } from './board-members.component';

describe('BoardMembersComponent — render platform', () => {
  let getBoardMembers: Mock<(orgUid: string) => Subject<OrgPeopleBoardMembersResponse>>;
  let fixture: ComponentFixture<BoardMembersComponent>;

  async function mount(platformId: 'browser' | 'server'): Promise<void> {
    getBoardMembers = vi.fn(() => new Subject<OrgPeopleBoardMembersResponse>());
    await TestBed.configureTestingModule({
      imports: [BoardMembersComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: SYNTHETIC_ORG_ACCOUNT_ID, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: BoardMembersService, useValue: { getBoardMembers, reassignSeat: vi.fn() } },
        { provide: OrgRoleGrantsService, useValue: { editorSet: signal(new Set<string>()) } },
        { provide: OrgPeopleDirectoryStateService, useValue: { invalidate: vi.fn() } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BoardMembersComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  // The org-wide seat drain has not been observed holding SSR in prod, but the cause is not
  // established, so the server render requests nothing (guarded like org-groups, #2063).
  it('on the server, requests no roster and keeps the skeleton', async () => {
    await mount('server');

    expect(getBoardMembers).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="org-people-board-table-skeleton"]')).not.toBeNull();
  });

  it('in the browser, requests the roster for the selected org', async () => {
    await mount('browser');

    expect(getBoardMembers).toHaveBeenCalledWith(SYNTHETIC_ORG_ACCOUNT_ID);
  });
});
