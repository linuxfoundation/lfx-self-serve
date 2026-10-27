// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
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
 * My Votes host always passes a non-null listVote (so `startWith(listVote)` renders the header
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
    expect(footer?.className).toContain('flex-col-reverse');
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
