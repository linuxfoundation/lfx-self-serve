// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { PollStatus } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { Subject, throwError } from 'rxjs';
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

async function setup(getVoteImpl: ReturnType<typeof vi.fn>): Promise<void> {
  getVote = getVoteImpl;

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [VoteCastDrawerComponent],
    providers: [
      provideNoopAnimations(),
      provideRouter([]),
      { provide: VoteService, useValue: { getVote } },
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
    expect(getVote).toHaveBeenCalledWith(VOTE.uid);
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
