// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { UserService } from '@services/user.service';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { MyVoteBallot, Vote } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoteCastDrawerComponent } from './vote-cast-drawer.component';

/**
 * Shared drawer-mounting harness. p-drawer renders into document.body, not the fixture host —
 * queries run against `document` and the body is wiped between tests (mirrors
 * group-seat-holders-drawer.component.spec.ts).
 */
let fixture: ComponentFixture<VoteCastDrawerComponent>;
let getVote: ReturnType<typeof vi.fn>;
const impersonating = signal(false);

const VOTE: Vote = {
  uid: 'vote-1',
  name: 'Steering Committee Ratification',
  status: PollStatus.ACTIVE,
  project_uid: 'project-1',
  end_time: '2099-06-01T18:00:00Z',
  allow_abstain: false,
  poll_questions: [
    {
      question_id: 'q1',
      prompt: 'Approve the amended charter?',
      type: 'single_choice',
      choices: [
        { choice_id: 'c1', choice_text: 'Approve' },
        { choice_id: 'c2', choice_text: 'Reject' },
      ],
    },
  ],
} as Vote;

afterEach(() => {
  fixture?.destroy();
  document.body.innerHTML = '';
});

async function setup(getVoteImpl: ReturnType<typeof vi.fn>, voteServiceOverrides: Record<string, unknown> = {}): Promise<void> {
  getVote = getVoteImpl;
  impersonating.set(false);

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [VoteCastDrawerComponent],
    providers: [
      provideNoopAnimations(),
      provideRouter([]),
      { provide: VoteService, useValue: { getVote, ...voteServiceOverrides } },
      { provide: MessageService, useValue: { add: vi.fn() } },
      { provide: UserService, useValue: { impersonating } },
    ],
  }).compileComponents();

  fixture = TestBed.createComponent(VoteCastDrawerComponent);
}

/** Opens the drawer the way dashboard-cast-drawer-host does: a voteId and no listVote. */
async function openWithoutListVote(): Promise<void> {
  fixture.componentRef.setInput('voteId', VOTE.uid);
  fixture.componentRef.setInput('listVote', null);
  fixture.componentRef.setInput('visible', true);
  await fixture.whenStable();
  fixture.detectChanges();
}

function el(testid: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testid}"]`);
}

/**
 * Covers the GH-2350 null-`listVote` states that e2e/vote-cast-drawer.spec.ts cannot reach: the
 * vote page always passes the full vote as listVote (so `startWith(listVote)` renders the header
 * even on the pre-fix template), and the dashboard-cast-drawer-host gates on a pending-actions
 * prefetch that shares the 10s voteDetailCache — a failed prefetch shows a toast and never opens
 * the drawer. Mounting the component directly with listVote=null is the only harness that
 * exercises the states the header hoisting actually fixed; every test below fails against the
 * pre-fix template, where the header lived inside `@if (vote())`.
 */
describe('VoteCastDrawerComponent — always-visible header (GH-2350)', () => {
  it('renders the header and close button while the detail load is pending, then swaps in the ballot', async () => {
    const pending = new Subject<Vote>();
    await setup(vi.fn().mockReturnValue(pending.asObservable()));

    await openWithoutListVote();

    // The reported bug: with listVote null, the pre-fix template rendered no header at all while
    // the request was in flight — the drawer had no title and could not be closed.
    expect(getVote).toHaveBeenCalledWith(VOTE.uid, { skipCache: false });
    expect(el('vote-cast-drawer-header')).toBeTruthy();
    expect(el('vote-cast-drawer-close')).toBeTruthy();
    // A skeleton occupies the title slot until the detail lands; neither content nor error shows.
    expect(el('vote-cast-drawer-title')).toBeNull();
    expect(el('vote-cast-drawer-content')).toBeNull();
    expect(el('vote-cast-drawer-error')).toBeNull();

    pending.next(VOTE);
    pending.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el('vote-cast-drawer-title')?.textContent?.trim()).toBe(VOTE.name);
    expect(el('vote-cast-question-q1')).toBeTruthy();
    expect(el('vote-cast-drawer-header')).toBeTruthy();
  });

  it('closes from the header close button while the detail load is still pending', async () => {
    const pending = new Subject<Vote>();
    await setup(vi.fn().mockReturnValue(pending.asObservable()));

    await openWithoutListVote();

    const close = el('vote-cast-drawer-close') as HTMLButtonElement | null;
    expect(close).toBeTruthy();
    close!.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.visible()).toBe(false);

    // The in-flight request settling against the closed drawer must not reopen or crash it.
    pending.next(VOTE);
    pending.complete();
    await fixture.whenStable();

    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('shows the fallback title and keeps the close button when the detail load fails', async () => {
    await setup(vi.fn().mockReturnValue(throwError(() => new Error('500'))));

    await openWithoutListVote();

    // catchError falls back to listVote (null here): the header must survive the failure with the
    // fallback title — the pre-fix template rendered only a bare vote-cast-drawer-close-error
    // button in this state, with no header, title, or vote-cast-drawer-close.
    expect(el('vote-cast-drawer-header')).toBeTruthy();
    expect(el('vote-cast-drawer-title')?.textContent?.trim()).toBe('Vote Details');
    expect(el('vote-cast-drawer-close')).toBeTruthy();
    expect(el('vote-cast-drawer-error')).toBeTruthy();
  });
});

/**
 * GH-3823 review (PRRT_kwDOPMiRQ86uw_wC @greptile-apps "Ballot keeps the old deadline",
 * PRRT_kwDOPMiRQ86uxHEw @copilot-pull-request-reviewer): initVote()'s fallback preferred the last
 * fetched full detail over listVote wholesale (to avoid wiping an in-progress ballot — see the
 * initVote() doc comment), but that meant a just-extended deadline on listVote was discarded in
 * favor of the cached detail's pre-extension end_time whenever the refetch that should have
 * picked up the extension then failed. Pins the fix: the fallback keeps the cached detail's
 * questions/answers but overlays listVote's end_time/end_time_timezone onto it.
 */
describe('VoteCastDrawerComponent — deadline fallback (GH-3823 review)', () => {
  it('shows the newer listVote deadline, not the stale cached detail, when a deadline-change refetch fails', async () => {
    const detail = { ...VOTE, end_time: '2026-01-01T00:00:00Z' };
    const extendedList = { ...VOTE, end_time: '2026-02-01T00:00:00Z' };

    const getVoteFn = vi
      .fn()
      .mockReturnValueOnce(of(detail))
      .mockReturnValueOnce(throwError(() => new Error('500')));
    await setup(getVoteFn);

    fixture.componentRef.setInput('voteId', VOTE.uid);
    fixture.componentRef.setInput('listVote', detail);
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['vote']()?.end_time).toBe(detail.end_time);

    // Deadline extended while the drawer stays open; the deadline-change refetch (skipCache) fails.
    fixture.componentRef.setInput('listVote', extendedList);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getVoteFn).toHaveBeenCalledTimes(2);
    expect(getVoteFn).toHaveBeenLastCalledWith(VOTE.uid, { skipCache: true });
    // Regression: shows the NEW deadline from listVote, not the stale cached detail's end_time,
    // while still keeping the full ballot detail (poll_questions) from the cached fetch.
    expect(fixture.componentInstance['vote']()?.end_time).toBe(extendedList.end_time);
    expect(fixture.componentInstance['vote']()?.poll_questions).toEqual(detail.poll_questions);
  });
});

/**
 * GH-2326 description rendering: descriptions are poll-creator-authored rich HTML (PCC editor)
 * rendered through Angular's [innerHTML] sanitizer, while legacy plain-text descriptions rely on
 * whitespace-pre-line to keep their line breaks. Both tests fail against the pre-fix template —
 * interpolation showed the markup as literal text, and the element carried no whitespace-pre-line.
 */
describe('VoteCastDrawerComponent — description rendering (GH-2326)', () => {
  it('renders a rich-HTML description as elements, not literal tags', async () => {
    const detail = new Subject<Vote>();
    await setup(vi.fn().mockReturnValue(detail.asObservable()));

    await openWithoutListVote();

    detail.next({ ...VOTE, description: '<p>First</p><p>Second</p>' });
    detail.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    const description = el('vote-cast-drawer-description');
    expect(description).toBeTruthy();
    expect(description!.querySelectorAll('p')).toHaveLength(2);
    expect(description!.textContent).toContain('First');
    expect(description!.textContent).toContain('Second');
    // The GH-2326 bug shape: interpolation renders the markup as visible text.
    expect(description!.textContent).not.toContain('<p>');
  });

  it('preserves a newline-only plain-text description via whitespace-pre-line', async () => {
    const detail = new Subject<Vote>();
    await setup(vi.fn().mockReturnValue(detail.asObservable()));

    await openWithoutListVote();

    detail.next({ ...VOTE, description: 'Line one\nLine two' });
    detail.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    const description = el('vote-cast-drawer-description');
    expect(description).toBeTruthy();
    // whitespace-pre-line is what preserves the legacy plain-text line breaks.
    expect(description!.classList.contains('whitespace-pre-line')).toBe(true);
    expect(description!.textContent).toBe('Line one\nLine two');
    // Plain text must not parse into child elements.
    expect(description!.children).toHaveLength(0);
  });

  it('neutralizes attack payloads via the Angular sanitizer', async () => {
    const detail = new Subject<Vote>();
    await setup(vi.fn().mockReturnValue(detail.asObservable()));

    await openWithoutListVote();

    detail.next({
      ...VOTE,
      description: '<p>ok</p><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">link</a>',
    });
    detail.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    // Pins the PR's security claim: script elements, inline event handlers, and javascript:
    // URLs must be stripped by Angular's default sanitizer — a regression (e.g. a future
    // bypassSecurityTrustHtml or custom pipe) must fail here.
    const description = el('vote-cast-drawer-description');
    expect(description).toBeTruthy();
    expect(description!.querySelector('script')).toBeNull();
    expect(description!.querySelector('[onerror]')).toBeNull();
    expect(description!.querySelector('a')?.getAttribute('href')).not.toMatch(/^javascript:/);
    // Benign content survives sanitization.
    expect(description!.querySelector('p')?.textContent).toBe('ok');
    expect(description!.textContent).toContain('link');
  });
});

/**
 * #4075: upstream ITX emits poll_type='majority' for single-choice board votes. PollType had no
 * MAJORITY member, so `!== PollType.GENERIC` treated it as ranked-choice and rendered the
 * drag-to-reorder ballot instead of single-choice radios. isRankedPollType is an allowlist of the
 * actual ranked methods, so majority (and a missing poll_type) fall through to the single/multiple
 * choice branches here.
 */
describe('VoteCastDrawerComponent — majority poll_type renders single-choice (#4075)', () => {
  it('renders radio buttons, not the drag-to-reorder ranked list, for a majority single_choice question', async () => {
    await setup(vi.fn().mockReturnValue(of({ ...VOTE, poll_type: PollType.MAJORITY })));

    await openWithoutListVote();

    expect(el('vote-cast-choice-c1')).toBeTruthy();
    expect(el('vote-cast-rank-c1')).toBeNull();
  });

  it('renders radio buttons when poll_type is omitted (legacy/omitted field)', async () => {
    // VOTE carries no poll_type field at all — the omitted-field case, distinct from the MAJORITY case above.
    await setup(vi.fn().mockReturnValue(of(VOTE)));

    await openWithoutListVote();

    expect(el('vote-cast-choice-c1')).toBeTruthy();
    expect(el('vote-cast-rank-c1')).toBeNull();
  });

  it('submits choice_ids, not ranked_choices, for a majority vote', async () => {
    const submitMyResponse = vi.fn().mockReturnValue(of(undefined));
    const majorityVote = { ...VOTE, poll_type: PollType.MAJORITY };
    await setup(vi.fn().mockReturnValue(of(majorityVote)), { submitMyResponse });

    await openWithoutListVote();

    (fixture.componentInstance.form.get('q1') as unknown as FormControl<string | null>).setValue('c1');
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance['onSubmit']();
    await fixture.whenStable();

    expect(submitMyResponse).toHaveBeenCalledWith(
      majorityVote.uid,
      expect.objectContaining({
        userVoteContent: [expect.objectContaining({ question_id: 'q1', choice_ids: ['c1'] })],
      })
    );
    const [, payload] = submitMyResponse.mock.calls[0] as [string, { userVoteContent: Record<string, unknown>[] }];
    expect(payload.userVoteContent[0]['ranked_choices']).toBeUndefined();
  });
});

/**
 * PR #4076 review (dealako, copilot-pull-request-reviewer): the first-open fallback strips poll_type
 * from an unconfirmed listVote so an unconfirmed majority claim can't flip the ballot to ranked (see
 * the block above) — but stripping it unconditionally also meant a failed first detail fetch for a
 * genuinely ranked vote fell back to that same stripped value, silently downgrading it to a
 * submittable single-choice ballot. Pins the fix: the terminal-failure fallback (no cached detail to
 * fall back to) restores the list row's own poll_type instead of the stripped transient one.
 */
describe('VoteCastDrawerComponent — ranked listVote survives a failed first-open detail fetch (#4076 review)', () => {
  it('keeps a ranked listVote classified as ranked when the first detail fetch fails outright', async () => {
    const rankedListVote: Vote = { ...VOTE, poll_type: PollType.INSTANT_RUNOFF_VOTE };
    await setup(vi.fn().mockReturnValue(throwError(() => new Error('500'))));

    fixture.componentRef.setInput('voteId', rankedListVote.uid);
    fixture.componentRef.setInput('listVote', rankedListVote);
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['isRankedPoll']()).toBe(true);
    expect(el('vote-cast-rank-c1')).toBeTruthy();
    expect(el('vote-cast-choice-c1')).toBeNull();
  });
});

describe('VoteCastDrawerComponent — read-only ballot review (#4331)', () => {
  const REVIEW_VOTE: Vote = {
    ...VOTE,
    allow_abstain: true,
    poll_questions: [
      VOTE.poll_questions![0],
      {
        question_id: 'q2',
        prompt: 'Which committees should review it?',
        type: 'multiple_choice',
        choices: [
          { choice_id: 'm1', choice_text: 'Legal' },
          { choice_id: 'm2', choice_text: 'Finance' },
          { choice_id: 'm3', choice_text: 'Security' },
        ],
      },
    ],
    poll_comment_prompts: [{ prompt_id: 'p1', prompt: 'Anything else?' }],
  } as Vote;
  const BALLOT: MyVoteBallot = {
    vote_response_uid: 'vr-1',
    vote_uid: VOTE.uid,
    abstained: false,
    poll_answers: [
      { question_id: 'q1', prompt: '', type: 'single_choice', user_choice: [{ choice_id: 'c2', choice_text: 'Reject' }], ranked_user_choice: [] },
      {
        question_id: 'q2',
        prompt: '',
        type: 'multiple_choice',
        user_choice: [
          { choice_id: 'm1', choice_text: 'Legal' },
          { choice_id: 'm3', choice_text: 'Security' },
        ],
        ranked_user_choice: [],
      },
    ],
    comment_responses: [{ prompt_id: 'p1', comment_text: 'Needs a second reading' }],
    vote_creation_time: '2026-10-20T10:00:00Z',
  };

  const RANKED_VOTE: Vote = {
    ...VOTE,
    allow_abstain: true,
    poll_type: PollType.INSTANT_RUNOFF_VOTE,
    poll_questions: [
      {
        question_id: 'q1',
        prompt: 'Rank the candidates',
        type: 'multiple_choice',
        choices: [
          { choice_id: 'r1', choice_text: 'Avery' },
          { choice_id: 'r2', choice_text: 'Blake' },
          { choice_id: 'r3', choice_text: 'Casey' },
        ],
      },
    ],
    poll_comment_prompts: [{ prompt_id: 'p1', prompt: 'Anything else?' }],
  };
  const RANKED_BALLOT: MyVoteBallot = {
    ...BALLOT,
    poll_answers: [
      {
        question_id: 'q1',
        prompt: 'Rank the candidates',
        type: 'multiple_choice',
        user_choice: [],
        ranked_user_choice: [
          { choice_id: 'r3', choice_text: 'Casey', choice_rank: 1 },
          { choice_id: 'r1', choice_text: 'Avery', choice_rank: 2 },
        ],
      },
    ],
  };

  async function openReview(vote: Vote, getMyVoteBallot: ReturnType<typeof vi.fn>, overrides: Record<string, unknown> = {}): Promise<void> {
    await setup(vi.fn().mockReturnValue(of(vote)), { getMyVoteBallot, ...overrides });
    fixture.componentRef.setInput('readOnly', true);
    await openWithoutListVote();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function submitButton(): HTMLButtonElement | null {
    return el('vote-cast-submit-button')?.querySelector('button') ?? null;
  }

  it.each([true, undefined, null])('hides private Review content during impersonation (privacy %s)', async (privacy) => {
    const getMyVoteBallot = vi.fn().mockReturnValue(of(BALLOT));
    const submitMyResponse = vi.fn();
    await setup(vi.fn().mockReturnValue(of({ ...REVIEW_VOTE, pseudo_anonymity: privacy })), { getMyVoteBallot, submitMyResponse });
    impersonating.set(true);
    fixture.componentRef.setInput('readOnly', true);
    await openWithoutListVote();
    expect(el('vote-cast-impersonation-notice')?.textContent).toContain('This ballot is private');
    expect(getMyVoteBallot).not.toHaveBeenCalled();
    expect(el('vote-cast-question-q1')).toBeNull();
    expect(fixture.componentInstance['drawerPt']()).toEqual({ footer: { class: 'hidden' } });
    expect(submitButton()).toBeNull();
    fixture.componentInstance['onSubmit']();
    expect(submitMyResponse).not.toHaveBeenCalled();
  });

  it('allows locked named Review during impersonation', async () => {
    const getMyVoteBallot = vi.fn().mockReturnValue(of(BALLOT));
    await setup(vi.fn().mockReturnValue(of({ ...REVIEW_VOTE, pseudo_anonymity: false })), { getMyVoteBallot });
    impersonating.set(true);
    fixture.componentRef.setInput('readOnly', true);
    await openWithoutListVote();
    expect(getMyVoteBallot).toHaveBeenCalledWith(VOTE.uid);
    expect(fixture.componentInstance.form.get('q1')?.value).toBe('c2');
    expect(fixture.componentInstance.form.disabled).toBe(true);
    expect(el('vote-cast-impersonation-notice')?.textContent).toContain('Ballots are read-only');
    expect(submitButton()).toBeNull();
  });

  it.each([false, true, undefined, null])('explains why a first ballot cannot be cast during impersonation (privacy %s)', async (privacy) => {
    const submitMyResponse = vi.fn();
    await setup(vi.fn().mockReturnValue(of({ ...REVIEW_VOTE, pseudo_anonymity: privacy })), { submitMyResponse });
    impersonating.set(true);
    await openWithoutListVote();
    expect(el('vote-cast-impersonation-notice')?.textContent).toContain('You cannot cast or change their vote.');
    expect(el('vote-cast-impersonation-notice')?.textContent).not.toContain('This ballot is private');
    expect(el('vote-cast-question-q1')).toBeNull();
    expect(fixture.componentInstance['drawerPt']()).toEqual({ footer: { class: 'hidden' } });
    expect(submitButton()).toBeNull();
    fixture.componentInstance['onSubmit']();
    expect(submitMyResponse).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'omitted', prompts: undefined },
    { label: 'empty', prompts: [] },
  ])('preserves late saved comments in locked Review when prompts are $label', async ({ prompts }) => {
    const pending = new Subject<MyVoteBallot | null>();
    await openReview({ ...REVIEW_VOTE, poll_comment_prompts: prompts }, vi.fn().mockReturnValue(pending));
    expect(el('vote-cast-comments')).toBeNull();

    pending.next(BALLOT);
    pending.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    const comment = el('vote-cast-comment-p1');
    expect(comment?.textContent).toContain('Comment');
    const textarea = comment?.querySelector('textarea');
    expect(textarea?.value).toBe('Needs a second reading');
    expect(textarea?.disabled).toBe(true);
    expect(fixture.componentInstance.commentForm.disabled).toBe(true);
    expect(submitButton()).toBeNull();
  });

  it('preserves known comment labels and saved-only prompts in Review without changing the vote', async () => {
    await openReview(
      REVIEW_VOTE,
      vi.fn().mockReturnValue(
        of({
          ...BALLOT,
          comment_responses: [
            ...BALLOT.comment_responses,
            { prompt_id: 'saved-only', comment_text: 'Recorded on an older prompt' },
            { prompt_id: 'blank-only', comment_text: '  ' },
          ],
        })
      )
    );

    expect(el('vote-cast-comment-p1')?.textContent).toContain('Anything else?');
    expect(el('vote-cast-comment-saved-only')?.querySelector('textarea')?.value).toBe('Recorded on an older prompt');
    expect(el('vote-cast-comment-saved-only')?.querySelector('textarea')?.disabled).toBe(true);
    expect(el('vote-cast-comment-blank-only')).toBeNull();
    expect(REVIEW_VOTE.poll_comment_prompts).toEqual([{ prompt_id: 'p1', prompt: 'Anything else?' }]);
  });

  it('shows recorded single/multiple choices and comments in disabled voting controls', async () => {
    const getMyVoteBallot = vi.fn().mockReturnValue(of(BALLOT));
    await openReview(REVIEW_VOTE, getMyVoteBallot);
    const component = fixture.componentInstance;

    expect(getMyVoteBallot).toHaveBeenCalledWith(VOTE.uid);
    expect(component.form.get('q1')?.value).toBe('c2');
    expect(component.form.get('q2')?.value).toEqual(['m1', 'm3']);
    expect(component.commentForm.get('p1')?.value).toBe('Needs a second reading');
    expect(component.form.disabled).toBe(true);
    expect(component.commentForm.disabled).toBe(true);
    expect(component.abstainControl.disabled).toBe(true);
    expect(el('vote-cast-review-notice')?.textContent?.trim()).toBe('Your vote has been recorded.');
    expect(submitButton()).toBeNull();
    expect(el('vote-cast-cancel-button')?.textContent?.trim()).toBe('Close');
    expect(el('vote-cast-footer')?.contains(el('vote-cast-cancel-button'))).toBe(true);

    const recordedRadio = document.getElementById('vote-cast-choice-c2') as HTMLInputElement;
    expect(recordedRadio.checked).toBe(true);
    expect(recordedRadio.disabled).toBe(true);
    const checkbox = document.getElementById('vote-cast-choice-m1') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Needs a second reading');
    expect(textarea.disabled).toBe(true);

    (document.getElementById('vote-cast-choice-c1') as HTMLInputElement).click();
    checkbox.click();
    (document.getElementById('vote-cast-abstain') as HTMLInputElement).click();
    await fixture.whenStable();
    expect(component.form.get('q1')?.value).toBe('c2');
    expect(component.form.get('q2')?.value).toEqual(['m1', 'm3']);
    expect(component.abstainControl.value).toBe(false);
  });

  it('renders recorded-only single and multiple choices as selected, disabled controls', async () => {
    const vote: Vote = {
      ...REVIEW_VOTE,
      poll_questions: REVIEW_VOTE.poll_questions!.map((question) => ({
        ...question,
        choices: question.choices.filter((choice) => !['c2', 'm1', 'm3'].includes(choice.choice_id)),
      })),
    };
    await openReview(vote, vi.fn().mockReturnValue(of(BALLOT)));
    const component = fixture.componentInstance;

    expect(component.form.get('q1')?.value).toBe('c2');
    expect(component.form.get('q2')?.value).toEqual(['m1', 'm3']);
    for (const [id, text] of [
      ['c2', 'Reject'],
      ['m1', 'Legal'],
      ['m3', 'Security'],
    ]) {
      const control = document.getElementById(`vote-cast-choice-${id}`) as HTMLInputElement;
      expect(control.checked).toBe(true);
      expect(control.disabled).toBe(true);
      expect(el(`vote-cast-question-${id === 'c2' ? 'q1' : 'q2'}`)?.textContent).toContain(text);
    }
    expect(submitButton()).toBeNull();
  });

  it('renders recorded-only ranked choices with their saved text and order', async () => {
    const vote: Vote = {
      ...RANKED_VOTE,
      poll_questions: RANKED_VOTE.poll_questions!.map((question) => ({
        ...question,
        choices: question.choices.filter((choice) => choice.choice_id !== 'r3'),
      })),
    };
    await openReview(vote, vi.fn().mockReturnValue(of(RANKED_BALLOT)));

    expect(fixture.componentInstance.form.get('q1')?.value).toEqual(['r3', 'r1']);
    expect(el('vote-cast-rank-r3')?.textContent).toContain('Casey');
    const ranked = Array.from(document.querySelectorAll('.cdk-drag') as NodeListOf<HTMLElement>);
    expect(ranked.map((row) => row.getAttribute('data-testid'))).toEqual(['vote-cast-rank-r3', 'vote-cast-rank-r1']);
    expect((el('vote-cast-rank-up-r3') as HTMLButtonElement).disabled).toBe(true);
    expect(el('vote-cast-unranked-r2')?.textContent).toContain('Blake');
    expect(submitButton()).toBeNull();
  });

  it('shows only recorded ranks, keeps other choices unranked, and blocks reordering', async () => {
    await openReview(RANKED_VOTE, vi.fn().mockReturnValue(of(RANKED_BALLOT)));
    const component = fixture.componentInstance;

    expect(component.form.get('q1')?.value).toEqual(['r3', 'r1']);
    expect(el('vote-cast-rank-r2')).toBeNull();
    expect(el('vote-cast-unranked-r2')?.textContent).toContain('Blake');
    expect(el('vote-cast-add-rank-r2')).toBeNull();
    expect(el('vote-cast-unrank-r1')).toBeNull();
    expect(el('vote-cast-rank-r3')?.classList.contains('cdk-drag-disabled')).toBe(true);
    expect((el('vote-cast-rank-up-r1') as HTMLButtonElement).disabled).toBe(true);
    expect((el('vote-cast-rank-down-r3') as HTMLButtonElement).disabled).toBe(true);

    component['moveRank']('q1', 1, 0);
    component['onRankedDrop']('q1', { previousIndex: 0, currentIndex: 1 } as CdkDragDrop<string[]>);
    expect(component.form.get('q1')?.value).toEqual(['r3', 'r1']);
  });

  it('cannot submit a review even when the submit handler is invoked directly', async () => {
    const submitMyResponse = vi.fn().mockReturnValue(of(undefined));
    await openReview(REVIEW_VOTE, vi.fn().mockReturnValue(of(BALLOT)), { submitMyResponse });
    const component = fixture.componentInstance;
    const emitted = vi.spyOn(component.voteSubmitted, 'emit');

    component['onSubmit']();
    expect(submitMyResponse).not.toHaveBeenCalled();
    expect(emitted).not.toHaveBeenCalled();
    expect(TestBed.inject(MessageService).add).not.toHaveBeenCalled();
    expect(component['submitDisabled']()).toBe(true);
  });

  it.each([REVIEW_VOTE, RANKED_VOTE])('shows a locked abstention without inventing answer choices', async (vote) => {
    await openReview(vote, vi.fn().mockReturnValue(of({ ...BALLOT, abstained: true, poll_answers: [] })));
    const component = fixture.componentInstance;

    expect(component.abstainControl.value).toBe(true);
    expect(component.abstainControl.disabled).toBe(true);
    expect((document.getElementById('vote-cast-abstain') as HTMLInputElement).checked).toBe(true);
    expect(component.form.get('q1')?.value).toEqual(vote.poll_type === PollType.INSTANT_RUNOFF_VOTE ? [] : null);
    expect(submitButton()).toBeNull();
  });

  it('shows the recorded abstention, not "no questions", when the vote metadata has no questions', async () => {
    await openReview({ ...REVIEW_VOTE, poll_questions: undefined }, vi.fn().mockReturnValue(of({ ...BALLOT, abstained: true, poll_answers: [] })));

    expect(el('vote-cast-drawer-no-questions')).toBeNull();
    expect((document.getElementById('vote-cast-abstain') as HTMLInputElement).checked).toBe(true);
    expect(fixture.componentInstance.abstainControl.disabled).toBe(true);
  });

  it('shows the ballot loading state, not "no questions", while a review without question metadata loads', async () => {
    const pending = new Subject<MyVoteBallot | null>();
    await openReview({ ...REVIEW_VOTE, poll_questions: undefined }, vi.fn().mockReturnValue(pending.asObservable()));

    expect(el('vote-cast-drawer-no-questions')).toBeNull();
    expect(el('vote-cast-ballot-loading')).not.toBeNull();
  });

  it('still shows a recorded abstention if abstaining is no longer offered', async () => {
    await openReview({ ...REVIEW_VOTE, allow_abstain: false }, vi.fn().mockReturnValue(of({ ...BALLOT, abstained: true, poll_answers: [] })));
    expect((document.getElementById('vote-cast-abstain') as HTMLInputElement).checked).toBe(true);
    expect(fixture.componentInstance.abstainControl.disabled).toBe(true);
  });

  it('reloads a ballot on reopen without retaining the previous recorded choices', async () => {
    const getMyVoteBallot = vi
      .fn()
      .mockReturnValueOnce(of(BALLOT))
      .mockReturnValue(of({ ...BALLOT, abstained: true, poll_answers: [] }));
    await openReview(REVIEW_VOTE, getMyVoteBallot);
    const component = fixture.componentInstance;
    component.visible.set(false);
    await fixture.whenStable();
    component.visible.set(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getMyVoteBallot).toHaveBeenCalledTimes(2);
    expect(component.abstainControl.value).toBe(true);
    expect(component.form.get('q1')?.value).toBeNull();
    expect(component.form.get('q2')?.value).toEqual([]);
    expect(component.form.disabled).toBe(true);
  });

  it('shows loading without a blank ballot and retains a usable Close action', async () => {
    const pending = new Subject<MyVoteBallot | null>();
    await openReview(REVIEW_VOTE, vi.fn().mockReturnValue(pending.asObservable()));

    expect(el('vote-cast-ballot-loading')).not.toBeNull();
    expect(el('vote-cast-question-q1')).toBeNull();
    expect(submitButton()).toBeNull();
    expect(fixture.componentInstance.abstainControl.disabled).toBe(true);
    expect(fixture.componentInstance['drawerPt']()).toEqual({ footer: { class: 'border-t border-slate-200' } });
    el('vote-cast-cancel-button')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it.each([
    ['fails', () => throwError(() => new Error('500'))],
    ['finds no ballot', () => of(null)],
    ['returns a different vote', () => of({ ...BALLOT, vote_uid: 'other-vote' })],
  ])('shows a read-only error when the ballot load %s', async (_label, load) => {
    await openReview(REVIEW_VOTE, vi.fn().mockImplementation(load));

    expect(el('vote-cast-ballot-error')?.textContent).toContain("Couldn't load your submitted ballot.");
    expect(el('vote-cast-review-notice')).toBeNull();
    expect(el('vote-cast-question-q1')).toBeNull();
    expect(submitButton()).toBeNull();
  });

  it('does not show a previous ballot while loading a different vote', async () => {
    const pending = new Subject<MyVoteBallot | null>();
    const getMyVoteBallot = vi.fn().mockReturnValueOnce(of(BALLOT)).mockReturnValue(pending.asObservable());
    await openReview(REVIEW_VOTE, getMyVoteBallot);
    getVote.mockReturnValue(of({ ...REVIEW_VOTE, uid: 'other-vote' }));
    fixture.componentRef.setInput('voteId', 'other-vote');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el('vote-cast-ballot-loading')).not.toBeNull();
    expect(el('vote-cast-question-q1')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('restores empty editable controls when a reused drawer switches to a first ballot', async () => {
    const submitMyResponse = vi.fn().mockReturnValue(of(undefined));
    await openReview(REVIEW_VOTE, vi.fn().mockReturnValue(of(BALLOT)), { submitMyResponse });
    const component = fixture.componentInstance;
    component.visible.set(false);
    await fixture.whenStable();
    fixture.componentRef.setInput('readOnly', false);
    fixture.componentRef.setInput('voteId', 'new-vote');
    getVote.mockReturnValue(of({ ...REVIEW_VOTE, uid: 'new-vote' }));
    component.visible.set(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.form.enabled).toBe(true);
    expect(component.commentForm.enabled).toBe(true);
    expect(component.abstainControl.enabled).toBe(true);
    expect(component.form.get('q1')?.value).toBeNull();
    expect(component.form.get('q2')?.value).toEqual([]);
    expect(component.commentForm.get('p1')?.value).toBe('');
    expect(submitButton()?.textContent?.trim()).toBe('Submit Vote');
    component.form.patchValue({ q1: 'c1', q2: ['m2'] });
    component['onSubmit']();
    expect(submitMyResponse).toHaveBeenCalledWith('new-vote', expect.objectContaining({ abstain: false }));
  });

  it('keeps the first-ballot ranked form editable and seeded in full declared order', async () => {
    const getMyVoteBallot = vi.fn();
    await setup(vi.fn().mockReturnValue(of(RANKED_VOTE)), { getMyVoteBallot });
    await openWithoutListVote();
    const component = fixture.componentInstance;

    expect(getMyVoteBallot).not.toHaveBeenCalled();
    expect(component.form.get('q1')?.value).toEqual(['r1', 'r2', 'r3']);
    expect(component.form.enabled).toBe(true);
    expect(el('vote-cast-review-notice')).toBeNull();
    expect(submitButton()?.textContent?.trim()).toBe('Submit Vote');
    component['moveRank']('q1', 0, 1);
    expect(component.form.get('q1')?.value).toEqual(['r2', 'r1', 'r3']);
  });
});

/**
 * #4148: mobile voting. jsdom has no layout engine, so these pin the class contract the responsive
 * layout relies on (full-height sheet below sm, pinned footer, 44px targets) plus the behaviour that
 * must be identical between the touch (arrow buttons) and pointer (drag) reorder paths.
 */
describe('VoteCastDrawerComponent — mobile layout (#4148)', () => {
  const RANKED: Vote = {
    ...VOTE,
    poll_type: PollType.INSTANT_RUNOFF_VOTE,
    poll_questions: [
      {
        question_id: 'q1',
        prompt: 'Rank the candidates',
        type: 'single_choice',
        choices: [
          { choice_id: 'c1', choice_text: 'Alpha' },
          { choice_id: 'c2', choice_text: 'Bravo' },
          { choice_id: 'c3', choice_text: 'Charlie' },
        ],
      },
    ],
  } as Vote;

  it('renders Submit in the pinned footer, outside the scrolling ballot content', async () => {
    await setup(vi.fn().mockReturnValue(of(VOTE)));

    await openWithoutListVote();

    const footer = el('vote-cast-footer');
    expect(footer).toBeTruthy();
    expect(footer?.contains(el('vote-cast-submit-button'))).toBe(true);
    expect(el('vote-cast-drawer-content')?.contains(el('vote-cast-submit-button'))).toBe(false);
    expect(footer?.className).toContain('pb-[env(safe-area-inset-bottom)]');
    // Focus order follows the DOM, so Submit must come first there; sm+ reverses the row to keep Cancel on the left.
    expect(footer?.className).toContain('flex-col');
    expect(footer?.className).not.toContain('flex-col-reverse');
    expect(footer?.className).toContain('sm:flex-row-reverse');
    expect(el('vote-cast-submit-button')!.compareDocumentPosition(el('vote-cast-cancel-button')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // [fluid] makes PrimeNG add p-button-fluid so the button, not just the host, fills the phone footer.
    for (const id of ['vote-cast-submit-button', 'vote-cast-cancel-button']) {
      expect(el(id)?.querySelector('button')?.className).toContain('p-button-fluid');
    }
  });

  it('uses a full-height sheet class below sm while keeping the existing width chain', async () => {
    await setup(vi.fn().mockReturnValue(of(VOTE)));

    await openWithoutListVote();

    const root = document.querySelector('.vote-cast-drawer') as HTMLElement;
    expect(root.className).toContain('max-sm:h-dvh');
    expect(root.className).toContain('w-full');
    expect(root.className).toContain('xl:w-[45%]');
    expect(root.className).toContain('sm:w-[90%]');
  });

  it('hides the footer while the ballot is loading', async () => {
    await setup(vi.fn().mockReturnValue(new Subject<Vote>().asObservable()));

    await openWithoutListVote();

    expect(fixture.componentInstance['drawerPt']()).toEqual({ footer: { class: 'hidden' } });
  });

  it('gives choice rows and the close button 44px touch targets', async () => {
    await setup(vi.fn().mockReturnValue(of({ ...VOTE, allow_abstain: true })));

    await openWithoutListVote();

    expect(el('vote-cast-drawer-close')?.className).toContain('min-h-[44px]');
    expect(el('vote-cast-drawer-close')?.className).toContain('min-w-[44px]');
    expect(el('vote-cast-choice-c1')?.querySelector('[class*="min-h-[44px]"]')).toBeTruthy();
    expect(el('vote-cast-abstain-toggle')?.className).toContain('min-h-[44px]');
  });

  it('gives ranked up/down buttons 44px touch targets and keeps choice text wrapping', async () => {
    await setup(vi.fn().mockReturnValue(of(RANKED)));

    await openWithoutListVote();

    for (const id of ['vote-cast-rank-up-c2', 'vote-cast-rank-down-c2']) {
      expect(el(id)?.className).toContain('min-h-[44px]');
      expect(el(id)?.className).toContain('min-w-[44px]');
    }
    expect(el('vote-cast-rank-c1')?.querySelector('span.break-words')).toBeTruthy();
  });

  it('submits the same ranked_choices payload whether reordered by arrow buttons or by drag', async () => {
    const submitMyResponse = vi.fn().mockReturnValue(of(undefined));
    await setup(vi.fn().mockReturnValue(of(RANKED)), { submitMyResponse });
    await openWithoutListVote();
    const cmp = fixture.componentInstance;

    // Touch path: move Charlie up twice via the per-row arrow button.
    (el('vote-cast-rank-up-c3') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el('vote-cast-rank-up-c3') as HTMLButtonElement).click();
    fixture.detectChanges();
    cmp['onSubmit']();
    await fixture.whenStable();
    const [, arrowPayload] = submitMyResponse.mock.calls[0] as [string, { userVoteContent: unknown[] }];

    // Pointer path: the equivalent drop (index 2 -> 0) on a fresh drawer.
    submitMyResponse.mockClear();
    await setup(vi.fn().mockReturnValue(of(RANKED)), { submitMyResponse });
    await openWithoutListVote();
    fixture.componentInstance['onRankedDrop']('q1', { previousIndex: 2, currentIndex: 0 } as never);
    fixture.componentInstance['onSubmit']();
    await fixture.whenStable();
    const [, dragPayload] = submitMyResponse.mock.calls[0] as [string, { userVoteContent: unknown[] }];

    expect(arrowPayload.userVoteContent).toEqual([
      {
        question_id: 'q1',
        ranked_choices: [
          { choice_id: 'c3', choice_rank: 1 },
          { choice_id: 'c1', choice_rank: 2 },
          { choice_id: 'c2', choice_rank: 3 },
        ],
      },
    ]);
    expect(dragPayload.userVoteContent).toEqual(arrowPayload.userVoteContent);
  });

  it('caps a long description on phones so the ballot starts in view, in a focusable scroll region', async () => {
    await setup(vi.fn().mockReturnValue(of({ ...VOTE, description: '<p>Long background text.</p>' })));

    await openWithoutListVote();

    const description = el('vote-cast-drawer-description') as HTMLElement;
    expect(description.className).toContain('max-sm:max-h-[40dvh]');
    expect(description.className).toContain('max-sm:overflow-y-auto');
    expect(description.getAttribute('tabindex')).toBe('0');
    expect(description.getAttribute('role')).toBe('region');
  });
});
