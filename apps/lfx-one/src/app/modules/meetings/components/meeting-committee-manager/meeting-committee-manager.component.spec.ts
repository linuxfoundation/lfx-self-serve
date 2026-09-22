// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { Committee, CommitteeMember, CommitteeMemberVotingStatus, MeetingCommittee } from '@lfx-one/shared';
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

/** The same, carrying the voting status the voting-status filter reads. */
function votingMember(committeeUid: string, email: string, status: CommitteeMemberVotingStatus): CommitteeMember {
  return { ...member(committeeUid, email), voting: { status } } as CommitteeMember;
}

const VOTING_BOARD = { ...BOARD, enable_voting: true } as Committee;

/**
 * Mounts the manager over `saved` groups, with each committee's member fetch supplied by `members`.
 * @returns the emissions of `committeeMembersChange`, in order, and the mounted component.
 */
async function mount(
  saved: MeetingCommittee[],
  members: Record<string, Observable<CommitteeMember[]>>,
  // An observable rather than only a list, so a test can supply the failing options fetch that
  // `initCommitteeOptions` maps onto an empty one — indistinguishable in the result, opposite in cause.
  options: Committee[] | Observable<Committee[]> = [BOARD],
  projectUid: string | null = 'project-1',
  // Composer-like: parent `committees` already holds the saved groups. Default `[]` hid the first-
  // load wipe — `reconcileVotingFilter` writing `[]` over `[]` is a no-op in the assertions.
  seedParentCommittees = false
) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: ProjectContextService, useValue: { activeContextUid: () => projectUid } },
      {
        provide: CommitteeService,
        useValue: {
          getCommitteesByProjectOrThrow: vi.fn().mockReturnValue(Array.isArray(options) ? of(options) : options),
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
      committees: new FormControl(seedParentCommittees ? saved : []),
      show_meeting_attendees: new FormControl(false),
      meeting_type: new FormControl('Technical'),
      restricted: new FormControl(false),
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

  it('reports its empty selection on a project that has no groups at all', async () => {
    const { emissions, resolved, fixture } = await mount([], {}, []);

    await fixture.whenStable();

    // "This project offers no groups" is an answer, so the empty selection settles and is reported
    // as covered. Reporting it is what keeps the consumer's gate answerable here: while this went
    // silent, a coverage report the consumer was waiting on simply never arrived.
    expect(emissions).toEqual([[]]);
    expect(resolved).toEqual([[]]);
  });

  it('reconciles a saved group even when the project offers no options to pick from', async () => {
    // The group-scoped create: the group arrives as context and renders locked, so the picker has
    // nothing to offer and no control to re-pick with. An options list that comes back empty used
    // to hold the selection unapplied forever — no roster, no coverage, Create disabled, and no
    // banner, because the member fetch that raises one was never started.
    const { component, emissions, resolved, fixture } = await mount(
      [{ uid: BOARD.uid } as MeetingCommittee],
      { [BOARD.uid]: of([member(BOARD.uid, 'chair@example.com')]) },
      []
    );

    await fixture.whenStable();

    expect(component.selectedCommitteeIds()).toEqual([BOARD.uid]);
    expect(resolved.at(-1)).toEqual([BOARD.uid]);
    // Asserted on the roster itself, not the decorated row: with no options loaded there is no
    // `name` to label the member with, and the display name is cosmetic. Who is invited is not.
    expect(emissions.at(-1)?.map((m) => m.email)).toEqual(['chair@example.com']);
  });

  it('reconciles a saved group even when the options fetch itself fails', async () => {
    // `initCommitteeOptions` swallows a failure into `of([])`, so this is the same dead end reached
    // by a broken request rather than an empty project. Settled-but-failed still has to reconcile.
    const { component, resolved, fixture } = await mount(
      [{ uid: BOARD.uid } as MeetingCommittee],
      { [BOARD.uid]: of([member(BOARD.uid, 'chair@example.com')]) },
      throwError(() => new Error('options boom'))
    );

    await fixture.whenStable();

    expect(component.selectedCommitteeIds()).toEqual([BOARD.uid]);
    expect(resolved.at(-1)).toEqual([BOARD.uid]);
    expect(component.membersFetchError()).toBe(false);
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

/**
 * Covers the voting-status filter's dependence on option metadata.
 * @description Applying a saved selection without waiting for a non-empty options list is what lets a
 * group-scoped create reconcile at all, but the filter that decides WHICH of that group's members are
 * invited reads `enable_voting` off the same missing metadata. Read naively, absent metadata says "no
 * voting anywhere" and the filter is skipped — so a saved meeting that invites only its voting reps
 * silently queues the whole roster instead. Too few guests is visible and correctable; too many is not.
 */
describe('MeetingCommitteeManagerComponent — voting-status filter without option metadata', () => {
  it('keeps a saved voting filter when the project offers no options to derive it from', async () => {
    const { component, emissions, fixture } = await mount(
      [{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee],
      {
        [BOARD.uid]: of([
          votingMember(BOARD.uid, 'rep@example.com', CommitteeMemberVotingStatus.VOTING_REP),
          votingMember(BOARD.uid, 'observer@example.com', CommitteeMemberVotingStatus.OBSERVER),
        ]),
      },
      []
    );

    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(true);
    expect(emissions.at(-1)?.map((m) => m.email)).toEqual(['rep@example.com']);
  });

  it('keeps it when the options fetch fails rather than coming back empty', async () => {
    const { component, emissions, fixture } = await mount(
      [{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee],
      {
        [BOARD.uid]: of([
          votingMember(BOARD.uid, 'rep@example.com', CommitteeMemberVotingStatus.VOTING_REP),
          votingMember(BOARD.uid, 'observer@example.com', CommitteeMemberVotingStatus.OBSERVER),
        ]),
      },
      throwError(() => new Error('options boom'))
    );

    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(true);
    expect(emissions.at(-1)?.map((m) => m.email)).toEqual(['rep@example.com']);
  });

  it('invites everyone when no filter was saved, since there is nothing to narrow by', async () => {
    const { component, emissions, fixture } = await mount(
      [{ uid: BOARD.uid } as MeetingCommittee],
      {
        [BOARD.uid]: of([
          votingMember(BOARD.uid, 'rep@example.com', CommitteeMemberVotingStatus.VOTING_REP),
          votingMember(BOARD.uid, 'observer@example.com', CommitteeMemberVotingStatus.OBSERVER),
        ]),
      },
      []
    );

    await fixture.whenStable();

    // The fallback stands in for missing metadata, not for a filter nobody set. Absent both, the
    // whole roster is the correct answer — the same one the pre-existing empty-selection path gives.
    expect(component.hasVotingEnabledCommittee()).toBe(false);
    expect(emissions.at(-1)?.map((m) => m.email)).toEqual(['rep@example.com', 'observer@example.com']);
  });

  it('defers to real metadata over the saved filter once the options land', async () => {
    // BOARD has `enable_voting: false`. With metadata present there is no guessing to do: the group
    // does not vote, so a stale saved filter must not narrow its roster.
    const { component, emissions, fixture } = await mount(
      [{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee],
      {
        [BOARD.uid]: of([
          votingMember(BOARD.uid, 'rep@example.com', CommitteeMemberVotingStatus.VOTING_REP),
          votingMember(BOARD.uid, 'observer@example.com', CommitteeMemberVotingStatus.OBSERVER),
        ]),
      },
      [BOARD]
    );

    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(false);
    expect(emissions.at(-1)?.map((m) => m.email)).toEqual(['rep@example.com', 'observer@example.com']);
  });

  it('still filters a voting-enabled group the normal way', async () => {
    const { component, emissions, fixture } = await mount(
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
    expect(emissions.at(-1)?.map((m) => m.email)).toEqual(['rep@example.com']);
  });
});

/**
 * Covers the same fallback on the two paths that PERSIST the filter, not just the one that applies it.
 * @description `hasVotingEnabledCommittee` is what keeps the roster narrowed when option metadata is
 * missing, but `updateParentForm` and the `committees` clearer used to read `enable_voting` off that
 * same absent metadata. Read naively there, the next interaction after a failed options load writes
 * `allowed_voting_statuses: []` and empties the picker — so the organizer sees a filter that is still
 * active, saves it, and invites the whole roster the saved meeting deliberately excluded.
 */
describe('MeetingCommitteeManagerComponent — persisting the filter without option metadata', () => {
  const savedVotingRep = [{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee];
  const boardMembers = {
    [BOARD.uid]: of([
      votingMember(BOARD.uid, 'rep@example.com', CommitteeMemberVotingStatus.VOTING_REP),
      votingMember(BOARD.uid, 'observer@example.com', CommitteeMemberVotingStatus.OBSERVER),
    ]),
  };

  /** What the parent form would send to the API for the first selected group. */
  const persisted = (component: MeetingCommitteeManagerComponent): string[] | undefined =>
    (component.form().get('committees')?.value as MeetingCommittee[] | null)?.[0]?.allowed_voting_statuses;

  it('keeps the saved statuses when the picker is touched after a failed options load', async () => {
    const { component, fixture } = await mount(
      savedVotingRep,
      boardMembers,
      throwError(() => new Error('options boom'))
    );
    await fixture.whenStable();

    // The organizer reopens the picker and re-confirms the same status — the `votingStatuses`
    // valueChanges path into `updateParentForm`.
    component.committeeForm.patchValue({ votingStatuses: component.selectedVotingStatuses() });
    await fixture.whenStable();

    expect(persisted(component)).toEqual(['voting_rep']);
  });

  it('keeps them when the group itself is re-selected', async () => {
    const { component, fixture } = await mount(savedVotingRep, boardMembers, []);
    await fixture.whenStable();

    // The `committees` valueChanges path: it both persists and clears the picker.
    component.committeeForm.get('committees')?.setValue([BOARD.uid]);
    await fixture.whenStable();

    expect(persisted(component)).toEqual(['voting_rep']);
    expect(component.selectedVotingStatuses()).not.toEqual([]);
  });

  it('still clears them once metadata says the group does not vote', async () => {
    // BOARD has `enable_voting: false`. With the options loaded there is nothing to fall back for,
    // so the stale saved filter must be dropped on the next interaction as it always was.
    const { component, fixture } = await mount(savedVotingRep, boardMembers, [BOARD]);
    await fixture.whenStable();

    component.committeeForm.get('committees')?.setValue([BOARD.uid]);
    await fixture.whenStable();

    expect(persisted(component)).toEqual([]);
    expect(component.selectedVotingStatuses()).toEqual([]);
  });

  it('hides the voting filter when the last group is cleared', async () => {
    const { component, fixture } = await mount(savedVotingRep, boardMembers, []);
    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(true);

    component.committeeForm.get('committees')?.setValue([]);
    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(false);
    expect(component.selectedVotingStatuses()).toEqual([]);
  });

  it('keeps a saved filter when only some selected groups have option metadata', async () => {
    const { component, fixture } = await mount(
      [{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee, { uid: LEGAL.uid } as MeetingCommittee],
      {
        [BOARD.uid]: boardMembers[BOARD.uid],
        [LEGAL.uid]: of([member(LEGAL.uid, 'counsel@example.com')]),
      },
      [BOARD]
    );
    await fixture.whenStable();

    component.committeeForm.get('committees')?.setValue([BOARD.uid, LEGAL.uid]);
    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(true);
    expect(persisted(component)).toEqual(['voting_rep']);
  });

  it('does not wipe saved parent committees when options settle before selection is applied', async () => {
    const { component, fixture } = await mount(savedVotingRep, boardMembers, [BOARD], 'project-1', true);
    await fixture.whenStable();

    const parent = component.form().get('committees')?.value as MeetingCommittee[];
    expect(parent.map((committee) => committee.uid)).toEqual([BOARD.uid]);
    expect(parent[0]?.allowed_voting_statuses).toEqual(['voting_rep']);
  });
});

/**
 * Covers the failed options load as a visible, retryable state rather than an empty picker.
 * @description `committeeOptionsSettled` maps a failed fetch onto `[]`, which is the right call
 * for applying a saved selection and the wrong call for the picker: an enabled empty multiselect
 * plus "Select groups to associate" tells the organizer this project has none. The banner has to
 * be the thing that renders, and Try again has to re-issue the fetch.
 */
describe('MeetingCommitteeManagerComponent — failed group-options fetch', () => {
  it('renders an error banner instead of an empty picker when the options fetch fails', async () => {
    const { component, fixture } = await mount(
      [],
      {},
      throwError(() => new Error('options boom'))
    );
    fixture.detectChanges();

    expect(component.committeeOptionsFailed()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="meeting-committee-options-error"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="meeting-committee-multi-select"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="meeting-committee-options-hint"]')).toBeNull();
  });

  it('does not throw or fetch when project context is missing', async () => {
    const { component, fixture } = await mount([], {}, [BOARD], null);
    fixture.detectChanges();

    expect(component.committeeOptionsFailed()).toBe(false);
    expect(component.committeeOptions()).toEqual([]);
    expect(TestBed.inject(CommitteeService).getCommitteesByProjectOrThrow).not.toHaveBeenCalled();
  });

  it('still presents a genuine empty list as a picker, not as a failure', async () => {
    const { component, fixture } = await mount([], {}, []);
    fixture.detectChanges();

    expect(component.committeeOptionsFailed()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="meeting-committee-options-error"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="meeting-committee-multi-select"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="meeting-committee-options-hint"]')).toBeTruthy();
  });

  it('re-issues the options fetch from the banner retry', async () => {
    const { component, fixture } = await mount(
      [],
      {},
      throwError(() => new Error('options boom'))
    );
    fixture.detectChanges();

    const committeeService = TestBed.inject(CommitteeService);
    vi.mocked(committeeService.getCommitteesByProjectOrThrow).mockReturnValue(of([BOARD]));

    const retry = fixture.nativeElement.querySelector('[data-testid="meeting-committee-options-retry"] button') as HTMLButtonElement | null;
    expect(retry).toBeTruthy();
    retry?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.committeeOptionsFailed()).toBe(false);
    expect(committeeService.getCommitteesByProjectOrThrow).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[data-testid="meeting-committee-options-error"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="meeting-committee-multi-select"]')).toBeTruthy();
  });

  it('drops a preserved filter when retry metadata says the group does not vote', async () => {
    const savedVotingRep = [{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee];
    const boardMembers = {
      [BOARD.uid]: of([
        votingMember(BOARD.uid, 'rep@example.com', CommitteeMemberVotingStatus.VOTING_REP),
        votingMember(BOARD.uid, 'observer@example.com', CommitteeMemberVotingStatus.OBSERVER),
      ]),
    };
    const { component, fixture } = await mount(
      savedVotingRep,
      boardMembers,
      throwError(() => new Error('options boom'))
    );
    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(true);

    const committeeService = TestBed.inject(CommitteeService);
    vi.mocked(committeeService.getCommitteesByProjectOrThrow).mockReturnValue(of([BOARD]));
    component.retryCommitteeOptions();
    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(false);
    expect(component.selectedVotingStatuses()).toEqual([]);
    expect((component.form().get('committees')?.value as MeetingCommittee[] | null)?.[0]?.allowed_voting_statuses).toEqual([]);
  });

  it('drops a filter the organizer edited during the failure window once retry metadata says the group does not vote', async () => {
    const savedVotingRep = [{ uid: BOARD.uid, allowed_voting_statuses: ['voting_rep'] } as MeetingCommittee];
    const boardMembers = {
      [BOARD.uid]: of([
        votingMember(BOARD.uid, 'rep@example.com', CommitteeMemberVotingStatus.VOTING_REP),
        votingMember(BOARD.uid, 'observer@example.com', CommitteeMemberVotingStatus.OBSERVER),
      ]),
    };
    const { component, fixture } = await mount(
      savedVotingRep,
      boardMembers,
      throwError(() => new Error('options boom'))
    );
    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(true);

    component.committeeForm.patchValue({
      votingStatuses: [...component.selectedVotingStatuses(), CommitteeMemberVotingStatus.OBSERVER],
    });
    await fixture.whenStable();

    expect(new Set((component.form().get('committees')?.value as MeetingCommittee[] | null)?.[0]?.allowed_voting_statuses)).toEqual(
      new Set(['voting_rep', 'observer'])
    );

    const committeeService = TestBed.inject(CommitteeService);
    vi.mocked(committeeService.getCommitteesByProjectOrThrow).mockReturnValue(of([BOARD]));
    component.retryCommitteeOptions();
    await fixture.whenStable();

    expect(component.hasVotingEnabledCommittee()).toBe(false);
    expect(component.selectedVotingStatuses()).toEqual([]);
    expect((component.form().get('committees')?.value as MeetingCommittee[] | null)?.[0]?.allowed_voting_statuses).toEqual([]);
  });
});

describe('MeetingCommitteeManagerComponent — attendee visibility default', () => {
  const VISIBLE_BOARD = { ...BOARD, show_meeting_attendees: true } as Committee;

  it('turns the meeting toggle on when a selected committee has attendee visibility enabled', async () => {
    const { component, fixture } = await mount([], {}, [VISIBLE_BOARD]);
    component.committeeForm.get('committees')?.setValue([VISIBLE_BOARD.uid]);
    await fixture.whenStable();
    expect(component.form().get('show_meeting_attendees')?.value).toBe(true);
  });

  it('does not enable a locked meeting toggle from a committee preference', async () => {
    const { component, fixture } = await mount([], {}, [VISIBLE_BOARD]);
    component.form().get('meeting_type')?.setValue('Board');
    component.form().get('show_meeting_attendees')?.disable();
    component.committeeForm.get('committees')?.setValue([VISIBLE_BOARD.uid]);
    await fixture.whenStable();
    expect(component.form().get('show_meeting_attendees')?.value).toBe(false);
  });

  it('reapplies the committee preference when the lock lifts', async () => {
    const { component, fixture } = await mount([], {}, [VISIBLE_BOARD]);
    component.form().get('meeting_type')?.setValue('Board');
    component.committeeForm.get('committees')?.setValue([VISIBLE_BOARD.uid]);
    await fixture.whenStable();
    expect(component.form().get('show_meeting_attendees')?.value).toBe(false);

    component.form().get('meeting_type')?.setValue('Technical');
    await fixture.whenStable();
    expect(component.form().get('show_meeting_attendees')?.value).toBe(true);
  });

  it('keeps the committee preference pending across locked→locked, then applies on unlock', async () => {
    const { component, fixture } = await mount([], {}, [VISIBLE_BOARD]);
    component.form().get('meeting_type')?.setValue('Board');
    component.committeeForm.get('committees')?.setValue([VISIBLE_BOARD.uid]);
    await fixture.whenStable();
    expect(component.form().get('show_meeting_attendees')?.value).toBe(false);

    component.form().get('restricted')?.setValue(true);
    component.form().get('meeting_type')?.setValue('Technical');
    await fixture.whenStable();
    expect(component.form().get('show_meeting_attendees')?.value).toBe(false);

    component.form().get('restricted')?.setValue(false);
    await fixture.whenStable();
    expect(component.form().get('show_meeting_attendees')?.value).toBe(true);
  });

  it('does not reapply the committee preference when switching between unlocked types', async () => {
    const { component, fixture } = await mount([], {}, [VISIBLE_BOARD]);
    component.committeeForm.get('committees')?.setValue([VISIBLE_BOARD.uid]);
    await fixture.whenStable();
    expect(component.form().get('show_meeting_attendees')?.value).toBe(true);

    component.form().get('show_meeting_attendees')?.setValue(false);
    component.form().get('meeting_type')?.setValue('Maintainers');
    await fixture.whenStable();
    expect(component.form().get('show_meeting_attendees')?.value).toBe(false);
  });

  it('keeps an explicit opt-out that predates the lock, rather than reapplying on unlock', async () => {
    const { component, fixture } = await mount([], {}, [VISIBLE_BOARD]);
    component.committeeForm.get('committees')?.setValue([VISIBLE_BOARD.uid]);
    await fixture.whenStable();
    expect(component.form().get('show_meeting_attendees')?.value).toBe(true);

    // Turned off deliberately while the control was still available.
    component.form().get('show_meeting_attendees')?.setValue(false);

    component.form().get('meeting_type')?.setValue('Board');
    await fixture.whenStable();
    component.form().get('meeting_type')?.setValue('Technical');
    await fixture.whenStable();

    // The lock withheld nothing on the way in, so the unlock has nothing to restore — a round
    // trip through Board must not silently re-enable a toggle the organizer switched off.
    expect(component.form().get('show_meeting_attendees')?.value).toBe(false);
  });
});
