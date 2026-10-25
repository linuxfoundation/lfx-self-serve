// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PollStatus, PollType, VoteVoterStatus } from '@lfx-one/shared/enums';
import { Vote, VoteBallotDialogData, VoteVoter } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoteBallotDialogComponent } from '../vote-ballot-dialog/vote-ballot-dialog.component';
import { VoteReminderDialogComponent } from '../vote-reminder-dialog/vote-reminder-dialog.component';
import { VoteVotersComponent } from './vote-voters.component';

const YES = { choice_id: 'c-yes', choice_text: 'Yes' };
const NO = { choice_id: 'c-no', choice_text: 'No' };

const VOTE: Vote = {
  uid: 'vote-1',
  name: 'Approve the budget',
  end_time: '2026-11-01T00:00:00Z',
  status: PollStatus.ACTIVE,
  project_uid: 'project-1',
  poll_type: PollType.GENERIC,
  pseudo_anonymity: false,
  allow_abstain: true,
  poll_questions: [{ question_id: 'q-1', prompt: 'Approve?', type: 'single_choice', choices: [YES, NO] }],
};

function answer(choice: { choice_id: string; choice_text: string }) {
  return [{ question_id: 'q-1', prompt: 'Approve?', type: 'single_choice', user_choice: [choice], ranked_user_choice: [] }];
}

const VOTERS: VoteVoter[] = [
  {
    uid: 'b-avery',
    user_name: 'Avery Example',
    user_org_name: 'Acme Motors',
    user_voting_status: 'Voting Rep',
    status: VoteVoterStatus.VOTED,
    poll_answers: answer(YES),
  },
  { uid: 'b-blake', user_name: 'Blake Example', user_org_name: 'Beta Coastal', user_voting_status: 'Alternate', status: VoteVoterStatus.NOT_VOTED },
  { uid: 'b-casey', user_name: 'Casey Example', user_org_name: 'Acme Motors', user_voting_status: 'Voting Rep', status: VoteVoterStatus.ABSTAINED },
  {
    uid: 'b-drew',
    user_name: 'Drew Example',
    user_org_name: 'Beta Coastal',
    user_voting_status: 'Voting Rep',
    status: VoteVoterStatus.VOTED,
    poll_answers: answer(NO),
  },
];

interface MountOptions {
  vote?: Vote;
  voters?: () => Observable<VoteVoter[]>;
  initialChoice?: string | null;
  initialBallotUid?: string | null;
}

async function mount(options: MountOptions = {}) {
  TestBed.resetTestingModule();

  const getVoteVoters = vi.fn(options.voters ?? (() => of(VOTERS)));
  const dialogClose$ = new Subject<unknown>();
  const open = vi.fn().mockReturnValue({ onClose: dialogClose$ });

  TestBed.configureTestingModule({
    imports: [VoteVotersComponent],
    providers: [
      { provide: VoteService, useValue: { getVoteVoters } },
      { provide: DialogService, useValue: { open } },
    ],
  });

  const fixture = TestBed.createComponent(VoteVotersComponent);
  fixture.componentRef.setInput('vote', options.vote ?? VOTE);
  fixture.componentRef.setInput('initialChoice', options.initialChoice ?? null);
  fixture.componentRef.setInput('initialBallotUid', options.initialBallotUid ?? null);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, component: fixture.componentInstance, getVoteVoters, open, dialogClose$ };
}

function byTestId(fixture: ComponentFixture<VoteVotersComponent>, id: string): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
}

function rowUids(fixture: ComponentFixture<VoteVotersComponent>): string[] {
  return [...fixture.nativeElement.querySelectorAll('[data-testid^="vote-voters-row-"]')].map((row: Element) =>
    row.getAttribute('data-testid')!.replace('vote-voters-row-', '')
  );
}

function statusLabels(component: VoteVotersComponent): string[] {
  return component['statusOptions']().map((option) => option.label);
}

async function settle(fixture: ComponentFixture<VoteVotersComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('VoteVotersComponent', () => {
  let current: ComponentFixture<VoteVotersComponent> | undefined;
  afterEach(() => {
    current?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads the voters for the vote and counts each status', async () => {
    const { fixture, component, getVoteVoters } = await mount();
    current = fixture;

    expect(getVoteVoters).toHaveBeenCalledWith('vote-1');
    expect(statusLabels(component)).toEqual(['All (4)', 'Voted (2)', 'Abstained (1)', 'Not voted yet (1)']);
    expect(byTestId(fixture, 'vote-voters-manager-notice')).not.toBeNull();
    expect(byTestId(fixture, 'vote-voters-updated')).not.toBeNull();
  });

  it('lists voters who have not voted first while the vote is open', async () => {
    const { fixture } = await mount();
    current = fixture;

    expect(rowUids(fixture)).toEqual(['b-blake', 'b-avery', 'b-casey', 'b-drew']);
    expect(byTestId(fixture, 'vote-voters-choice-b-blake')!.textContent).toContain('Not voted yet');
    expect(byTestId(fixture, 'vote-voters-choice-b-avery')!.textContent).toContain('Yes');
    expect(byTestId(fixture, 'vote-voters-choice-b-casey')!.textContent).toContain('Abstained');
  });

  it('orders a closed vote by choice, then abstained, then did not vote', async () => {
    const { fixture, component } = await mount({ vote: { ...VOTE, status: PollStatus.ENDED } });
    current = fixture;

    expect(rowUids(fixture)).toEqual(['b-avery', 'b-drew', 'b-casey', 'b-blake']);
    expect(statusLabels(component)).toContain('Did not vote (1)');
    expect(byTestId(fixture, 'vote-voters-choice-b-blake')!.textContent).toContain('Did not vote');
    expect(byTestId(fixture, 'vote-voters-updated')).toBeNull();
  });

  it('narrows rows and counts by name or organization search', async () => {
    vi.useFakeTimers();
    const { fixture, component } = await mount();
    current = fixture;

    component['filterForm'].controls.search.setValue('beta');
    vi.advanceTimersByTime(300);
    fixture.detectChanges();

    expect(rowUids(fixture)).toEqual(['b-blake', 'b-drew']);
    expect(statusLabels(component)).toEqual(['All (2)', 'Voted (1)', 'Abstained (0)', 'Not voted yet (1)']);
  });

  it('filters by role and by choice', async () => {
    const { fixture, component } = await mount();
    current = fixture;

    component['filterForm'].controls.role.setValue('Alternate');
    fixture.detectChanges();
    expect(rowUids(fixture)).toEqual(['b-blake']);

    component['filterForm'].controls.role.setValue(null);
    component['filterForm'].controls.choice.setValue('q-1:c-no');
    fixture.detectChanges();
    expect(rowUids(fixture)).toEqual(['b-drew']);
    expect(component['roleOptions']().map((option) => option.value)).toEqual(['Alternate', 'Voting Rep']);
  });

  it('filters by status pill and offers Clear filters when nothing matches', async () => {
    const { fixture, component } = await mount();
    current = fixture;

    component['onStatusFilterChange'](VoteVoterStatus.ABSTAINED);
    component['filterForm'].controls.choice.setValue('q-1:c-yes');
    fixture.detectChanges();
    expect(byTestId(fixture, 'vote-voters-no-matches')).not.toBeNull();

    component['clearFilters']();
    fixture.detectChanges();
    expect(rowUids(fixture)).toHaveLength(4);
  });

  it('offers a reminder while open with voters left, and reloads after a send', async () => {
    const { fixture, component, open, dialogClose$, getVoteVoters } = await mount();
    current = fixture;

    expect(byTestId(fixture, 'vote-voters-send-reminder')).not.toBeNull();
    component['openReminder']();
    expect(open).toHaveBeenCalledWith(VoteReminderDialogComponent, expect.objectContaining({ header: 'Send vote reminder', data: { vote: VOTE } }));

    dialogClose$.next(true);
    await settle(fixture);
    expect(getVoteVoters).toHaveBeenCalledTimes(2);
  });

  it('does not reload when the reminder dialog is cancelled', async () => {
    const { fixture, component, dialogClose$, getVoteVoters } = await mount();
    current = fixture;

    component['openReminder']();
    dialogClose$.next(undefined);
    await settle(fixture);
    expect(getVoteVoters).toHaveBeenCalledTimes(1);
  });

  it('hides the reminder after close and when everyone has voted', async () => {
    const closed = await mount({ vote: { ...VOTE, status: PollStatus.ENDED } });
    expect(byTestId(closed.fixture, 'vote-voters-send-reminder')).toBeNull();
    closed.fixture.destroy();

    const allVoted = await mount({ voters: () => of(VOTERS.filter((voter) => voter.status !== VoteVoterStatus.NOT_VOTED)) });
    current = allVoted.fixture;
    expect(byTestId(allVoted.fixture, 'vote-voters-send-reminder')).toBeNull();
  });

  it('opens a ballot with the filtered ballots in table order', async () => {
    const { fixture, component, open } = await mount();
    current = fixture;

    component['onStatusFilterChange'](VoteVoterStatus.VOTED);
    fixture.detectChanges();
    byTestId(fixture, 'vote-voters-open-ballot-b-drew')!.click();

    const [dialog, config] = open.mock.calls[0];
    const data = config.data as VoteBallotDialogData;
    expect(dialog).toBe(VoteBallotDialogComponent);
    expect(data.ballots.map((row) => row.uid)).toEqual(['b-avery', 'b-drew']);
    expect(data.index).toBe(1);
    expect(byTestId(fixture, 'vote-voters-open-ballot-b-blake')).toBeNull();
  });

  it('opens the linked ballot once after the list loads', async () => {
    const { fixture, component, open } = await mount({ initialBallotUid: 'b-casey' });
    current = fixture;

    expect(open).toHaveBeenCalledTimes(1);
    expect((open.mock.calls[0][1].data as VoteBallotDialogData).ballots[open.mock.calls[0][1].data.index].uid).toBe('b-casey');

    component['refresh']();
    await settle(fixture);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('applies a linked choice, and the abstain link selects the Abstained pill', async () => {
    const choice = await mount({ initialChoice: 'q-1:c-yes' });
    expect(rowUids(choice.fixture)).toEqual(['b-avery']);
    choice.fixture.destroy();

    const abstained = await mount({ initialChoice: 'status:abstained' });
    current = abstained.fixture;
    expect(abstained.component['statusFilter']()).toBe(VoteVoterStatus.ABSTAINED);
    expect(rowUids(abstained.fixture)).toEqual(['b-casey']);
  });

  it('shows an error with Retry that reloads the list', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    const { fixture, getVoteVoters } = await mount({
      voters: () => {
        calls += 1;
        return calls === 1 ? throwError(() => new Error('boom')) : of(VOTERS);
      },
    });
    current = fixture;

    expect(byTestId(fixture, 'vote-voters-error')).not.toBeNull();
    byTestId(fixture, 'vote-voters-retry')!.querySelector('button')!.click();
    await settle(fixture);

    expect(getVoteVoters).toHaveBeenCalledTimes(2);
    expect(byTestId(fixture, 'vote-voters-error')).toBeNull();
    expect(rowUids(fixture)).toHaveLength(4);
  });

  it('renders no counts or rows while loading', async () => {
    const pending = new Subject<VoteVoter[]>();
    const { fixture } = await mount({ voters: () => pending });
    current = fixture;

    expect(byTestId(fixture, 'vote-voters-status-loading')).not.toBeNull();
    expect(byTestId(fixture, 'vote-voters-status-pills')).toBeNull();
    expect(byTestId(fixture, 'vote-voters-loading')).not.toBeNull();
    expect(byTestId(fixture, 'vote-voters-send-reminder')).toBeNull();
  });

  it('shows the empty state when no one was invited', async () => {
    const { fixture } = await mount({ voters: () => of([]) });
    current = fixture;

    expect(byTestId(fixture, 'vote-voters-empty')).not.toBeNull();
  });
});
