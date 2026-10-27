// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, HttpParams } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CommitteeMemberAppointedBy, CommitteeMemberRole, CommitteeMemberVotingStatus } from '@lfx-one/shared/enums';
import {
  Committee,
  CommitteeInvite,
  CommitteeMember,
  CreateCommitteeMemberRequest,
  MemberPendingChanges,
  StagedCommitteeMemberRequest,
} from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImportMembersDialogComponent } from '../import-members-dialog/import-members-dialog.component';
import { CommitteeMembersManagerComponent } from './committee-members-manager.component';

const GROUP = {
  uid: 'committee-1',
  sso_group_name: 'example-group',
  name: 'Example Group',
  writer: true,
  enable_voting: false,
  business_email_required: false,
} as Committee;
const EXISTING = { uid: 'member-1', email: 'existing@example.com', first_name: 'Existing', last_name: 'Member' } as CommitteeMember;
const REQUEST: CreateCommitteeMemberRequest = {
  email: 'new@example.com',
  first_name: 'New',
  last_name: 'Member',
  job_title: 'Engineer',
  linkedin_profile: 'https://www.linkedin.com/in/example-person',
  organization: { id: null, name: 'Example Org', website: 'https://org.example' },
  role: { name: CommitteeMemberRole.LF_STAFF, start_date: '2026-01-01', end_date: '2027-01-01' },
  voting: { status: CommitteeMemberVotingStatus.OBSERVER, start_date: '2026-01-01', end_date: '2027-01-01' },
  appointed_by: CommitteeMemberAppointedBy.COMMUNITY,
};

describe('CommitteeMembersManagerComponent CSV import', () => {
  let fixture: ComponentFixture<CommitteeMembersManagerComponent>;
  let component: CommitteeMembersManagerComponent;
  let dialogClose: Subject<StagedCommitteeMemberRequest[] | undefined>;
  let dialogService: { open: ReturnType<typeof vi.fn> };
  let committeeService: {
    getCommittee: ReturnType<typeof vi.fn>;
    getCommitteeMembers: ReturnType<typeof vi.fn>;
    createCommitteeMember: ReturnType<typeof vi.fn>;
    getCommitteeInvites: ReturnType<typeof vi.fn>;
  };
  let updates: MemberPendingChanges[];

  async function setup(inputs: Record<string, unknown> = {}, membersResponse: Observable<CommitteeMember[]> = of([EXISTING])): Promise<void> {
    dialogClose = new Subject();
    dialogService = { open: vi.fn(() => ({ onClose: dialogClose })) };
    committeeService = {
      getCommittee: vi.fn(() => of(GROUP)),
      getCommitteeMembers: vi.fn(() => membersResponse),
      createCommitteeMember: vi.fn(),
      getCommitteeInvites: vi.fn().mockReturnValue(of([])),
    };
    await TestBed.configureTestingModule({
      imports: [CommitteeMembersManagerComponent],
      providers: [provideNoopAnimations(), MessageService, { provide: CommitteeService, useValue: committeeService }],
    })
      .overrideComponent(CommitteeMembersManagerComponent, {
        set: { providers: [ConfirmationService, { provide: DialogService, useValue: dialogService }] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(CommitteeMembersManagerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committeeId', GROUP.uid);
    fixture.componentRef.setInput('isEditMode', true);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    updates = [];
    component.memberUpdatesChange.subscribe((value) => updates.push(value));
    await fixture.whenStable();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  afterEach(() => TestBed.resetTestingModule());

  it.each([3, 10, 11, 110])('keeps all %i members searchable in a keyboard-accessible scroll region', async (count) => {
    const members = Array.from({ length: count }, (_, index) => ({
      ...EXISTING,
      uid: `member-${index}`,
      email: `member${index}@example.com`,
    }));
    await setup({}, of(members));

    const list = query('members-list')!;
    expect(list.getAttribute('role')).toBe('region');
    expect(list.getAttribute('aria-label')).toBe('Group members');
    expect(list.tabIndex).toBe(0);
    expect(list.classList.contains('overflow-y-auto')).toBe(true);
    expect(list.classList.contains('max-h-[64.5rem]')).toBe(true);
    const cards = list.querySelectorAll<HTMLElement>('[data-testid="member-card"]');
    expect(cards).toHaveLength(count);
    cards.forEach((card) => {
      expect(card.classList.contains('min-h-24')).toBe(true);
      expect(card.classList.contains('shrink-0')).toBe(true);
    });

    component.searchForm.controls['search'].setValue(members.at(-1)!.email);
    await fixture.whenStable();
    expect(query('members-list')?.querySelectorAll('[data-testid="member-card"]')).toHaveLength(1);
    expect(query('members-list')?.textContent).toContain(members.at(-1)!.email);
    expect(component.memberCount()).toBe(count);
  });

  it.each([true, false])('offers Import Members as a collect-only staging dialog when isEditMode is %s', async (isEditMode) => {
    await setup({ isEditMode });
    expect(query('import-members-csv-btn')?.textContent).toContain('Import Members');
    query('import-members-csv-btn')?.querySelector('button')?.click();
    expect(dialogService.open).toHaveBeenCalledWith(
      ImportMembersDialogComponent,
      expect.objectContaining({ data: expect.objectContaining({ collectOnly: true }) })
    );
    dialogClose.next([{ ...REQUEST, email: 'new@example.com', createOptions: { skipNotification: true } }]);
    await fixture.whenStable();
    expect(updates.at(-1)?.toAdd).toEqual([expect.objectContaining({ email: 'new@example.com', createOptions: { skipNotification: true } })]);
    expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
  });

  it('keeps Import Members unavailable until the newly created group is known', async () => {
    await setup({ committeeId: null, isEditMode: false });
    component.openImportMembersDialog();
    expect(committeeService.getCommitteeInvites).not.toHaveBeenCalled();
    expect(dialogService.open).not.toHaveBeenCalled();
  });

  it('uses live group settings and deduplicates against existing and staged members', async () => {
    await setup({
      organizationRequirements: { enable_voting: true, business_email_required: true },
      memberUpdates: { toAdd: [REQUEST], toUpdate: [], toDelete: [], toInvite: [] },
    });
    query('import-members-csv-btn')?.querySelector('button')?.click();
    expect(dialogService.open).toHaveBeenCalledWith(
      ImportMembersDialogComponent,
      expect.objectContaining({
        closable: false,
        closeOnEscape: false,
        dismissableMask: false,
        data: {
          committee: { ...GROUP, enable_voting: true, business_email_required: true },
          existingMembers: expect.arrayContaining([expect.objectContaining({ email: EXISTING.email }), expect.objectContaining({ email: REQUEST.email })]),
          existingInvites: [],
          collectOnly: true,
        },
      })
    );
  });

  it('stages 100 imported members for Update Group while preserving every supplied field', async () => {
    await setup();
    component.openImportMembersDialog();
    dialogClose.next(Array.from({ length: 100 }, (_, i) => ({ ...REQUEST, email: `person${i}@example.com` })));
    await fixture.whenStable();

    expect(component.memberCount()).toBe(101);
    expect(updates.at(-1)?.toAdd).toHaveLength(100);
    expect(updates.at(-1)?.toAdd[0]).toEqual({
      ...REQUEST,
      email: 'person0@example.com',
      organization: { name: 'Example Org', website: 'https://org.example' },
    });
    expect(query('members-list')?.textContent).toContain('New Member');
    expect(query('members-list')?.textContent).toContain('New');
    expect(query('members-list')?.querySelectorAll('[data-testid="member-card"]')).toHaveLength(101);
    expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
  });

  it('keeps imported members when the step is remounted and leaves them editable', async () => {
    await setup({ memberUpdates: { toAdd: [REQUEST], toUpdate: [], toDelete: [], toInvite: [] } });
    expect(component.memberCount()).toBe(2);
    const staged = component.membersWithState().find((member) => member.email === REQUEST.email)!;
    expect(staged).toMatchObject({ linkedin_profile: REQUEST.linkedin_profile, state: 'new' });
    component.handleMemberUpdate({ id: staged.tempId!, data: { ...staged, first_name: 'Changed' } });
    expect(updates.at(-1)?.toAdd[0]).toMatchObject({
      ...REQUEST,
      first_name: 'Changed',
      organization: { name: 'Example Org', website: 'https://org.example' },
    });
  });

  it('skips duplicate collected members and removes matching locally staged invitations', async () => {
    await setup({ memberUpdates: { toAdd: [], toUpdate: [], toDelete: [], toInvite: [{ invitee_email: REQUEST.email }] } });
    component.openImportMembersDialog();
    dialogClose.next([REQUEST, { ...REQUEST, email: 'NEW@EXAMPLE.COM' }, { email: EXISTING.email }]);
    expect(updates.at(-1)?.toAdd).toHaveLength(1);
    expect(updates.at(-1)?.toInvite).toEqual([]);
    expect(component.pendingInvites()).toEqual([]);
    expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
  });

  it('preserves other pending member changes when CSV members are staged', async () => {
    await setup({
      memberUpdates: { toAdd: [], toUpdate: [{ uid: EXISTING.uid, changes: { email: EXISTING.email, job_title: 'Updated' } }], toDelete: [], toInvite: [] },
    });
    component.openImportMembersDialog();
    dialogClose.next([REQUEST]);
    expect(updates.at(-1)?.toUpdate).toEqual([expect.objectContaining({ uid: EXISTING.uid, changes: expect.objectContaining({ job_title: 'Updated' }) })]);
    expect(updates.at(-1)?.toAdd).toHaveLength(1);
  });

  it('does not stage anything when the CSV dialog is cancelled', async () => {
    await setup();
    component.openImportMembersDialog();
    dialogClose.next(undefined);
    expect(updates).toEqual([]);
    expect(component.memberCount()).toBe(1);
  });

  it('requires complete member pagination and preserves staged changes when the snapshot fails', async () => {
    const membersResponse = new Subject<CommitteeMember[]>();
    const pending: MemberPendingChanges = { toAdd: [REQUEST], toUpdate: [], toDelete: [], toInvite: [] };
    await setup({ memberUpdates: pending }, membersResponse);
    expect(committeeService.getCommitteeMembers).toHaveBeenCalledExactlyOnceWith(GROUP.uid, expect.any(HttpParams));
    expect(committeeService.getCommitteeMembers.mock.calls[0][1].get('require_complete')).toBe('true');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // The strict BFF rejects the whole response when a later page exhausts retries.
      membersResponse.error(new HttpErrorResponse({ status: 503 }));
      await fixture.whenStable();
      expect(component.membersLoadFailed()).toBe(true);
      expect(component.mutationsDisabled()).toBe(true);
      expect(component.memberUpdates()).toEqual(pending);
      expect(component.membersWithState()).toEqual([expect.objectContaining({ email: REQUEST.email, state: 'new' })]);
      component.openImportMembersDialog();
      expect(dialogService.open).not.toHaveBeenCalled();
      expect(committeeService.getCommitteeInvites).not.toHaveBeenCalled();
      expect(updates).toEqual([]);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('stages 500 CSV rows in one emission with indexed invitation matches and retained options', async () => {
    await setup({ memberUpdates: { toAdd: [REQUEST], toUpdate: [], toDelete: [], toInvite: [] } });
    const members = Array.from({ length: 500 }, (_, index) => ({
      ...REQUEST,
      email: ` PERSON${index}@EXAMPLE.COM `,
      createOptions: { skipNotification: index % 2 === 0 },
    }));
    committeeService.getCommitteeInvites.mockReturnValue(
      of(
        members.flatMap((member, index) => [
          { uid: `invite-${index}-a`, invitee_email: member.email, status: 'pending' },
          { uid: `invite-${index}-b`, invitee_email: member.email.trim().toLowerCase(), status: 'pending' },
        ])
      )
    );
    component.openImportMembersDialog();
    dialogClose.next(members);

    expect(updates).toHaveLength(1);
    expect(updates[0].toAdd).toHaveLength(501);
    expect(
      new Set(
        component
          .membersWithState()
          .filter((member) => member.state === 'new')
          .map((member) => member.tempId)
      ).size
    ).toBe(501);
    for (let index = 0; index < 500; index++) {
      expect(updates[0].toAdd[index + 1]).toMatchObject({
        email: `person${index}@example.com`,
        first_name: REQUEST.first_name,
        organization: { name: 'Example Org', website: 'https://org.example' },
        createOptions: { skipNotification: index % 2 === 0 },
        pendingInviteUids: [`invite-${index}-a`, `invite-${index}-b`],
      });
    }
    expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
  });

  it.each(['loading', 'committeeLoading', 'membersLoadFailed', 'committeeLoadFailed'] as const)('blocks import while %s', async (state) => {
    await setup();
    component[state].set(true);
    await fixture.whenStable();
    expect((query('import-members-csv-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    component.openImportMembersDialog();
    expect(dialogService.open).not.toHaveBeenCalled();
  });

  it('blocks import while the parent is saving changes', async () => {
    await setup({ submitting: true });
    expect((query('import-members-csv-btn')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    component.openImportMembersDialog();
    expect(dialogService.open).not.toHaveBeenCalled();
  });

  it('ignores collected results if saving starts or the target group changes', async () => {
    await setup();
    component.openImportMembersDialog();
    fixture.componentRef.setInput('submitting', true);
    dialogClose.next([REQUEST]);
    expect(updates).toEqual([]);

    fixture.componentRef.setInput('submitting', false);
    component.openImportMembersDialog();
    fixture.componentRef.setInput('committeeId', 'committee-2');
    dialogClose.next([REQUEST]);
    expect(updates).toEqual([]);
  });

  it('unsubscribes from dialog results when the wizard step is destroyed', async () => {
    await setup();
    component.openImportMembersDialog();
    expect(dialogClose.observed).toBe(true);
    fixture.destroy();
    expect(dialogClose.observed).toBe(false);
    dialogClose.next([REQUEST]);
    expect(updates).toEqual([]);
  });

  it('loads server invitations before opening the collect-only preview', async () => {
    await setup();
    const invites = [{ uid: 'invite-1', invitee_email: REQUEST.email, status: 'pending' }] as CommitteeInvite[];
    committeeService.getCommitteeInvites.mockReturnValue(of(invites));
    component.openImportMembersDialog();
    expect(committeeService.getCommitteeInvites).toHaveBeenCalledExactlyOnceWith(GROUP.uid, expect.any(HttpParams));
    expect(committeeService.getCommitteeInvites.mock.calls[0][1].get('require_complete')).toBe('true');
    expect(dialogService.open.mock.calls[0][1].data.existingInvites).toEqual(invites);
  });

  it.each(['submitting', 'committeeId', 'destroyed'])('ignores an invitation fetch that finishes after %s changes', async (state) => {
    await setup();
    const response = new Subject<CommitteeInvite[]>();
    committeeService.getCommitteeInvites.mockReturnValue(response);
    component.openImportMembersDialog();
    component.openImportMembersDialog();
    expect(committeeService.getCommitteeInvites).toHaveBeenCalledTimes(1);
    expect(component.mutationsDisabled()).toBe(true);
    if (state === 'destroyed') {
      fixture.destroy();
      expect(response.observed).toBe(false);
    } else {
      fixture.componentRef.setInput(state, state === 'submitting' ? true : 'committee-2');
    }
    response.next([]);
    response.complete();
    expect(dialogService.open).not.toHaveBeenCalled();
  });

  it('fails closed on invitation-fetch errors and permits another attempt', async () => {
    await setup();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = new Subject<CommitteeInvite[]>();
      committeeService.getCommitteeInvites.mockReturnValue(response);
      component.openImportMembersDialog();
      response.error({ status: 503, error: { message: 'private@example.com' } });
      expect(dialogService.open).not.toHaveBeenCalled();
      expect(component.mutationsDisabled()).toBe(false);
      expect(errorLog).toHaveBeenCalledExactlyOnceWith('Failed to load invitations for CSV import', { status: 503 });
      committeeService.getCommitteeInvites.mockReturnValue(of([]));
      component.openImportMembersDialog();
      expect(dialogService.open).toHaveBeenCalledTimes(1);
    } finally {
      errorLog.mockRestore();
    }
  });

  it.each([false, true])('retains notification suppression %s and invitation IDs through staging, remount and editing', async (skipNotification) => {
    await setup();
    committeeService.getCommitteeInvites.mockReturnValue(of([{ uid: 'invite-1', invitee_email: REQUEST.email, status: 'pending' }]));
    component.openImportMembersDialog();
    dialogClose.next([{ ...REQUEST, createOptions: { skipNotification }, pendingInviteUids: ['invite-1'] }]);
    const pending = updates.at(-1)!;
    fixture.destroy();
    TestBed.resetTestingModule();
    await setup({ memberUpdates: pending });
    const staged = component.membersWithState().find((member) => member.email === REQUEST.email)!;
    component.handleMemberUpdate({ id: staged.tempId!, data: { ...staged, first_name: 'Changed' } });
    expect(updates.at(-1)?.toAdd[0]).toMatchObject({
      first_name: 'Changed',
      createOptions: { skipNotification },
      pendingInviteUids: ['invite-1'],
    });
    component.handleMemberUpdate({ id: staged.tempId!, data: { ...staged, email: 'different@example.com' } });
    expect(updates.at(-1)?.toAdd[0].createOptions).toEqual({ skipNotification });
    expect(updates.at(-1)?.toAdd[0].pendingInviteUids).toEqual([]);
    expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
  });

  it.each(['example-group', 'EXAMPLE-GROUP'])('opens imports from slug %s and fetches invitations with the resolved UUID', async (slug) => {
    await setup({ committeeId: slug });
    component.openImportMembersDialog();
    expect(committeeService.getCommitteeInvites).toHaveBeenCalledExactlyOnceWith(GROUP.uid, expect.any(HttpParams));
    expect(committeeService.getCommitteeInvites.mock.calls[0][1].get('require_complete')).toBe('true');
    expect(dialogService.open.mock.calls[0][1].data.committee.uid).toBe(GROUP.uid);
    dialogClose.next([{ ...REQUEST, createOptions: { skipNotification: true } }]);
    expect(updates.at(-1)?.toAdd).toHaveLength(1);
  });

  it('does not use the previous group snapshot when the route has changed to another group', async () => {
    await setup();
    fixture.componentRef.setInput('committeeId', 'unrelated-group');
    component.openImportMembersDialog();
    expect(committeeService.getCommitteeInvites).not.toHaveBeenCalled();
    expect(dialogService.open).not.toHaveBeenCalled();
  });

  it.each(['fetch', 'dialog'])('rejects a changed resolved UUID during the %s phase on an unchanged slug route', async (phase) => {
    await setup({ committeeId: 'example-group' });
    const response = new Subject<CommitteeInvite[]>();
    committeeService.getCommitteeInvites.mockReturnValue(response);
    component.openImportMembersDialog();
    if (phase === 'dialog') {
      response.next([]);
      response.complete();
      expect(dialogService.open).toHaveBeenCalledTimes(1);
    }
    component.committee.set({ ...GROUP, uid: 'committee-2' });
    if (phase === 'fetch') {
      response.next([]);
      response.complete();
      expect(dialogService.open).not.toHaveBeenCalled();
    } else {
      dialogClose.next([{ ...REQUEST, createOptions: { skipNotification: true } }]);
    }
    expect(updates).toEqual([]);
  });

  it('rematches corrected CSV emails against a parent-owned invitation snapshot across remounts', async () => {
    await setup();
    committeeService.getCommitteeInvites.mockReturnValue(
      of([
        { uid: 'old-address', invitee_email: REQUEST.email, status: 'pending' },
        { uid: 'corrected-1', invitee_email: ' CORRECTED@EXAMPLE.COM ', status: 'pending' },
        { uid: 'corrected-2', invitee_email: 'corrected@example.com', status: 'pending' },
        { uid: 'revoked', invitee_email: 'corrected@example.com', status: 'revoked' },
      ])
    );
    component.openImportMembersDialog();
    dialogClose.next([{ ...REQUEST, createOptions: { skipNotification: true }, pendingInviteUids: ['old-address'] }]);
    const pending = updates.at(-1)!;
    expect(pending.importInvites?.map((invite) => invite.uid)).toEqual(['old-address', 'corrected-1', 'corrected-2']);
    fixture.destroy();
    TestBed.resetTestingModule();
    await setup({ memberUpdates: pending });
    const staged = component.membersWithState().find((member) => member.email === REQUEST.email)!;
    component.handleMemberUpdate({ id: staged.tempId!, data: { ...staged, email: 'corrected@example.com' } });
    expect(updates.at(-1)?.toAdd[0]).toMatchObject({
      email: 'corrected@example.com',
      createOptions: { skipNotification: true },
      pendingInviteUids: ['corrected-1', 'corrected-2'],
    });
    expect(updates.at(-1)?.importInvites).toEqual(pending.importInvites);
    component.handleMemberUpdate({ id: staged.tempId!, data: { ...staged, email: 'uninvited@example.com' } });
    expect(updates.at(-1)?.toAdd[0].pendingInviteUids).toEqual([]);
    expect(committeeService.createCommitteeMember).not.toHaveBeenCalled();
  });
});
