// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Members tab entry points for adding people, including the CSV import (GH-3849). Synthetic data only.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Committee, CommitteeInvite, CommitteeMember, MemberImportDialogResult } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddMemberDialogComponent } from '../add-member-dialog/add-member-dialog.component';
import { ImportMembersDialogComponent } from '../import-members-dialog/import-members-dialog.component';
import { CommitteeMembersComponent } from './committee-members.component';

const WRITER_GROUP = { uid: 'committee-1', name: 'Docs Working Group', writer: true, member_visibility: 'basic_profile' } as Committee;
const MEMBERS = [{ uid: 'member-1', email: 'ada@example.com', first_name: 'Ada', last_name: 'Example' }] as CommitteeMember[];
const INVITES = [{ uid: 'invite-1', invitee_email: 'grace@example.com', status: 'pending' }] as CommitteeInvite[];

describe('CommitteeMembersComponent add-people actions', () => {
  let fixture: ComponentFixture<CommitteeMembersComponent>;
  let component: CommitteeMembersComponent;
  let dialogClose: Subject<unknown>;
  let dialogService: { open: ReturnType<typeof vi.fn> };
  let committeeService: { getCommitteeMembers: ReturnType<typeof vi.fn> };
  let refreshes: number;

  async function setup(committee: Committee | null, inputs: Record<string, unknown> = {}): Promise<void> {
    dialogClose = new Subject<unknown>();
    dialogService = { open: vi.fn(() => ({ onClose: dialogClose })) };
    committeeService = { getCommitteeMembers: vi.fn(() => of([...MEMBERS, { uid: 'member-2' }, { uid: 'member-3' }])) };

    await TestBed.configureTestingModule({
      imports: [CommitteeMembersComponent],
      providers: [provideNoopAnimations(), MessageService, { provide: CommitteeService, useValue: committeeService }],
    })
      .overrideComponent(CommitteeMembersComponent, {
        set: { providers: [ConfirmationService, { provide: DialogService, useValue: dialogService }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CommitteeMembersComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', committee);
    fixture.componentRef.setInput('members', MEMBERS);
    fixture.componentRef.setInput('membersLoading', false);
    fixture.componentRef.setInput('invites', INVITES);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    refreshes = 0;
    component.refresh.subscribe(() => refreshes++);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  describe('as a group manager', () => {
    beforeEach(async () => setup(WRITER_GROUP));

    it('shows Import Members before Add Member', () => {
      const actions = Array.from(fixture.nativeElement.querySelectorAll('lfx-button')) as HTMLElement[];
      const importButton = query('import-members-csv-btn');
      const addButton = query('add-member-btn');
      expect(addButton).not.toBeNull();
      expect(importButton?.textContent).toContain('Import Members');
      expect(importButton?.textContent).not.toContain('CSV');
      expect(actions.indexOf(importButton!)).toBeLessThan(actions.indexOf(addButton!));
      expect(query('invite-member-btn')).toBeNull();
    });

    it('opens the import dialog with the group snapshot and only its own close controls', () => {
      query('import-members-csv-btn')?.querySelector('button')?.click();

      expect(dialogService.open).toHaveBeenCalledWith(
        ImportMembersDialogComponent,
        expect.objectContaining({
          closable: false,
          closeOnEscape: false,
          dismissableMask: false,
          data: { committee: WRITER_GROUP, existingMembers: MEMBERS, existingInvites: INVITES },
        })
      );
    });

    it.each(['membersLoading', 'invitesLoading'])('waits for %s before opening with the current group snapshot', async (loadingInput) => {
      fixture.componentRef.setInput('committee', { ...WRITER_GROUP, uid: 'committee-2' });
      fixture.componentRef.setInput(loadingInput, true);
      await fixture.whenStable();

      const button = query('import-members-csv-btn')?.querySelector('button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      button.click();
      component.openImportMembersDialog();
      expect(dialogService.open).not.toHaveBeenCalled();

      const members = [{ uid: 'member-2', email: 'lin@example.com' }] as CommitteeMember[];
      const invites = [{ uid: 'invite-2', invitee_email: 'new@example.com', status: 'pending' }] as CommitteeInvite[];
      fixture.componentRef.setInput('members', members);
      fixture.componentRef.setInput('invites', invites);
      fixture.componentRef.setInput(loadingInput, false);
      await fixture.whenStable();

      expect(button.disabled).toBe(false);
      button.click();
      expect(dialogService.open).toHaveBeenCalledExactlyOnceWith(
        ImportMembersDialogComponent,
        expect.objectContaining({ data: { committee: component.committee(), existingMembers: members, existingInvites: invites } })
      );
    });

    it('unsubscribes from import close when the host is destroyed', () => {
      vi.useFakeTimers();
      component.openImportMembersDialog();
      expect(dialogClose.observed).toBe(true);
      fixture.destroy();

      expect(dialogClose.observed).toBe(false);
      dialogClose.next({ added: 2, conflicts: 0 } satisfies MemberImportDialogResult);
      vi.advanceTimersByTime(3000);
      expect(refreshes).toBe(0);
      expect(committeeService.getCommitteeMembers).not.toHaveBeenCalled();
    });

    it('refreshes and polls for the cumulative added count after an import', () => {
      vi.useFakeTimers();
      component.openImportMembersDialog();
      dialogClose.next({ added: 2, conflicts: 1 } satisfies MemberImportDialogResult);

      expect(refreshes).toBe(1);
      vi.advanceTimersByTime(400);
      expect(committeeService.getCommitteeMembers).toHaveBeenCalledWith('committee-1');
      // 1 member before + 2 added = 3 — the poll stops and refreshes once more.
      expect(refreshes).toBe(2);
    });

    it('refreshes without polling after a conflict-only result', () => {
      vi.useFakeTimers();
      component.openImportMembersDialog();
      dialogClose.next({ added: 0, conflicts: 2 } satisfies MemberImportDialogResult);
      vi.advanceTimersByTime(3000);

      expect(refreshes).toBe(1);
      expect(committeeService.getCommitteeMembers).not.toHaveBeenCalled();
    });

    it('does nothing after a cancelled preview', () => {
      component.openImportMembersDialog();
      dialogClose.next({ added: 0, conflicts: 0 } satisfies MemberImportDialogResult);
      expect(refreshes).toBe(0);
    });

    it('ignores the result when the page has moved to a different group', async () => {
      component.openImportMembersDialog();
      fixture.componentRef.setInput('committee', { ...WRITER_GROUP, uid: 'committee-2' });
      await fixture.whenStable();
      dialogClose.next({ added: 3, conflicts: 0 } satisfies MemberImportDialogResult);

      expect(refreshes).toBe(0);
      expect(committeeService.getCommitteeMembers).not.toHaveBeenCalled();
    });

    it('keeps Add Member opening the existing direct-add dialog', () => {
      query('add-member-btn')?.querySelector('button')?.click();
      expect(dialogService.open).toHaveBeenCalledWith(
        AddMemberDialogComponent,
        expect.objectContaining({ data: expect.objectContaining({ mode: 'direct-add' }) })
      );
    });
  });

  it('hides the import from members who can only send invitations', async () => {
    await setup({ ...WRITER_GROUP, writer: false }, { canSendMemberInvites: true });

    expect(query('invite-member-btn')).not.toBeNull();
    expect(query('import-members-csv-btn')).toBeNull();
    component.openImportMembersDialog();
    expect(dialogService.open).not.toHaveBeenCalled();
  });

  it('hides every add action from read-only viewers', async () => {
    await setup({ ...WRITER_GROUP, writer: false });

    expect(query('add-member-btn')).toBeNull();
    expect(query('import-members-csv-btn')).toBeNull();
  });
});
