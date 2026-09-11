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

  const resolved: string[][] = [];
  fixture.componentInstance.committeeMembersResolvedChange.subscribe((value) => resolved.push(value));

  await fixture.whenStable();

  return { component: fixture.componentInstance, emissions, resolved, fixture };
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

  /*
   * The banner used to read "re-select the groups to try again", which a scoped create cannot do: its
   * group arrives as `committeeContext` and renders locked, with no picker. Since a failed fetch
   * withholds both the roster and the coverage report, the composer would sit on a group it could
   * never reconcile and a Save that never re-enabled.
   */
  it('re-runs a failed member fetch over an unchanged selection', async () => {
    const responses: Record<string, Observable<CommitteeMember[]>> = { [BOARD.uid]: throwError(() => new Error('boom')) };
    const { component, emissions, resolved, fixture } = await mount([{ uid: BOARD.uid } as MeetingCommittee], responses);

    expect(component.membersFetchError()).toBe(true);
    expect(emissions).toEqual([]);

    responses[BOARD.uid] = of([member(BOARD.uid, 'chair@example.com')]);
    component.retryCommitteeMembers();
    await fixture.whenStable();

    // The selection never changed, so the fetch had to be re-triggered by something other than it.
    expect(component.membersFetchError()).toBe(false);
    expect(emissions).toHaveLength(1);
    expect(emissions[0].map((entry) => entry.email)).toEqual(['chair@example.com']);
    expect(resolved.at(-1)).toEqual([BOARD.uid]);
  });

  it('offers that retry in the banner itself', async () => {
    const responses: Record<string, Observable<CommitteeMember[]>> = { [BOARD.uid]: throwError(() => new Error('boom')) };
    const { emissions, fixture } = await mount([{ uid: BOARD.uid } as MeetingCommittee], responses);
    fixture.detectChanges();

    // The wiring is the point: a retry method no surface calls is the same dead end as before.
    const retry = fixture.nativeElement.querySelector('[data-testid="meeting-committee-members-retry"] button') as HTMLButtonElement | null;
    expect(retry).toBeTruthy();

    responses[BOARD.uid] = of([member(BOARD.uid, 'chair@example.com')]);
    retry?.click();
    await fixture.whenStable();

    expect(emissions).toHaveLength(1);
  });

  it('emits the empty list once the parent has told it there are no groups', async () => {
    const { emissions } = await mount([], {});

    // The mirror of the first case: an empty selection the parent actually applied is a truthful
    // answer, and withholding it would strand group guests the organizer has just deselected.
    expect(emissions).toEqual([[]]);
  });

  /*
   * Reopening an edit composer over a meeting that already has groups. The manager is rebuilt from
   * scratch every time the Guests section is entered, and each mount starts with an empty member
   * list and an outstanding fetch — the same shape as a meeting with no groups at all. The gate has
   * to hold across the whole of that window, not just its first tick: an `[]` anywhere before the
   * roster lands is read by the composer as "these groups have no members" and queues every saved
   * group guest for deletion.
   */
  it('never announces an empty roster while reopening over saved groups', async () => {
    const board = new Subject<CommitteeMember[]>();
    const { emissions, fixture } = await mount([{ uid: BOARD.uid } as MeetingCommittee], { [BOARD.uid]: board });

    // Change detection runs repeatedly while the drawer is open, and `selectedCommitteeIds` is set
    // from the parent's committees as well as from the multiselect, so the gate is asked more than
    // once per mount.
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    board.next([member(BOARD.uid, 'chair@example.com')]);
    board.complete();
    await fixture.whenStable();

    expect(emissions.filter((entry) => entry.length === 0)).toEqual([]);
    expect(emissions.map((entry) => entry.map((m) => m.email))).toEqual([['chair@example.com']]);
  });

  /*
   * The gate is per-fetch, not once-per-lifetime. Deselecting every group is an answer and has to
   * reach the composer, or the guests those groups contributed stay invited with nothing selected;
   * selecting one again reopens the question and must go quiet until the new fetch settles.
   */
  it('re-arms when the selection changes after the first roster has landed', async () => {
    const board = new Subject<CommitteeMember[]>();
    const { component, emissions, fixture } = await mount([{ uid: BOARD.uid } as MeetingCommittee], { [BOARD.uid]: board });

    board.next([member(BOARD.uid, 'chair@example.com')]);
    board.complete();
    await fixture.whenStable();
    expect(emissions).toHaveLength(1);

    component.committeeForm.get('committees')?.setValue([]);
    await fixture.whenStable();
    expect(emissions).toEqual([[expect.objectContaining({ email: 'chair@example.com' })], []]);
  });
});
/**
 * Covers the other half of the emission gate: reporting what its silence leaves uncovered.
 * @description The gate above is what keeps a half-known roster from reaching the composer, but the
 * selection itself is written to the parent form synchronously, so silence leaves the composer
 * holding a group and no members for it — for the length of the fetch, and indefinitely after a
 * failed one. A save in that window stores the group and invites nobody, which nothing afterwards
 * surfaces as wrong, so the surfaces gating save have to be able to tell "no members" from
 * "we don't know yet".
 *
 * What is reported is the selection each roster covered, not a pending flag. This component is only
 * mounted while the Guests section is showing, so a flag it last set can outlive the selection it
 * described; a uid list stays comparable against whatever the form holds later.
 */
describe('MeetingCommitteeManagerComponent — reported member coverage', () => {
  it('reports no coverage for a group until its members land, then reports that group', async () => {
    const board = new Subject<CommitteeMember[]>();
    const { component, resolved, fixture } = await mount([], { [BOARD.uid]: board });

    // Asserted as "nothing reported covers this group" rather than "nothing was reported at all":
    // an empty selection settles immediately and is reported as covered, which is both true and
    // harmless — the consumer's gate short-circuits on an empty selection anyway.
    expect(resolved.flat()).toEqual([]);

    component.committeeForm.get('committees')?.setValue([BOARD.uid]);
    await fixture.whenStable();

    // The selection is on the parent form from the synchronous setValue above; nothing may claim to
    // cover it until the fetch behind it settles, or a save in that gap slips through.
    expect(resolved.flat()).toEqual([]);

    board.next([member(BOARD.uid, 'chair@example.com')]);
    board.complete();
    await fixture.whenStable();

    expect(resolved.at(-1)).toEqual([BOARD.uid]);
  });

  it('reports nothing on a project that has no groups at all', async () => {
    const { emissions, resolved, fixture } = await mount([], {}, []);

    await fixture.whenStable();

    // Nothing is ever fetched here and nothing is ever emitted. The consumer's gate has to answer
    // from its own empty selection rather than from a coverage report that never arrives, or every
    // create in this project sits behind a group that does not exist.
    expect(emissions).toEqual([]);
    expect(resolved).toEqual([]);
  });

  it('reports no coverage after a failed member fetch, because the emission never comes', async () => {
    const { component, emissions, resolved, fixture } = await mount([{ uid: BOARD.uid } as MeetingCommittee], {
      [BOARD.uid]: throwError(() => new Error('boom')),
    });

    await fixture.whenStable();

    // The failure is settled, not in flight. Reporting coverage on "the fetch finished" would unblock
    // a save with the group on the form and none of its members queued.
    expect(component.membersFetchError()).toBe(true);
    expect(emissions).toEqual([]);
    expect(resolved).toEqual([]);
  });

  it('covers a successfully resolved empty group', async () => {
    const { emissions, resolved, fixture } = await mount([{ uid: BOARD.uid } as MeetingCommittee], { [BOARD.uid]: of([]) });

    await fixture.whenStable();

    // An empty group is a real answer. Withholding coverage for it would stop a save that has nothing
    // to wait for, with a group on the form that is genuinely complete.
    expect(emissions).toEqual([[]]);
    expect(resolved.at(-1)).toEqual([BOARD.uid]);
  });

  it('leaves the previous coverage standing when the selection swaps one group for another', async () => {
    const legal = new Subject<CommitteeMember[]>();
    const { component, resolved, fixture } = await mount(
      [{ uid: BOARD.uid } as MeetingCommittee],
      { [BOARD.uid]: of([member(BOARD.uid, 'chair@example.com')]), [LEGAL.uid]: legal },
      [BOARD, LEGAL]
    );

    await fixture.whenStable();
    expect(resolved.at(-1)).toEqual([BOARD.uid]);

    // One group out, one in. The last report still names the board, so a consumer comparing it against
    // the form's new selection sees the legal group as uncovered rather than inheriting the board's
    // answer — which a same-size count would have let through.
    component.committeeForm.get('committees')?.setValue([LEGAL.uid]);
    await fixture.whenStable();

    expect(resolved.at(-1)).toEqual([BOARD.uid]);

    legal.next([member(LEGAL.uid, 'counsel@example.com')]);
    legal.complete();
    await fixture.whenStable();

    expect(resolved.at(-1)).toEqual([LEGAL.uid]);
  });

  it('does not extend its coverage to a group added after the last snapshot', async () => {
    const legal = new Subject<CommitteeMember[]>();
    const { component, resolved, fixture } = await mount(
      [{ uid: BOARD.uid } as MeetingCommittee],
      { [BOARD.uid]: of([member(BOARD.uid, 'chair@example.com')]), [LEGAL.uid]: legal },
      [BOARD, LEGAL]
    );

    await fixture.whenStable();
    expect(resolved.at(-1)).toEqual([BOARD.uid]);

    // Adding a second group asks a new question. The standing report still describes the old selection,
    // so answering from it would call a roster complete that is missing a whole group.
    component.committeeForm.get('committees')?.setValue([BOARD.uid, LEGAL.uid]);
    await fixture.whenStable();

    expect(resolved.at(-1)).toEqual([BOARD.uid]);
  });

  it('announces the coverage before the roster it describes', async () => {
    const board = new Subject<CommitteeMember[]>();
    const { component, fixture } = await mount([], { [BOARD.uid]: board });

    const order: string[] = [];
    component.committeeMembersResolvedChange.subscribe(() => order.push('resolved'));
    component.committeeMembersChange.subscribe(() => order.push('members'));

    component.committeeForm.get('committees')?.setValue([BOARD.uid]);
    await fixture.whenStable();
    board.next([member(BOARD.uid, 'chair@example.com')]);
    board.complete();
    await fixture.whenStable();

    // The two answers are halves of one: a consumer reading the gate while handling the roster it was
    // just handed has to see it settled, or it blocks a save on members it is already holding.
    expect(order).toEqual(['resolved', 'members']);
  });
});
