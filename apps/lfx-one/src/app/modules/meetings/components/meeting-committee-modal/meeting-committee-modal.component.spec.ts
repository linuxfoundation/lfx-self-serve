// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { Committee, CommitteeMember, CommitteeMemberVotingStatus, Meeting, MeetingCommittee } from '@lfx-one/shared';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MeetingCommitteeModalComponent } from './meeting-committee-modal.component';

const BOARD = { uid: 'committee-board', name: 'Board', category: 'Board', enable_voting: false, public: true, sso_group_enabled: false } as Committee;
const LEGAL = { uid: 'committee-legal', name: 'Legal', category: 'Legal', enable_voting: false, public: true, sso_group_enabled: false } as Committee;
const VOTING_BOARD = { ...BOARD, enable_voting: true } as Committee;

/** A member of `committeeUid`, carrying only the fields this component reads or forwards. */
function member(committeeUid: string, email: string): CommitteeMember {
  return { uid: `member-${email}`, committee_uid: committeeUid, email } as CommitteeMember;
}

/** The same, carrying the voting status the voting-status filter reads. */
function votingMember(committeeUid: string, email: string, status: CommitteeMemberVotingStatus): CommitteeMember {
  return { ...member(committeeUid, email), voting: { status } } as CommitteeMember;
}

/**
 * Mounts the modal over a meeting whose `committees` are `saved`.
 * @returns the mounted component, fixture, and the `updateMeeting` spy used to inspect persist.
 */
async function mount(
  saved: MeetingCommittee[],
  members: Record<string, Observable<CommitteeMember[]>>,
  options: Committee[] | Observable<Committee[]> = [BOARD]
) {
  TestBed.resetTestingModule();

  const updateMeeting = vi.fn().mockReturnValue(of(undefined));

  TestBed.configureTestingModule({
    providers: [
      { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      {
        provide: DynamicDialogConfig,
        useValue: { data: { meeting: { id: 'meeting-1', committees: saved } as Meeting } },
      },
      { provide: ProjectContextService, useValue: { activeContext: () => null, activeContextUid: () => 'project-1' } },
      {
        provide: CommitteeService,
        useValue: {
          getCommitteesByProject: vi.fn().mockReturnValue(Array.isArray(options) ? of(options) : options),
          getCommitteeMembers: vi.fn((uid: string) => members[uid] ?? of([])),
        },
      },
      { provide: MeetingService, useValue: { updateMeeting } },
      { provide: MessageService, useValue: { add: vi.fn() } },
    ],
  });

  const fixture = TestBed.createComponent(MeetingCommitteeModalComponent);
  await fixture.whenStable();

  return { component: fixture.componentInstance, fixture, updateMeeting };
}

/**
 * Covers the voting-status filter's dependence on option metadata in the group picker modal.
 * @description The manager's version of this was fixed in #2272; the modal still decided whether
 * voting filtering applies by reading `enable_voting` off `committees()`, whose `toSignal`
 * initial value is `[]` and whose `catchError` maps a failed fetch onto one. Absent metadata
 * was read as "no voting anywhere", so a saved filter was skipped on display and, on save,
 * written back as `allowed_voting_statuses: []`.
 */
describe('MeetingCommitteeModalComponent — voting-status filter without option metadata', () => {
  const boardMembers = {
    [BOARD.uid]: of([
      votingMember(BOARD.uid, 'rep@example.com', CommitteeMemberVotingStatus.VOTING_REP),
      votingMember(BOARD.uid, 'observer@example.com', CommitteeMemberVotingStatus.OBSERVER),
    ]),
  };

  it('keeps a saved voting filter when the project offers no options to derive it from', async () => {
    const { component, fixture } = await mount([{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee], boardMembers, []);

    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(true);
    expect(component.filteredCommitteeMembers().map((entry) => entry.email)).toEqual(['rep@example.com']);
  });

  it('keeps it when the options fetch fails rather than coming back empty', async () => {
    const { component, fixture } = await mount(
      [{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee],
      boardMembers,
      throwError(() => new Error('options boom'))
    );

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.hasVotingEnabledCommittee()).toBe(true);
    expect(component.filteredCommitteeMembers().map((entry) => entry.email)).toEqual(['rep@example.com']);
    expect(fixture.nativeElement.querySelector('[data-testid="meeting-voting-status-multi-select"]')).toBeTruthy();
  });

  it('invites everyone when no filter was saved, since there is nothing to narrow by', async () => {
    const { component, fixture } = await mount([{ uid: BOARD.uid } as MeetingCommittee], boardMembers, []);

    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(false);
    expect(component.filteredCommitteeMembers().map((entry) => entry.email)).toEqual(['rep@example.com', 'observer@example.com']);
  });

  it('defers to real metadata over the saved filter once the options land', async () => {
    const { component, fixture } = await mount([{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee], boardMembers, [BOARD]);

    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(false);
    expect(component.filteredCommitteeMembers().map((entry) => entry.email)).toEqual(['rep@example.com', 'observer@example.com']);
  });

  it('still filters a voting-enabled group the normal way', async () => {
    const { component, fixture } = await mount(
      [{ uid: VOTING_BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee],
      {
        [VOTING_BOARD.uid]: of([
          votingMember(VOTING_BOARD.uid, 'rep@example.com', CommitteeMemberVotingStatus.VOTING_REP),
          votingMember(VOTING_BOARD.uid, 'observer@example.com', CommitteeMemberVotingStatus.OBSERVER),
        ]),
      },
      [VOTING_BOARD]
    );

    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(true);
    expect(component.filteredCommitteeMembers().map((entry) => entry.email)).toEqual(['rep@example.com']);
  });
});

/**
 * Covers the same fallback on the paths that persist the filter, not just the one that applies it.
 * @description Re-selecting the group used to read `enable_voting` off the missing options list,
 * clear the picker, and let Save write `allowed_voting_statuses: []`. Both the clearer and Save
 * now read `hasVotingEnabledCommittee`, so a missing list cannot erase a filter the roster still
 * honours.
 */
describe('MeetingCommitteeModalComponent — persisting the filter without option metadata', () => {
  const savedVotingRep = [{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee];
  const boardMembers = {
    [BOARD.uid]: of([
      votingMember(BOARD.uid, 'rep@example.com', CommitteeMemberVotingStatus.VOTING_REP),
      votingMember(BOARD.uid, 'observer@example.com', CommitteeMemberVotingStatus.OBSERVER),
    ]),
  };

  it('keeps the saved statuses when the group is re-selected after a failed options load', async () => {
    const { component, fixture, updateMeeting } = await mount(
      savedVotingRep,
      boardMembers,
      throwError(() => new Error('options boom'))
    );
    await fixture.whenStable();

    component.form.get('committees')?.setValue([BOARD.uid]);
    await fixture.whenStable();

    expect(component.selectedVotingStatuses()).not.toEqual([]);

    component.form.get('votingStatuses')?.setValue([...component.selectedVotingStatuses(), CommitteeMemberVotingStatus.OBSERVER]);
    component.onSave();
    await fixture.whenStable();

    expect(updateMeeting).toHaveBeenCalled();
    expect(new Set(updateMeeting.mock.calls[0][1].committees[0].allowed_voting_statuses)).toEqual(new Set(['voting_rep', 'observer']));
  });

  it('still clears them once metadata says the group does not vote', async () => {
    const { component, fixture, updateMeeting } = await mount(savedVotingRep, boardMembers, [BOARD]);
    await fixture.whenStable();

    component.form.get('committees')?.setValue([BOARD.uid]);
    await fixture.whenStable();

    expect(component.selectedVotingStatuses()).toEqual([]);

    component.onSave();
    await fixture.whenStable();

    expect(updateMeeting).toHaveBeenCalled();
    expect(updateMeeting.mock.calls[0][1].committees[0].allowed_voting_statuses).toEqual([]);
  });

  it('clears the voting filter when the last group is deselected', async () => {
    const { component, fixture } = await mount(savedVotingRep, boardMembers, []);
    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(true);

    component.form.get('committees')?.setValue([]);
    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(false);
    expect(component.selectedVotingStatuses()).toEqual([]);
  });

  it('keeps a saved filter on save when only some selected groups have option metadata', async () => {
    const { component, fixture, updateMeeting } = await mount(
      [{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee, { uid: LEGAL.uid } as MeetingCommittee],
      {
        [BOARD.uid]: boardMembers[BOARD.uid],
        [LEGAL.uid]: of([member(LEGAL.uid, 'counsel@example.com')]),
      },
      [BOARD]
    );
    await fixture.whenStable();

    component.form.get('committees')?.setValue([BOARD.uid, LEGAL.uid]);
    await fixture.whenStable();

    component.form.get('votingStatuses')?.setValue([...component.selectedVotingStatuses(), CommitteeMemberVotingStatus.OBSERVER]);
    component.onSave();
    await fixture.whenStable();

    expect(updateMeeting).toHaveBeenCalled();
    expect(new Set(updateMeeting.mock.calls[0][1].committees[0].allowed_voting_statuses)).toEqual(new Set(['voting_rep', 'observer']));
    expect(updateMeeting.mock.calls[0][1].committees.map((committee: MeetingCommittee) => committee.uid)).toEqual([BOARD.uid, LEGAL.uid]);
  });
});
