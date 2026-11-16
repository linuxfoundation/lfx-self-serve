// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { VoteBallotSubmission, VoteLinkBallot, VoteLinkBallotState } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteBallotFormComponent } from './vote-ballot-form.component';

// Synthetic fixtures only.
const CHOICES = [
  { choice_id: 'c-a', choice_text: 'Alice' },
  { choice_id: 'c-b', choice_text: 'Bob' },
  { choice_id: 'c-c', choice_text: 'Carol' },
];

const baseBallot = (overrides: Partial<VoteLinkBallot> = {}): VoteLinkBallot => ({
  vote_uid: 'v-1',
  name: 'Synthetic vote',
  status: 'active',
  end_time: '2099-01-01T00:00:00Z',
  poll_type: 'generic',
  allow_abstain: true,
  pseudo_anonymity: false,
  poll_questions: [{ question_id: 'q1', prompt: 'Who?', type: 'single_choice', choices: CHOICES }],
  poll_comment_prompts: [{ prompt_id: 'p1', prompt: 'Comments?' }],
  ballot: { vote_status: 'awaiting_response', already_voted: false, voter_removed: false },
  ...overrides,
});

const votedState = (overrides: Partial<VoteLinkBallotState> = {}): VoteLinkBallotState => ({
  vote_status: 'responded',
  already_voted: true,
  voter_removed: false,
  abstained: false,
  poll_answers: [{ question_id: 'q1', prompt: 'Who?', type: 'single_choice', user_choice: [{ choice_id: 'c-b', choice_text: 'Bob' }] }],
  comment_responses: [{ prompt_id: 'p1', comment_text: 'Earlier note' }],
  ...overrides,
});

describe('VoteBallotFormComponent (#4363)', () => {
  let fixture: ComponentFixture<VoteBallotFormComponent>;
  let emitted: VoteBallotSubmission[];

  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) => el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const click = (id: string) => {
    (byId(id) as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  const submit = () => {
    byId('vote-link-submit-button')?.querySelector('button')?.click();
    fixture.detectChanges();
  };

  async function render(ballot: VoteLinkBallot, prefill: VoteLinkBallotState | null = null): Promise<void> {
    fixture = TestBed.createComponent(VoteBallotFormComponent);
    fixture.componentRef.setInput('ballot', ballot);
    fixture.componentRef.setInput('prefill', prefill);
    fixture.componentInstance.submitted.subscribe((s) => emitted.push(s));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    emitted = [];
    TestBed.configureTestingModule({ imports: [VoteBallotFormComponent], providers: [provideNoopAnimations()] });
  });

  it('keeps Submit disabled until a single-choice answer is picked, then emits it', async () => {
    await render(baseBallot());
    expect(byId('vote-link-submit-button')?.querySelector('button')?.disabled).toBe(true);

    (el().querySelector('#vote-link-choice-c-a') as HTMLInputElement).click();
    fixture.detectChanges();
    submit();

    expect(emitted).toEqual([{ abstain: false, userVoteContent: [{ question_id: 'q1', choice_ids: ['c-a'] }], commentResponses: undefined }]);
  });

  it('treats ITX majority as a single-choice ballot, not ranked', async () => {
    await render(baseBallot({ poll_type: 'majority' }));

    expect(el().querySelector('[cdkDropList]')).toBeNull();
    expect(el().querySelectorAll('p-radiobutton, p-radioButton')).toHaveLength(3);
  });

  it('renders a ranked ballot with up/down buttons of at least 44px, and emits ranked_choices in order', async () => {
    await render(baseBallot({ poll_type: 'instant_runoff_vote' }));

    expect(el().querySelectorAll('p-radiobutton, p-radioButton')).toHaveLength(0);
    for (const choice of CHOICES) {
      for (const dir of ['up', 'down']) {
        const button = byId(`vote-link-rank-${dir}-${choice.choice_id}`)!;
        expect(button.className).toContain('min-w-[44px]');
        expect(button.className).toContain('min-h-[44px]');
      }
    }

    click('vote-link-rank-down-c-a');
    submit();

    expect(emitted[0].userVoteContent).toEqual([
      {
        question_id: 'q1',
        ranked_choices: [
          { choice_id: 'c-b', choice_rank: 1 },
          { choice_id: 'c-a', choice_rank: 2 },
          { choice_id: 'c-c', choice_rank: 3 },
        ],
      },
    ]);
  });

  it('disables the first up and last down buttons on a ranked ballot', async () => {
    await render(baseBallot({ poll_type: 'condorcet_irv' }));

    expect((byId('vote-link-rank-up-c-a') as HTMLButtonElement).disabled).toBe(true);
    expect((byId('vote-link-rank-down-c-c') as HTMLButtonElement).disabled).toBe(true);
  });

  it('emits an abstention without answers and still sends comments', async () => {
    await render(baseBallot());
    (el().querySelector('#vote-link-abstain') as HTMLInputElement).click();
    fixture.detectChanges();
    submit();

    expect(emitted).toEqual([{ abstain: true, userVoteContent: undefined, commentResponses: undefined }]);
  });

  it('gives every choice and the abstain toggle a full-row 44px label target', async () => {
    await render(baseBallot({ poll_questions: [{ question_id: 'q1', prompt: 'Pick', type: 'multiple_choice', choices: CHOICES }] }));

    const labels = Array.from(el().querySelectorAll('label[for^="vote-link-choice"], label[for="vote-link-abstain"]'));
    expect(labels).toHaveLength(4);
    for (const label of labels) {
      expect(label.className).toContain('min-h-[44px]');
      expect(label.className).toContain('after:absolute');
    }
  });

  it('names each question group by its prompt so a screen reader announces it with the choices', async () => {
    await render(baseBallot());

    const group = byId('vote-link-question-q1') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    const labelledBy = group.getAttribute('aria-labelledby') as string;
    expect(el().querySelector(`#${labelledBy}`)?.textContent).toContain('Who?');
  });

  it('pins Submit in a sticky footer above the safe area', async () => {
    await render(baseBallot());

    expect(byId('vote-link-footer')?.className).toContain('sticky');
    expect(byId('vote-link-footer')?.className).toContain('safe-area-inset-bottom');
    expect(byId('vote-link-submit-button')?.querySelector('button')?.className).toContain('min-h-[44px]');
  });

  describe('prefill', () => {
    it('prefills answers, comments and abstain on a regular vote that was already voted', async () => {
      await render(baseBallot(), votedState());
      submit();

      expect(emitted[0].userVoteContent).toEqual([{ question_id: 'q1', choice_ids: ['c-b'] }]);
      expect(emitted[0].commentResponses).toEqual([{ prompt_id: 'p1', comment_text: 'Earlier note' }]);
    });

    it('prefills a prior abstention', async () => {
      await render(baseBallot(), votedState({ abstained: true, poll_answers: [] }));
      submit();

      expect(emitted[0].abstain).toBe(true);
    });

    it('prefills a ranked order from choice_rank', async () => {
      const ranked = baseBallot({ poll_type: 'meek_stv', poll_comment_prompts: [] });
      await render(
        ranked,
        votedState({
          poll_answers: [
            {
              question_id: 'q1',
              prompt: 'Who?',
              type: 'single_choice',
              ranked_user_choice: [
                { choice_id: 'c-c', choice_text: 'Carol', choice_rank: 1 },
                { choice_id: 'c-a', choice_text: 'Alice', choice_rank: 2 },
                { choice_id: 'c-b', choice_text: 'Bob', choice_rank: 3 },
              ],
            },
          ],
        })
      );
      submit();

      expect(emitted[0].userVoteContent?.[0].ranked_choices?.map((c) => c.choice_id)).toEqual(['c-c', 'c-a', 'c-b']);
    });

    it.each([[], undefined])('falls back to saved user_choice ranks when ranked_user_choice is %s', async (rankedUserChoice) => {
      await render(
        baseBallot({ poll_type: 'instant_runoff_vote' }),
        votedState({
          poll_answers: [
            {
              question_id: 'q1',
              prompt: 'Who?',
              type: 'single_choice',
              ranked_user_choice: rankedUserChoice,
              user_choice: [
                { choice_id: 'c-a', choice_text: 'Alice', choice_rank: 2 },
                { choice_id: 'c-c', choice_text: 'Carol', choice_rank: 1 },
              ],
            },
          ],
        })
      );
      (fixture.componentInstance.commentForm.get('p1') as unknown as FormControl<string>).setValue('Comment correction');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.form.get('q1')?.value).toEqual(['c-c', 'c-a']);
      expect(byId('vote-link-rank-c-b')).toBeNull();
      expect(byId('vote-link-submit-button')?.querySelector('button')?.disabled).toBe(false);
      submit();
      expect(emitted[0]).toMatchObject({
        userVoteContent: [
          {
            question_id: 'q1',
            ranked_choices: [
              { choice_id: 'c-c', choice_rank: 1 },
              { choice_id: 'c-a', choice_rank: 2 },
            ],
          },
        ],
        commentResponses: [{ prompt_id: 'p1', comment_text: 'Comment correction' }],
      });
    });

    it('preserves saved user_choice order when recorded ranks are omitted', async () => {
      await render(
        baseBallot({ poll_type: 'instant_runoff_vote' }),
        votedState({
          poll_answers: [
            {
              question_id: 'q1',
              prompt: 'Who?',
              type: 'single_choice',
              ranked_user_choice: [],
              user_choice: [
                { choice_id: 'c-c', choice_text: 'Carol' },
                { choice_id: 'c-a', choice_text: 'Alice' },
              ],
            },
          ],
        })
      );
      submit();

      expect(emitted[0].userVoteContent?.[0].ranked_choices).toEqual([
        { choice_id: 'c-c', choice_rank: 1 },
        { choice_id: 'c-a', choice_rank: 2 },
      ]);
    });

    it.each(['comment only', 'reorder', 'add', 'remove', 'empty then add', 'abstain round trip'] as const)(
      'preserves a named partial ranked ballot with explicit edits only: %s',
      async (scenario) => {
        await render(
          baseBallot({
            poll_type: 'instant_runoff_vote',
            poll_questions: [{ question_id: 'q1', prompt: 'Rank options', type: 'multiple_choice', choices: CHOICES }],
          }),
          votedState({
            poll_answers: [
              {
                question_id: 'q1',
                prompt: 'Rank options',
                type: 'multiple_choice',
                ranked_user_choice: [
                  { choice_id: 'c-c', choice_text: 'Carol', choice_rank: 1 },
                  { choice_id: 'c-a', choice_text: 'Alice', choice_rank: 2 },
                ],
              },
            ],
          })
        );
        const component = fixture.componentInstance;
        let expected = ['c-c', 'c-a'];
        expect(component.form.get('q1')?.value).toEqual(expected);
        expect(byId('vote-link-rank-c-b')).toBeNull();
        expect((byId('vote-link-rank-down-c-a') as HTMLButtonElement).disabled).toBe(true);

        if (scenario === 'reorder') {
          click('vote-link-rank-up-c-a');
          expected = ['c-a', 'c-c'];
        } else if (scenario === 'add') {
          byId('vote-link-rank-add-c-b')!.querySelector('button')!.click();
          expected = ['c-c', 'c-a', 'c-b'];
        } else if (scenario === 'remove') {
          click('vote-link-rank-remove-c-c');
          expected = ['c-a'];
        } else if (scenario === 'empty then add') {
          click('vote-link-rank-remove-c-c');
          click('vote-link-rank-remove-c-a');
          expect(component.form.get('q1')?.value).toEqual([]);
          expect(byId('vote-link-rank-c-a')).toBeNull();
          expect(byId('vote-link-submit-button')!.querySelector('button')!.disabled).toBe(true);
          byId('vote-link-rank-add-c-b')!.querySelector('button')!.click();
          expected = ['c-b'];
        } else if (scenario === 'abstain round trip') {
          component.abstainControl.setValue(true);
          component['toggleRankedChoice']('q1', 'c-b');
          expect(component.form.get('q1')?.value).toEqual(expected);
          component.abstainControl.setValue(false);
        }
        (component.commentForm.get('p1') as unknown as FormControl<string>).setValue('Comment correction');
        await fixture.whenStable();
        fixture.detectChanges();
        submit();
        expect(emitted).toEqual([
          {
            abstain: false,
            userVoteContent: [{ question_id: 'q1', ranked_choices: expected.map((choiceId, index) => ({ choice_id: choiceId, choice_rank: index + 1 })) }],
            commentResponses: [{ prompt_id: 'p1', comment_text: 'Comment correction' }],
          },
        ]);
      }
    );

    it.each(['single_choice', 'multiple_choice'] as const)(
      'can explicitly replace a named ranked %s abstention without inferring ranks on comment edits',
      async (type) => {
        await render(
          baseBallot({
            poll_type: 'instant_runoff_vote',
            poll_questions: [{ question_id: 'q1', prompt: 'Rank options', type, choices: CHOICES }],
          }),
          votedState({ abstained: true, poll_answers: [] })
        );
        const component = fixture.componentInstance;
        (component.commentForm.get('p1') as unknown as FormControl<string>).setValue('Comment correction');
        fixture.detectChanges();
        submit();
        expect(component.form.get('q1')?.value).toEqual([]);
        expect(emitted[0]).toMatchObject({ abstain: true, userVoteContent: undefined });

        component.abstainControl.setValue(false);
        fixture.detectChanges();
        expect(byId('vote-link-submit-button')!.querySelector('button')!.disabled).toBe(true);
        const actionId = type === 'single_choice' ? 'vote-link-rank-all-q1' : 'vote-link-rank-add-c-b';
        byId(actionId)!.querySelector('button')!.click();
        await fixture.whenStable();
        fixture.detectChanges();
        submit();
        const expected = type === 'single_choice' ? ['c-a', 'c-b', 'c-c'] : ['c-b'];
        expect(emitted[1].userVoteContent).toEqual([
          {
            question_id: 'q1',
            ranked_choices: expected.map((choiceId, index) => ({ choice_id: choiceId, choice_rank: index + 1 })),
          },
        ]);
      }
    );

    it.each([true, undefined])('retains ranked non-prefill privacy when pseudo_anonymity is %s', async (privacy) => {
      await render(
        baseBallot({
          pseudo_anonymity: privacy,
          poll_type: 'instant_runoff_vote',
          poll_questions: [{ question_id: 'q1', prompt: 'Rank options', type: 'multiple_choice', choices: CHOICES }],
        }),
        votedState({
          abstained: true,
          poll_answers: [
            {
              question_id: 'q1',
              prompt: 'Rank options',
              type: 'multiple_choice',
              ranked_user_choice: [{ choice_id: 'c-c', choice_text: 'Carol', choice_rank: 1 }],
            },
          ],
        })
      );
      expect(fixture.componentInstance.form.get('q1')?.value).toEqual(['c-a', 'c-b', 'c-c']);
      expect(fixture.componentInstance.abstainControl.value).toBe(false);
      expect(byId('vote-link-unranked-q1')).toBeNull();
      expect(byId('vote-link-rank-remove-c-a')).toBeNull();
    });
    it('never prefills a pseudo-anonymous vote, even if a payload carries answers', async () => {
      await render(baseBallot({ pseudo_anonymity: true }), votedState({ abstained: true }));

      expect(byId('vote-link-submit-button')?.querySelector('button')?.disabled).toBe(true);
      expect((el().querySelector('#vote-link-abstain') as HTMLInputElement).checked).toBe(false);
    });

    it('treats a missing pseudo_anonymity as pseudo-anonymous (fails closed)', async () => {
      await render(baseBallot({ pseudo_anonymity: undefined }), votedState());

      expect(byId('vote-link-submit-button')?.querySelector('button')?.disabled).toBe(true);
    });

    it('sends an empty comment list when a voter clears a prefilled comment, so the update clears it', async () => {
      await render(baseBallot(), votedState());
      const textarea = el().querySelector('textarea') as HTMLTextAreaElement;
      textarea.value = '';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      submit();

      expect(emitted[0].commentResponses).toEqual([]);
    });

    it('omits comments on a pseudo-anonymous update so existing comments are kept', async () => {
      await render(baseBallot({ pseudo_anonymity: true }), votedState());
      (el().querySelector('#vote-link-choice-c-a') as HTMLInputElement).click();
      fixture.detectChanges();
      submit();

      expect(emitted[0].commentResponses).toBeUndefined();
    });
  });

  describe('phone polish (#4692)', () => {
    it('reads each question prompt at 18px or larger', async () => {
      await render(baseBallot());

      expect(byId('vote-link-question-prompt')?.className).toContain('text-[18px]');
    });

    it('renders every choice as a full-row card of at least 44px and marks the selected one', async () => {
      await render(baseBallot());
      const card = (id: string) => byId(id)!.querySelector('[data-selected]') as HTMLElement;
      expect(card('vote-link-choice-c-a').className).toContain('min-h-[44px]');
      expect(card('vote-link-choice-c-a').getAttribute('data-selected')).toBe('false');

      (el().querySelector('#vote-link-choice-c-a') as HTMLInputElement).click();
      fixture.detectChanges();

      expect(card('vote-link-choice-c-a').getAttribute('data-selected')).toBe('true');
      expect(card('vote-link-choice-c-a').className).toContain('border-blue-600');
      expect(card('vote-link-choice-c-b').getAttribute('data-selected')).toBe('false');
    });

    it('shows "Select one answer" and disables Submit until a choice is made', async () => {
      await render(baseBallot());
      expect(byId('vote-link-submit-helper')?.textContent).toContain('Select one answer');
      expect(byId('vote-link-submit-button')?.querySelector('button')?.disabled).toBe(true);

      (el().querySelector('#vote-link-choice-c-b') as HTMLInputElement).click();
      fixture.detectChanges();

      expect(byId('vote-link-submit-helper')).toBeNull();
      expect(byId('vote-link-submit-button')?.querySelector('button')?.disabled).toBe(false);
    });

    it('words the helper for the question shape: multiple choice, then several questions', async () => {
      const multi = baseBallot({ poll_questions: [{ question_id: 'q1', prompt: 'Which?', type: 'multiple_choice', choices: CHOICES }] });
      await render(multi);
      expect(byId('vote-link-submit-helper')?.textContent).toContain('Select at least one answer');

      const two = baseBallot({
        poll_questions: [
          { question_id: 'q1', prompt: 'First?', type: 'single_choice', choices: CHOICES },
          { question_id: 'q2', prompt: 'Second?', type: 'single_choice', choices: CHOICES },
        ],
      });
      await render(two);
      expect(byId('vote-link-submit-helper')?.textContent).toContain('Answer every question to submit');
    });

    it('needs no selection to abstain', async () => {
      await render(baseBallot());
      (el().querySelector('#vote-link-abstain') as HTMLInputElement).click();
      fixture.detectChanges();

      expect(byId('vote-link-submit-helper')).toBeNull();
    });

    it('pins Submit above the home-indicator safe area', async () => {
      await render(baseBallot());

      expect(byId('vote-link-footer')?.className).toContain('env(safe-area-inset-bottom)');
    });

    it('keeps comment prompts collapsed behind "Add a comment" until opened', async () => {
      await render(baseBallot());
      expect(byId('vote-link-add-comment-p1')?.textContent).toContain('Add a comment');
      expect(el().querySelector('textarea')).toBeNull();

      click('vote-link-add-comment-p1');

      expect(el().querySelector('textarea')).not.toBeNull();
      expect(byId('vote-link-add-comment-p1')).toBeNull();
    });

    it('opens a prompt that already has a prefilled comment', async () => {
      await render(baseBallot(), votedState());

      expect(byId('vote-link-add-comment-p1')).toBeNull();
      expect(el().querySelector('textarea')).not.toBeNull();
    });
  });

  describe('final notice (#4723)', () => {
    it('renders no notice by default', async () => {
      await render(baseBallot());

      expect(byId('vote-link-final-notice')).toBeNull();
    });

    it('renders the notice in the pinned footer when set', async () => {
      fixture = TestBed.createComponent(VoteBallotFormComponent);
      fixture.componentRef.setInput('ballot', baseBallot());
      fixture.componentRef.setInput('finalNotice', "Once you submit, your vote can't be changed.");
      fixture.detectChanges();
      await fixture.whenStable();

      const notice = byId('vote-link-footer')?.querySelector('[data-testid="vote-link-final-notice"]');
      expect(notice?.textContent?.trim()).toBe("Once you submit, your vote can't be changed.");
      expect(notice?.getAttribute('role')).toBe('note');
    });
  });
});
