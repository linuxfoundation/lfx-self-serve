// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PollStatus, PollType, VoteVoterStatus } from '@lfx-one/shared/enums';
import { Vote, VoteBallotDialogData, VoteVoter } from '@lfx-one/shared/interfaces';
import { buildVoteVoterRowView } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoteBallotDialogComponent } from './vote-ballot-dialog.component';

const YES = { choice_id: 'c-yes', choice_text: 'Yes' };
const NO = { choice_id: 'c-no', choice_text: 'No' };
const ALICE = { choice_id: 'c-alice', choice_text: 'Alice' };
const BOB = { choice_id: 'c-bob', choice_text: 'Bob' };
const CARA = { choice_id: 'c-cara', choice_text: 'Cara' };

const BASE_VOTE: Vote = {
  uid: 'vote-1',
  name: 'Approve the budget',
  end_time: '2026-11-01T00:00:00Z',
  status: PollStatus.ENDED,
  project_uid: 'project-1',
  poll_type: PollType.GENERIC,
  pseudo_anonymity: false,
  poll_questions: [{ question_id: 'q-1', prompt: 'Approve?', type: 'single_choice', choices: [YES, NO] }],
  poll_comment_prompts: [{ prompt_id: 'p-1', prompt: 'Any concerns?' }],
};

function voter(overrides: Partial<VoteVoter> = {}): VoteVoter {
  return {
    uid: 'b-1',
    user_name: 'Avery Example',
    user_email: 'avery@acme-motors.example',
    user_org_name: 'Acme Motors',
    user_voting_status: 'Voting Rep',
    status: VoteVoterStatus.VOTED,
    submitted_at: '2026-10-20T10:00:00Z',
    poll_answers: [{ question_id: 'q-1', prompt: 'Approve?', type: 'single_choice', user_choice: [NO], ranked_user_choice: [] }],
    ...overrides,
  };
}

function mount(vote: Vote, voters: VoteVoter[], index = 0) {
  TestBed.resetTestingModule();
  const close = vi.fn();
  const data: VoteBallotDialogData = { vote, ballots: voters.map((entry) => buildVoteVoterRowView(vote, entry)), index };

  TestBed.configureTestingModule({
    imports: [VoteBallotDialogComponent],
    providers: [
      { provide: DynamicDialogRef, useValue: { close } },
      { provide: DynamicDialogConfig, useValue: { data } },
    ],
  });

  const fixture = TestBed.createComponent(VoteBallotDialogComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, close };
}

function byTestId(fixture: ComponentFixture<VoteBallotDialogComponent>, id: string): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
}

function button(fixture: ComponentFixture<VoteBallotDialogComponent>, id: string): HTMLButtonElement {
  return byTestId(fixture, id)!.querySelector('button')!;
}

describe('VoteBallotDialogComponent', () => {
  let current: ComponentFixture<VoteBallotDialogComponent> | undefined;
  afterEach(() => current?.destroy());

  it('shows the voter header and a single-choice ballot with the selected choice marked', () => {
    const { fixture } = mount(BASE_VOTE, [voter()]);
    current = fixture;

    expect(byTestId(fixture, 'vote-ballot-dialog-name')!.textContent).toContain('Avery Example');
    expect(byTestId(fixture, 'vote-ballot-dialog-email')!.textContent).toContain('avery@acme-motors.example');
    expect(byTestId(fixture, 'vote-ballot-dialog-organization')!.textContent).toContain('Acme Motors');
    expect(byTestId(fixture, 'vote-ballot-dialog-role')!.textContent).toContain('Voting Rep');
    expect(byTestId(fixture, 'vote-ballot-dialog-submitted')).not.toBeNull();
    expect(byTestId(fixture, 'vote-ballot-dialog-choice-c-no')!.getAttribute('data-selected')).toBe('true');
    expect(byTestId(fixture, 'vote-ballot-dialog-choice-c-yes')!.getAttribute('data-selected')).toBe('false');
    expect(byTestId(fixture, 'vote-ballot-dialog-choice-c-no')!.querySelector('.fa-circle-dot')).not.toBeNull();
    expect(byTestId(fixture, 'vote-ballot-dialog-active-notice')).toBeNull();
  });

  it('marks multiple-choice selections with checkboxes', () => {
    const vote: Vote = {
      ...BASE_VOTE,
      poll_questions: [{ question_id: 'q-1', prompt: 'Pick topics', type: 'multiple_choice', choices: [YES, NO, ALICE] }],
    };
    const { fixture } = mount(vote, [
      voter({ poll_answers: [{ question_id: 'q-1', prompt: 'Pick topics', type: 'multiple_choice', user_choice: [YES, ALICE], ranked_user_choice: [] }] }),
    ]);
    current = fixture;

    expect(byTestId(fixture, 'vote-ballot-dialog-choice-c-yes')!.querySelector('.fa-square-check')).not.toBeNull();
    expect(byTestId(fixture, 'vote-ballot-dialog-choice-c-alice')!.getAttribute('data-selected')).toBe('true');
    expect(byTestId(fixture, 'vote-ballot-dialog-choice-c-no')!.getAttribute('data-selected')).toBe('false');
  });

  it('lists a ranked ballot in preference order with the unranked choices after', () => {
    const vote: Vote = {
      ...BASE_VOTE,
      poll_type: PollType.MEEK_STV,
      poll_questions: [{ question_id: 'q-1', prompt: 'Rank the candidates', type: 'single_choice', choices: [ALICE, BOB, CARA] }],
    };
    const { fixture } = mount(vote, [
      voter({
        poll_answers: [
          {
            question_id: 'q-1',
            prompt: 'Rank the candidates',
            type: 'single_choice',
            user_choice: [],
            ranked_user_choice: [
              { ...CARA, choice_rank: 1 },
              { ...ALICE, choice_rank: 2 },
            ],
          },
        ],
      }),
    ]);
    current = fixture;

    const ranked = [...byTestId(fixture, 'vote-ballot-dialog-ranked-q-1')!.querySelectorAll('li')].map((item) => item.textContent!.replace(/\s+/g, ' ').trim());
    expect(ranked).toEqual(['1 Cara', '2 Alice']);
    expect(byTestId(fixture, 'vote-ballot-dialog-unranked-q-1')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Not ranked: Bob');
  });

  it('numbers the questions of a multi-question ballot', () => {
    const vote: Vote = {
      ...BASE_VOTE,
      poll_questions: [
        { question_id: 'q-1', prompt: 'Approve?', type: 'single_choice', choices: [YES, NO] },
        { question_id: 'q-2', prompt: 'Who chairs?', type: 'single_choice', choices: [ALICE, BOB] },
      ],
    };
    const { fixture } = mount(vote, [
      voter({
        poll_answers: [
          { question_id: 'q-1', prompt: 'Approve?', type: 'single_choice', user_choice: [YES], ranked_user_choice: [] },
          { question_id: 'q-2', prompt: 'Who chairs?', type: 'single_choice', user_choice: [BOB], ranked_user_choice: [] },
        ],
      }),
    ]);
    current = fixture;

    expect(byTestId(fixture, 'vote-ballot-dialog-question-q-1')!.textContent).toContain('Q1.');
    expect(byTestId(fixture, 'vote-ballot-dialog-question-q-2')!.textContent).toContain('Q2.');
    expect(byTestId(fixture, 'vote-ballot-dialog-choice-c-bob')!.getAttribute('data-selected')).toBe('true');
  });

  it('shows an abstained notice instead of the questions', () => {
    const { fixture } = mount(BASE_VOTE, [voter({ status: VoteVoterStatus.ABSTAINED, poll_answers: [] })]);
    current = fixture;

    expect(byTestId(fixture, 'vote-ballot-dialog-abstained')).not.toBeNull();
    expect(byTestId(fixture, 'vote-ballot-dialog-question-q-1')).toBeNull();
  });

  it("shows the voter's comment, or No comment.", () => {
    const { fixture, component } = mount(BASE_VOTE, [
      voter({ comment_responses: [{ prompt_id: 'p-1', comment_text: 'Looks good to me' }] }),
      voter({ uid: 'b-2', user_name: 'Blake Example', comment_responses: [] }),
    ]);
    current = fixture;

    expect(byTestId(fixture, 'vote-ballot-dialog-comment-p-1')!.textContent).toContain('Looks good to me');
    component['next']();
    fixture.detectChanges();
    expect(byTestId(fixture, 'vote-ballot-dialog-no-comment-p-1')!.textContent).toContain('No comment.');
  });

  it('keeps missing and blank comments empty, including a prompt whose id matches a prototype key', () => {
    const vote: Vote = {
      ...BASE_VOTE,
      poll_comment_prompts: [
        { prompt_id: 'p-1', prompt: 'Any concerns?' },
        { prompt_id: '__proto__', prompt: 'Anything else?' },
      ],
    };
    const { fixture } = mount(vote, [voter({ comment_responses: [{ prompt_id: 'p-1', comment_text: '   ' }] })]);
    current = fixture;

    expect(byTestId(fixture, 'vote-ballot-dialog-no-comment-p-1')!.textContent).toContain('No comment.');
    expect(byTestId(fixture, 'vote-ballot-dialog-no-comment-__proto__')!.textContent).toContain('No comment.');
    expect(byTestId(fixture, 'vote-ballot-dialog-comment-__proto__')).toBeNull();
  });

  it('notes that an open vote shows the current ballot', () => {
    const { fixture } = mount({ ...BASE_VOTE, status: PollStatus.ACTIVE }, [voter()]);
    current = fixture;

    expect(byTestId(fixture, 'vote-ballot-dialog-active-notice')!.textContent).toContain("This is the voter's current ballot.");
  });

  it('steps through the ballots within bounds', () => {
    const { fixture, close } = mount(
      BASE_VOTE,
      [voter(), voter({ uid: 'b-2', user_name: 'Blake Example' }), voter({ uid: 'b-3', user_name: 'Casey Example' })],
      1
    );
    current = fixture;

    expect(byTestId(fixture, 'vote-ballot-dialog-position')!.textContent).toContain('2 of 3');
    expect(byTestId(fixture, 'vote-ballot-dialog-name')!.textContent).toContain('Blake Example');

    button(fixture, 'vote-ballot-dialog-previous').click();
    fixture.detectChanges();
    expect(byTestId(fixture, 'vote-ballot-dialog-name')!.textContent).toContain('Avery Example');
    expect(button(fixture, 'vote-ballot-dialog-previous').disabled).toBe(true);
    expect(button(fixture, 'vote-ballot-dialog-previous').getAttribute('aria-label')).toBe('Previous ballot');

    button(fixture, 'vote-ballot-dialog-next').click();
    button(fixture, 'vote-ballot-dialog-next').click();
    fixture.detectChanges();
    expect(byTestId(fixture, 'vote-ballot-dialog-position')!.textContent).toContain('3 of 3');
    expect(button(fixture, 'vote-ballot-dialog-next').disabled).toBe(true);

    button(fixture, 'vote-ballot-dialog-close').click();
    expect(close).toHaveBeenCalled();
  });
});
