// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [VoteCastDrawerComponent],
    providers: [
      provideNoopAnimations(),
      provideRouter([]),
      { provide: VoteService, useValue: { getVote, ...voteServiceOverrides } },
      { provide: MessageService, useValue: { add: vi.fn() } },
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

describe('VoteCastDrawerComponent — change ballot mode (#4331)', () => {
  const CHANGE_VOTE: Vote = {
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

  async function openChanging(vote: Vote, getMyVoteBallot: ReturnType<typeof vi.fn>, overrides: Record<string, unknown> = {}): Promise<void> {
    await setup(vi.fn().mockReturnValue(of(vote)), { getMyVoteBallot, ...overrides });
    fixture.componentRef.setInput('changingBallot', true);
    await openWithoutListVote();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function submitButton(): HTMLButtonElement | null {
    return el('vote-cast-submit-button')?.querySelector('button') ?? null;
  }

  it('pre-fills the single choice, multiple choices and comments, with the replace notice and "Submit changes"', async () => {
    const getMyVoteBallot = vi.fn().mockReturnValue(of(BALLOT));
    await openChanging(CHANGE_VOTE, getMyVoteBallot);

    const component = fixture.componentInstance;
    expect(getMyVoteBallot).toHaveBeenCalledWith(VOTE.uid);
    expect(component.form.get('q1')?.value).toBe('c2');
    expect(component.form.get('q2')?.value).toEqual(['m1', 'm3']);
    expect(component.commentForm.get('p1')?.value).toBe('Needs a second reading');
    expect(component.abstainControl.value).toBe(false);
    expect(el('vote-cast-replace-notice')?.textContent).toContain('Submitting replaces your current ballot.');
    expect(submitButton()?.textContent?.trim()).toBe('Submit changes');
    expect(component['submitDisabled']()).toBe(false);
  });

  it('pre-fills only recorded ranks and shows the remaining choices as unranked', async () => {
    await openChanging(RANKED_VOTE, vi.fn().mockReturnValue(of(RANKED_BALLOT)));

    expect(fixture.componentInstance.form.get('q1')?.value).toEqual(['r3', 'r1']);
    expect(el('vote-cast-rank-r2')).toBeNull();
    expect(el('vote-cast-unranked-r2')?.textContent).toContain('Blake');
    expect((el('vote-cast-rank-down-r1') as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([false, true])('preserves the partial ranking when submitting with comment changes: %s', async (changeComment) => {
    const submitMyResponse = vi.fn().mockReturnValue(of(undefined));
    await openChanging(RANKED_VOTE, vi.fn().mockReturnValue(of(RANKED_BALLOT)), { submitMyResponse });
    if (changeComment) fixture.componentInstance.commentForm.patchValue({ p1: 'Updated comment only' });
    await fixture.whenStable();
    fixture.detectChanges();

    submitButton()?.click();
    await fixture.whenStable();

    expect(submitMyResponse).toHaveBeenCalledWith(VOTE.uid, {
      abstain: false,
      userVoteContent: [
        {
          question_id: 'q1',
          ranked_choices: [
            { choice_id: 'r3', choice_rank: 1 },
            { choice_id: 'r1', choice_rank: 2 },
          ],
        },
      ],
      commentResponses: [{ prompt_id: 'p1', comment_text: changeComment ? 'Updated comment only' : 'Needs a second reading' }],
    });
  });

  it('adds and removes ranked preferences only through explicit actions, and can reorder the partial list', async () => {
    const submitMyResponse = vi.fn().mockReturnValue(of(undefined));
    await openChanging(RANKED_VOTE, vi.fn().mockReturnValue(of(RANKED_BALLOT)), { submitMyResponse });

    el('vote-cast-unrank-r1')?.querySelector('button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.form.get('q1')?.value).toEqual(['r3']);
    expect(el('vote-cast-unranked-r1')).not.toBeNull();

    el('vote-cast-add-rank-r2')?.querySelector('button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    el('vote-cast-rank-up-r2')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.form.get('q1')?.value).toEqual(['r2', 'r3']);
    expect(el('vote-cast-rank-r1')).toBeNull();
    submitButton()?.click();
    await fixture.whenStable();
    expect(submitMyResponse).toHaveBeenCalledWith(
      VOTE.uid,
      expect.objectContaining({
        userVoteContent: [
          {
            question_id: 'q1',
            ranked_choices: [
              { choice_id: 'r2', choice_rank: 1 },
              { choice_id: 'r3', choice_rank: 2 },
            ],
          },
        ],
      })
    );
  });

  it('does not silently seed ranks after every preference is removed, and disables ranking while abstaining', async () => {
    await openChanging(RANKED_VOTE, vi.fn().mockReturnValue(of(RANKED_BALLOT)));
    for (const id of ['r3', 'r1']) {
      el('vote-cast-unrank-' + id)
        ?.querySelector('button')
        ?.click();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    expect(fixture.componentInstance.form.get('q1')?.value).toEqual([]);
    expect(fixture.componentInstance['submitDisabled']()).toBe(true);
    expect(el('vote-cast-rank-r3')).toBeNull();
    expect(el('vote-cast-unranked-r3')).not.toBeNull();

    fixture.componentInstance.abstainControl.setValue(true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['submitDisabled']()).toBe(false);
    expect(el('vote-cast-add-rank-r2')?.querySelector('button')?.disabled).toBe(true);
    fixture.componentInstance.abstainControl.setValue(false);
    await fixture.whenStable();
    fixture.detectChanges();
    el('vote-cast-add-rank-r2')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.form.get('q1')?.value).toEqual(['r2']);
    expect(fixture.componentInstance['submitDisabled']()).toBe(false);
  });

  it('keeps a ranked abstention empty when the voter switches back to choosing preferences', async () => {
    await openChanging(RANKED_VOTE, vi.fn().mockReturnValue(of({ ...RANKED_BALLOT, abstained: true, poll_answers: [] })));

    expect(fixture.componentInstance.form.get('q1')?.value).toEqual([]);
    expect(fixture.componentInstance.form.disabled).toBe(true);
    fixture.componentInstance.abstainControl.setValue(false);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.form.get('q1')?.value).toEqual([]);
    expect(fixture.componentInstance['submitDisabled']()).toBe(true);
    expect(el('vote-cast-rank-r1')).toBeNull();
    expect(el('vote-cast-unranked-r1')).not.toBeNull();
  });

  it('requires removing the recorded preference before adding another on a ranked single-choice question', async () => {
    const submitMyResponse = vi.fn().mockReturnValue(of(undefined));
    const vote: Vote = { ...RANKED_VOTE, poll_questions: RANKED_VOTE.poll_questions?.map((question) => ({ ...question, type: 'single_choice' })) };
    const ballot: MyVoteBallot = {
      ...RANKED_BALLOT,
      poll_answers: RANKED_BALLOT.poll_answers.map((answer) => ({
        ...answer,
        type: 'single_choice',
        ranked_user_choice: answer.ranked_user_choice.slice(0, 1),
      })),
    };
    await openChanging(vote, vi.fn().mockReturnValue(of(ballot)), { submitMyResponse });

    expect(el('vote-cast-add-rank-r2')?.querySelector('button')?.disabled).toBe(true);
    fixture.componentInstance['addRank']('q1', 'r2');
    expect(fixture.componentInstance.form.get('q1')?.value).toEqual(['r3']);
    el('vote-cast-unrank-r3')?.querySelector('button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el('vote-cast-add-rank-r2')?.querySelector('button')?.disabled).toBe(false);
    el('vote-cast-add-rank-r2')?.querySelector('button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    submitButton()?.click();
    await fixture.whenStable();

    expect(submitMyResponse).toHaveBeenCalledWith(
      VOTE.uid,
      expect.objectContaining({ userVoteContent: [{ question_id: 'q1', ranked_choices: [{ choice_id: 'r2', choice_rank: 1 }] }] })
    );
  });

  it('keeps the first-ballot ranked form seeded in full declared order', async () => {
    await setup(vi.fn().mockReturnValue(of(RANKED_VOTE)));
    await openWithoutListVote();

    expect(fixture.componentInstance.form.get('q1')?.value).toEqual(['r1', 'r2', 'r3']);
    expect(el('vote-cast-rank-r2')).not.toBeNull();
    expect(el('vote-cast-unrank-r2')).toBeNull();
    expect(el('vote-cast-unranked-r2')).toBeNull();
  });

  it('pre-fills an abstention', async () => {
    await openChanging(CHANGE_VOTE, vi.fn().mockReturnValue(of({ ...BALLOT, abstained: true, poll_answers: [] })));

    expect(fixture.componentInstance.abstainControl.value).toBe(true);
    expect(fixture.componentInstance.form.disabled).toBe(true);
  });

  it('keeps submit disabled while the current ballot loads', async () => {
    const pending = new Subject<MyVoteBallot | null>();
    await openChanging(CHANGE_VOTE, vi.fn().mockReturnValue(pending.asObservable()));

    expect(el('vote-cast-ballot-loading')).toBeTruthy();
    expect(fixture.componentInstance['submitDisabled']()).toBe(true);
  });

  it.each([
    ['fails', () => throwError(() => new Error('500'))],
    ['finds no ballot', () => of(null)],
  ])('shows the load error and keeps submit disabled when the ballot load %s', async (_label, load) => {
    await openChanging(CHANGE_VOTE, vi.fn().mockImplementation(load));

    expect(el('vote-cast-ballot-error')?.textContent).toContain("Couldn't load your current ballot.");
    expect(el('vote-cast-replace-notice')).toBeNull();
    expect(fixture.componentInstance.form.get('q1')?.value).toBeNull();
    expect(fixture.componentInstance['submitDisabled']()).toBe(true);
  });

  it('shows the update toast after submitting changes', async () => {
    const submitMyResponse = vi.fn().mockReturnValue(of(undefined));
    await openChanging(CHANGE_VOTE, vi.fn().mockReturnValue(of(BALLOT)), { submitMyResponse });
    (fixture.componentInstance.form.get('q1') as unknown as FormControl<string | null>).setValue('c1');

    fixture.componentInstance['onSubmit']();
    await fixture.whenStable();

    expect(submitMyResponse).toHaveBeenCalledWith(
      VOTE.uid,
      expect.objectContaining({ commentResponses: [{ prompt_id: 'p1', comment_text: 'Needs a second reading' }] })
    );
    expect(TestBed.inject(MessageService).add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Ballot updated', detail: 'Your changes have been recorded.' })
    );
  });

  it('leaves first-vote mode unchanged', async () => {
    const getMyVoteBallot = vi.fn();
    await setup(vi.fn().mockReturnValue(of(CHANGE_VOTE)), { getMyVoteBallot });

    await openWithoutListVote();

    expect(getMyVoteBallot).not.toHaveBeenCalled();
    expect(el('vote-cast-replace-notice')).toBeNull();
    expect(submitButton()?.textContent?.trim()).toBe('Submit Vote');
    expect(fixture.componentInstance.form.get('q1')?.value).toBeNull();
  });
});
