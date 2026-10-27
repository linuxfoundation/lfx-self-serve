// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { MyVoteBallot, PollAnswer, UserChoice, Vote } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteMyBallotComponent } from './vote-my-ballot.component';

const yes = { choice_id: 'c-yes', choice_text: 'Yes' };
const no = { choice_id: 'c-no', choice_text: 'No' };
const legal = { choice_id: 'c-legal', choice_text: 'Legal' };
const finance = { choice_id: 'c-finance', choice_text: 'Finance' };
const security = { choice_id: 'c-security', choice_text: 'Security' };

const VOTE: Vote = {
  uid: 'vote-1',
  name: 'Synthetic ratification',
  status: PollStatus.ACTIVE,
  project_uid: 'project-1',
  end_time: '2099-06-01T18:00:00Z',
  poll_type: PollType.GENERIC,
  poll_questions: [
    { question_id: 'q-1', prompt: 'Approve the charter?', type: 'single_choice', choices: [yes, no] },
    { question_id: 'q-2', prompt: 'Who reviews it?', type: 'multiple_choice', choices: [legal, finance, security] },
  ],
  poll_comment_prompts: [
    { prompt_id: 'p-1', prompt: 'Why?' },
    { prompt_id: 'p-2', prompt: 'Anything else?' },
  ],
} as Vote;

function answer(questionId: string, userChoice: UserChoice[], rankedChoice: UserChoice[] = []): PollAnswer {
  return { question_id: questionId, prompt: '', type: 'single_choice', user_choice: userChoice, ranked_user_choice: rankedChoice };
}

function ballot(overrides: Partial<MyVoteBallot> = {}): MyVoteBallot {
  return { vote_response_uid: 'vr-1', vote_uid: VOTE.uid, abstained: false, poll_answers: [], comment_responses: [], ...overrides };
}

describe('VoteMyBallotComponent (#4331)', () => {
  let fixture: ComponentFixture<VoteMyBallotComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VoteMyBallotComponent] }).compileComponents();
    fixture = TestBed.createComponent(VoteMyBallotComponent);
  });

  function render(vote: Vote, value: MyVoteBallot): void {
    fixture.componentRef.setInput('vote', vote);
    fixture.componentRef.setInput('ballot', value);
    fixture.detectChanges();
  }

  function text(testid: string): string | undefined {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`)?.textContent?.replace(/\s+/g, ' ').trim();
  }

  it('lists the selected choice of a single-choice question and every selected choice of a multiple-choice one', () => {
    render(VOTE, ballot({ poll_answers: [answer('q-1', [no]), { ...answer('q-2', [legal, security]), type: 'multiple_choice' }] }));

    expect(text('vote-my-ballot')).toContain('Your ballot');
    expect(text('vote-my-ballot-question-q-1')).toContain('Q1. Approve the charter?');
    expect(text('vote-my-ballot-choices-q-1')).toBe('No');
    expect(text('vote-my-ballot-choices-q-2')).toBe('Legal Security');
  });

  it('shows a ranked ballot in preference order', () => {
    const ranked = {
      ...VOTE,
      poll_type: PollType.MEEK_STV,
      poll_questions: [{ question_id: 'q-1', prompt: 'Rank the reviewers', type: 'single_choice', choices: [legal, finance, security] }],
    } as Vote;
    render(
      ranked,
      ballot({
        poll_answers: [
          answer(
            'q-1',
            [],
            [
              { ...security, choice_rank: 1 },
              { ...legal, choice_rank: 2 },
            ]
          ),
        ],
      })
    );

    expect(text('vote-my-ballot-question-q-1')).not.toContain('Q1.');
    expect(text('vote-my-ballot-ranked-q-1')).toBe('1 Security 2 Legal');
  });

  it('shows an abstention instead of choices', () => {
    render(VOTE, ballot({ abstained: true }));

    expect(text('vote-my-ballot-abstained')).toBe('You abstained.');
    expect(text('vote-my-ballot-question-q-1')).toBeUndefined();
  });

  it('shows each comment, and "No comment." for a blank prompt', () => {
    render(
      VOTE,
      ballot({
        poll_answers: [answer('q-1', [yes])],
        comment_responses: [
          { prompt_id: 'p-1', comment_text: 'It is ready' },
          { prompt_id: 'p-2', comment_text: '  ' },
        ],
      })
    );

    expect(text('vote-my-ballot-comment-p-1')).toContain('It is ready');
    expect(text('vote-my-ballot-comment-p-1')).not.toContain('No comment.');
    expect(text('vote-my-ballot-comment-p-2')).toContain('No comment.');
  });
});
