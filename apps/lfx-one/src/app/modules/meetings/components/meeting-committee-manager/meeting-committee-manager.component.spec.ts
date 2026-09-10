// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { Committee, CommitteeMember, MeetingCommittee } from '@lfx-one/shared';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MeetingCommitteeManagerComponent } from './meeting-committee-manager.component';

const BOARD = { uid: 'committee-board', name: 'Board', category: 'Board', enable_voting: false, public: true, sso_group_enabled: false } as Committee;
const LEGAL = { uid: 'committee-legal', name: 'Legal', category: 'Legal', enable_voting: false, public: true, sso_group_enabled: false } as Committee;

/** A member of `committeeUid`, carrying only the fields this component reads or forwards. */
function member(committeeUid: string, email: string): CommitteeMember {
  return { uid: `member-${email}`, committee_uid: committeeUid, email } as CommitteeMember;
}

/**
 * Mounts the manager over `saved` groups, with each committee's member fetch supplied by `members`.
 * @returns the emissions of `committeeMembersChange`, in order, and the mounted component.
 */
async function mount(saved: MeetingCommittee[], members: Record<string, Observable<CommitteeMember[]>>, options: Committee[] = [BOARD]) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ProjectContextService, useValue: { activeContextUid: () => 'project-1' } },
      {
        provide: CommitteeService,
        useValue: {
          getCommitteesByProject: vi.fn().mockReturnValue(of(options)),
          getCommitteeMembers: vi.fn((uid: string) => members[uid] ?? of([])),
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(MeetingCommitteeManagerComponent);
  const emissions: CommitteeMember[][] = [];

  fixture.componentRef.setInput('selectedCommittees', saved);
  fixture.componentRef.setInput(
    'form',
    new FormGroup({
      visibility: new FormControl('private'),
      committees: new FormControl([]),
      show_meeting_attendees: new FormControl(false),
    })
  );
  fixture.componentInstance.committeeMembersChange.subscribe((value) => emissions.push(value));

  await fixture.whenStable();

  return { component: fixture.componentInstance, emissions, fixture };
}

/**
 * Covers the gate on `committeeMembersChange`.
 * @description The consumer treats every emission as the complete membership of the selected groups
 * and marks anyone absent from it for deletion. An emission is therefore only safe once the fetch it
 * describes has actually settled: at mount the list is empty because nothing has been asked yet, and
 * after a failed fetch it is empty because the answer never came. Both look identical to a consumer,
 * and both would delete a saved roster.
 */
describe('MeetingCommitteeManagerComponent — committee member emissions', () => {
  it('stays silent until the members of a saved group have landed', async () => {
    const board = new Subject<CommitteeMember[]>();
    const { emissions, fixture } = await mount([{ uid: BOARD.uid } as MeetingCommittee], { [BOARD.uid]: board });

    // The mount-time empty list is an artifact of nothing having been fetched yet. Emitting it would
    // tell the composer this meeting's board group has no members, and the saved guests would go.
    expect(emissions).toEqual([]);

    // `forkJoin` gathers the per-committee fetches, so the response only counts once it completes.
    board.next([member(BOARD.uid, 'chair@example.com')]);
    board.complete();
    await fixture.whenStable();

    expect(emissions).toHaveLength(1);
    expect(emissions[0].map((entry) => entry.email)).toEqual(['chair@example.com']);
  });

  it('never emits when a member fetch fails', async () => {
    const { component, emissions } = await mount([{ uid: BOARD.uid } as MeetingCommittee], { [BOARD.uid]: throwError(() => new Error('boom')) });

    // "No members" and "we could not ask" arrive as the same empty array and mean opposite things.
    expect(emissions).toEqual([]);
    expect(component.membersFetchError()).toBe(true);
  });

  it('never emits when only one of several groups fails', async () => {
    const { component, emissions } = await mount(
      [{ uid: BOARD.uid } as MeetingCommittee, { uid: LEGAL.uid } as MeetingCommittee],
      { [BOARD.uid]: of([member(BOARD.uid, 'chair@example.com')]), [LEGAL.uid]: throwError(() => new Error('boom')) },
      [BOARD, LEGAL]
    );

    // A partial result reconciles as a complete one: the legal members would be read as removed.
    expect(emissions).toEqual([]);
    expect(component.membersFetchError()).toBe(true);
  });

  it('emits the empty list once the parent has told it there are no groups', async () => {
    const { emissions } = await mount([], {});

    // The mirror of the first case: an empty selection the parent actually applied is a truthful
    // answer, and withholding it would strand group guests the organizer has just deselected.
    expect(emissions).toEqual([[]]);
  });
});
