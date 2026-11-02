// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PublicProjectSummary, VoteBallotSubmission, VoteLinkBallot } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteLinkBallotComponent } from './vote-link-ballot.component';

// Synthetic fixtures only. The token is a placeholder, never a real credential.
const TOKEN = 'v1.synthetic.token';
const PATH = '/votes/v-1';

const BALLOT: VoteLinkBallot = {
  vote_uid: 'v-1',
  name: 'Synthetic board vote',
  description: 'Pick one',
  status: 'active',
  end_time: '2099-01-01T00:00:00Z',
  poll_type: 'generic',
  allow_abstain: true,
  pseudo_anonymity: false,
  poll_questions: [
    {
      question_id: 'q1',
      prompt: 'Who?',
      type: 'single_choice',
      choices: [
        { choice_id: 'c-a', choice_text: 'Alice' },
        { choice_id: 'c-b', choice_text: 'Bob' },
      ],
    },
  ],
  ballot: { vote_status: 'awaiting_response', already_voted: false, voter_removed: false },
};

const httpError = (status: number, message: string) => new HttpErrorResponse({ status, error: { error: message } });
const SUBMISSION: VoteBallotSubmission = { abstain: false, userVoteContent: [{ question_id: 'q1', choice_ids: ['c-a'] }] };

describe('VoteLinkBallotComponent (#4363)', () => {
  let fixture: ComponentFixture<VoteLinkBallotComponent>;
  let getLinkBallot: ReturnType<typeof vi.fn>;
  let submitLinkResponse: ReturnType<typeof vi.fn>;
  let getPublicProjectSummary: ReturnType<typeof vi.fn>;

  const state = () => (fixture.componentInstance as unknown as { state: () => string }).state();
  const submit = (submission = SUBMISSION) => (fixture.componentInstance as unknown as { onSubmit: (s: VoteBallotSubmission) => void }).onSubmit(submission);
  const testId = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  async function open(ballot: Observable<VoteLinkBallot>, hash = `#vote_token=${TOKEN}`): Promise<void> {
    window.history.replaceState(null, '', `${PATH}${hash}`);
    getLinkBallot.mockReturnValue(ballot);
    fixture = TestBed.createComponent(VoteLinkBallotComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    getLinkBallot = vi.fn();
    submitLinkResponse = vi.fn(() => of(undefined));
    getPublicProjectSummary = vi.fn(() => of(null));
    TestBed.configureTestingModule({
      imports: [VoteLinkBallotComponent],
      providers: [provideNoopAnimations(), { provide: VoteService, useValue: { getLinkBallot, submitLinkResponse, getPublicProjectSummary } }],
    });
  });

  afterEach(() => window.history.replaceState(null, '', '/'));

  it('reads the fragment token once, sends it to the ballot call, and removes the fragment from the address bar', async () => {
    await open(of(BALLOT));

    expect(getLinkBallot).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe(PATH);
    expect(state()).toBe('ready');
  });

  it('keeps the query string when it drops the fragment', async () => {
    await open(of(BALLOT), `?src=email#vote_token=${TOKEN}`);

    expect(window.location.search).toBe('?src=email');
    expect(window.location.hash).toBe('');
  });

  it('never writes the token to browser storage', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    await open(of(BALLOT));
    submit();

    expect(local).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(TOKEN);
  });

  it('shows the invalid-link state when there is no token, without calling the API', async () => {
    await open(of(BALLOT), '');

    expect(getLinkBallot).not.toHaveBeenCalled();
    expect(state()).toBe('invalid');
    expect(testId('vote-link-invalid')?.textContent).toContain('This link is invalid or has expired');
  });

  it('shows the LFX mark linking to a plain / on the invalid-link state (#4753)', async () => {
    await open(of(BALLOT), '');

    expect(testId('vote-link-lfx-mark')).not.toBeNull();
    expect(testId('vote-link-lfx-mark-link')?.getAttribute('href')).toBe('/');
  });

  it('shows the LFX mark linking to a plain / while the ballot is loading, with nothing token-derived in the page (#4753)', async () => {
    await open(NEVER);

    expect(state()).toBe('loading');
    expect(testId('vote-link-lfx-mark-link')?.getAttribute('href')).toBe('/');
    expect(fixture.nativeElement.innerHTML).not.toContain(TOKEN);
  });

  it('renders the vote and form for an active vote with title and description only, no identity chrome', async () => {
    await open(of(BALLOT));

    expect(testId('vote-link-title')?.textContent).toContain('Synthetic board vote');
    expect(testId('vote-link-description')).not.toBeNull();
    expect(testId('vote-link-ballot-form')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('lfx-header, lfx-navbar, [data-testid="user-menu"]')).toBeNull();
  });

  it('styles description links so emailed ballot voters can recognize them (#4655)', async () => {
    await open(of({ ...BALLOT, description: '<p>Read the <a href="https://example.com/charter">charter</a>.</p>' }));

    const description = testId('vote-link-description')!;
    expect(description.querySelector('a')?.textContent).toBe('charter');
    expect(description.classList.contains('[&_a]:text-blue-600')).toBe(true);
    expect(description.classList.contains('[&_a]:underline')).toBe(true);
  });

  it.each([
    { href: 'https://example.com/charter', plain: false },
    { href: '//example.com/charter', plain: false },
    { href: '/docs/charter', plain: false },
    { href: 'https://example.com/charter', plain: true },
  ])('opens description link $href (plain: $plain) without replacing or resetting the ballot (#4655)', async ({ href, plain }) => {
    const html = plain ? `Read ${href}.` : `<p>Read the <a href="${href}"><strong>charter</strong></a>.</p>`;
    await open(of({ ...BALLOT, description: html }));
    const description = testId('vote-link-description')!;
    const link = description.querySelector('a')!;
    const base = document.createElement('base');
    base.href = 'https://vote.example/votes/v-1';
    document.head.prepend(base);
    const form = testId('vote-link-ballot-form')!;
    const choice = form.querySelector<HTMLInputElement>('input[type="radio"]')!;
    choice.click();
    fixture.detectChanges();
    expect(choice.checked).toBe(true);
    const locationBefore = window.location.href;
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);

    try {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      (link.querySelector('strong') ?? link).dispatchEvent(event);
      fixture.detectChanges();

      expect(opened).toHaveBeenCalledExactlyOnceWith(new URL(href, base.href).href, '_blank', 'noopener,noreferrer');
      expect(event.defaultPrevented).toBe(true);
      expect(window.location.href).toBe(locationBefore);
      expect(state()).toBe('ready');
      expect(testId('vote-link-ballot-form')).toBe(form);
      expect(testId('vote-link-description')).toBe(description);
      expect(choice.checked).toBe(true);
      expect(submitLinkResponse).not.toHaveBeenCalled();
      expect(getLinkBallot).toHaveBeenCalledTimes(1);
    } finally {
      opened.mockRestore();
      base.remove();
    }
  });

  it('renders the loading state before the ballot arrives', async () => {
    window.history.replaceState(null, '', `${PATH}#vote_token=${TOKEN}`);
    getLinkBallot.mockReturnValue(new Observable<VoteLinkBallot>());
    fixture = TestBed.createComponent(VoteLinkBallotComponent);
    fixture.detectChanges();

    expect(state()).toBe('loading');
    expect(testId('vote-link-loading')).not.toBeNull();
  });

  it.each([
    ['not active', { ...BALLOT, status: 'disabled' }, 'not-open', "This vote isn't open yet"],
    ['ended', { ...BALLOT, status: 'ended' }, 'ended', 'This vote has ended'],
    ['voter removed', { ...BALLOT, ballot: { ...BALLOT.ballot, voter_removed: true } }, 'removed', "You're no longer a voter on this vote"],
  ])('shows no form for a %s vote', async (_label, ballot, expectedState, text) => {
    await open(of(ballot));

    expect(state()).toBe(expectedState);
    expect(fixture.nativeElement.textContent).toContain(text);
    expect(testId('vote-link-ballot-form')).toBeNull();
  });

  it.each([
    [404, 'invalid voting link', 'invalid'],
    [400, 'poll has ended', 'ended'],
    [400, 'voter has been removed', 'removed'],
    [503, 'service unavailable', 'error'],
    [413, 'payload too large', 'error'],
  ])('maps a %s ballot-read error (%s) to the %s state', async (status, message, expectedState) => {
    await open(throwError(() => httpError(status, message)));

    expect(state()).toBe(expectedState);
  });

  it('offers to update an already-submitted ballot, then shows the prefilled form and saves with PUT', async () => {
    await open(
      of({
        ...BALLOT,
        ballot: {
          vote_status: 'responded',
          already_voted: true,
          voter_removed: false,
          abstained: false,
          poll_answers: [{ question_id: 'q1', prompt: 'Who?', type: 'single_choice', user_choice: [{ choice_id: 'c-b', choice_text: 'Bob' }] }],
        },
      })
    );

    expect(testId('vote-link-update-prompt')?.textContent).toContain("You've already voted. Update your ballot?");
    expect(testId('vote-link-ballot-form')).toBeNull();

    testId('vote-link-update-button')?.querySelector('button')?.click();
    fixture.detectChanges();
    expect(testId('vote-link-ballot-form')).not.toBeNull();

    submit();
    expect(submitLinkResponse).toHaveBeenCalledWith({ vote_token: TOKEN, abstain: false, user_vote_content: SUBMISSION.userVoteContent }, true);
    expect(state()).toBe('updated');
  });

  it('submits a first ballot with POST, with the token only in the body, and confirms', async () => {
    await open(of(BALLOT));
    submit();

    expect(submitLinkResponse).toHaveBeenCalledExactlyOnceWith({ vote_token: TOKEN, abstain: false, user_vote_content: SUBMISSION.userVoteContent }, false);
    expect(state()).toBe('submitted');
    fixture.detectChanges();
    expect(testId('vote-link-submitted')).not.toBeNull();
  });

  it('switches to update mode and retries once with PUT when POST says the ballot is not awaiting a response', async () => {
    submitLinkResponse.mockReturnValueOnce(throwError(() => httpError(400, 'vote is not awaiting response'))).mockReturnValueOnce(of(undefined));
    await open(of(BALLOT));
    submit();

    expect(submitLinkResponse).toHaveBeenCalledTimes(2);
    expect(submitLinkResponse.mock.calls[0][1]).toBe(false);
    expect(submitLinkResponse.mock.calls[1][1]).toBe(true);
    expect(state()).toBe('updated');
  });

  it('retries only once: a second not-awaiting error is surfaced, not looped', async () => {
    submitLinkResponse.mockReturnValue(throwError(() => httpError(400, 'vote is not awaiting response')));
    await open(of(BALLOT));
    submit();

    expect(submitLinkResponse).toHaveBeenCalledTimes(2);
    expect(state()).not.toBe('updated');
  });

  it('switches to POST when PUT says no ballot has been submitted', async () => {
    submitLinkResponse.mockReturnValueOnce(throwError(() => httpError(400, 'vote is not responded'))).mockReturnValueOnce(of(undefined));
    await open(of({ ...BALLOT, ballot: { ...BALLOT.ballot, already_voted: true } }));
    submit();

    expect(submitLinkResponse.mock.calls.map(([, update]) => update)).toEqual([true, false]);
    expect(state()).toBe('submitted');
  });

  it.each([
    [404, 'invalid voting link', 'invalid'],
    [400, 'poll has ended', 'ended'],
    [400, 'voter has been removed', 'removed'],
  ])('maps a %s submit error (%s) to the %s state', async (status, message, expectedState) => {
    submitLinkResponse.mockReturnValue(throwError(() => httpError(status, message)));
    await open(of(BALLOT));
    submit();

    expect(state()).toBe(expectedState);
  });

  it('keeps the form and shows the upstream message for another 400', async () => {
    submitLinkResponse.mockReturnValue(throwError(() => httpError(400, 'choice is not valid')));
    await open(of(BALLOT));
    submit();
    fixture.detectChanges();

    expect(state()).toBe('ready');
    expect(testId('vote-link-inline-error')?.textContent).toContain('choice is not valid');
  });

  it('replaces the previous token, ballot and in-flight request when another link is opened on the same route', async () => {
    const second = { ...BALLOT, name: 'Second synthetic vote', vote_uid: 'v-2' };
    await open(of(BALLOT));
    expect(testId('vote-link-title')?.textContent).toContain('Synthetic board vote');

    getLinkBallot.mockReturnValue(of(second));
    window.history.replaceState(null, '', `${PATH}#vote_token=${TOKEN}-second`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    fixture.detectChanges();

    expect(getLinkBallot).toHaveBeenLastCalledWith(`${TOKEN}-second`);
    expect(window.location.hash).toBe('');
    expect(testId('vote-link-title')?.textContent).toContain('Second synthetic vote');

    submit();
    expect(submitLinkResponse.mock.calls.at(-1)?.[0].vote_token).toBe(`${TOKEN}-second`);
  });

  it('cancels the previous token request when a new fragment token arrives', async () => {
    window.history.replaceState(null, '', `${PATH}#vote_token=${TOKEN}`);
    getLinkBallot.mockReturnValueOnce(new Observable<VoteLinkBallot>());
    fixture = TestBed.createComponent(VoteLinkBallotComponent);
    fixture.detectChanges();
    expect(state()).toBe('loading');

    getLinkBallot.mockReturnValueOnce(of(BALLOT));
    window.history.replaceState(null, '', `${PATH}#vote_token=${TOKEN}-b`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    fixture.detectChanges();

    expect(state()).toBe('ready');
  });

  it('ignores a hash change that carries no token', async () => {
    await open(of(BALLOT));
    getLinkBallot.mockClear();
    window.history.replaceState(null, '', `${PATH}#section`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(getLinkBallot).not.toHaveBeenCalled();
    expect(state()).toBe('ready');
  });

  it('sets a no-referrer meta tag while mounted', async () => {
    await open(of(BALLOT));

    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
    fixture.destroy();
    expect(document.head.querySelector('meta[name="referrer"]')).toBeNull();
  });
});

describe('VoteLinkBallotComponent branding and thank-you (#4692)', () => {
  let fixture: ComponentFixture<VoteLinkBallotComponent>;
  let getPublicProjectSummary: ReturnType<typeof vi.fn>;
  let submitLinkResponse: ReturnType<typeof vi.fn>;

  const testId = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const text = (id: string) => testId(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const PROJECT: PublicProjectSummary = { name: 'Synthetic Project', slug: 'synthetic', logo_url: 'https://cdn.example/logo.svg', is_foundation: false };

  async function open(): Promise<void> {
    window.history.replaceState(null, '', `${PATH}#vote_token=${TOKEN}`);
    fixture = TestBed.createComponent(VoteLinkBallotComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const submit = (submission: VoteBallotSubmission = SUBMISSION) => {
    (fixture.componentInstance as unknown as { onSubmit: (s: VoteBallotSubmission) => void }).onSubmit(submission);
    fixture.detectChanges();
  };

  beforeEach(() => {
    getPublicProjectSummary = vi.fn(() => of(PROJECT));
    submitLinkResponse = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({
      imports: [VoteLinkBallotComponent],
      providers: [provideNoopAnimations(), { provide: VoteService, useValue: { getLinkBallot: vi.fn(), submitLinkResponse, getPublicProjectSummary } }],
    });
  });

  afterEach(() => window.history.replaceState(null, '', '/'));

  async function openWith(ballot: VoteLinkBallot): Promise<void> {
    (TestBed.inject(VoteService) as unknown as { getLinkBallot: ReturnType<typeof vi.fn> }).getLinkBallot.mockReturnValue(of(ballot));
    await open();
  }

  it('treats a 503 on the ballot call (project mapper unavailable) as a try-again error, not an unbranded ballot', async () => {
    (TestBed.inject(VoteService) as unknown as { getLinkBallot: ReturnType<typeof vi.fn> }).getLinkBallot.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'service unavailable' } }))
    );
    await open();

    expect(testId('vote-link-error')?.textContent).toContain('try again');
    expect(testId('vote-link-ballot-form')).toBeNull();
    expect(getPublicProjectSummary).not.toHaveBeenCalled();
  });

  it('shows the project logo, name and vote title when the ballot names a project', async () => {
    await openWith({ ...BALLOT, project_uid: 'p-1' });

    expect(getPublicProjectSummary).toHaveBeenCalledExactlyOnceWith('p-1');
    expect(text('vote-link-project-name')).toBe('Synthetic Project');
    expect(testId('vote-link-project-logo')?.getAttribute('src')).toBe(PROJECT.logo_url);
    expect(text('vote-link-title')).toBe('Synthetic board vote');
    expect(testId('vote-link-lfx-mark')).not.toBeNull();
  });

  it('looks the project up by slug when only the slug is present', async () => {
    await openWith({ ...BALLOT, project_slug: 'synthetic' });

    expect(getPublicProjectSummary).toHaveBeenCalledExactlyOnceWith('synthetic');
  });

  it('renders unbranded with the LFX mark when the summary 404s, never an error state', async () => {
    getPublicProjectSummary.mockReturnValue(of(null));
    await openWith({ ...BALLOT, project_uid: 'p-hidden' });

    expect(testId('vote-link-project-name')).toBeNull();
    expect(testId('vote-link-lfx-mark')).not.toBeNull();
    expect(text('vote-link-title')).toBe('Synthetic board vote');
    expect(testId('vote-link-ballot-form')).not.toBeNull();
    expect(testId('vote-link-error')).toBeNull();
  });

  it('renders unbranded without any lookup when the ballot has no project key', async () => {
    await openWith(BALLOT);

    expect(getPublicProjectSummary).not.toHaveBeenCalled();
    expect(testId('vote-link-lfx-mark')).not.toBeNull();
    expect(testId('vote-link-project-name')).toBeNull();
  });

  it('shows only the LFX mark, once, when the project has no logo', async () => {
    getPublicProjectSummary.mockReturnValue(of({ ...PROJECT, logo_url: null }));
    await openWith({ ...BALLOT, project_uid: 'p-1' });

    expect(testId('vote-link-project-logo')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="vote-link-lfx-mark"]').length).toBe(1);
    expect(text('vote-link-project-name')).toBe('Synthetic Project');
  });

  it('shows the status chip and a localised deadline in the compact header', async () => {
    // Midday UTC, mid-year: the same calendar day and year in every timezone, so the text does not depend on the runner's TZ.
    await openWith({ ...BALLOT, end_time: '2099-06-15T12:00:00Z' });

    expect(text('vote-link-status')).toBe('Open');
    expect(text('vote-link-deadline')).toContain('Closes');
    expect(text('vote-link-deadline')).toContain('Jun 15, 2099');
  });

  it('shows a full thank-you screen with the chosen answers after a regular submit', async () => {
    await openWith({ ...BALLOT, project_uid: 'p-1', pseudo_anonymity: false });
    submit();

    expect(text('vote-link-thank-you-heading')).toBe('Your vote is in');
    expect(text('vote-link-thank-you-project')).toBe('Synthetic Project');
    expect(text('vote-link-thank-you-title')).toBe('Synthetic board vote');
    expect(text('vote-link-thank-you-answer-q1')).toContain('Who?');
    expect(text('vote-link-thank-you-answer-q1')).toContain('Alice');
    expect(testId('vote-link-thank-you-secret')).toBeNull();
    expect(text('vote-link-thank-you-deadline')).toContain('You can change your vote until then from the same link.');
    expect(testId('vote-link-ballot-form')).toBeNull();
  });

  it('says the ballot is secret, and echoes no answers, on a pseudo-anonymous vote', async () => {
    await openWith({ ...BALLOT, pseudo_anonymity: true });
    submit();

    expect(text('vote-link-thank-you-secret')).toBe('Your ballot is secret');
    expect(testId('vote-link-thank-you-answer-q1')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Alice');
  });

  it('treats a missing pseudo_anonymity as secret', async () => {
    const withoutFlag: Partial<VoteLinkBallot> = { ...BALLOT };
    delete withoutFlag.pseudo_anonymity;
    await openWith(withoutFlag as VoteLinkBallot);
    submit();

    expect(text('vote-link-thank-you-secret')).toBe('Your ballot is secret');
  });

  it('says "Your vote is updated" after an update, with only the two Self Serve links and no sign-in prompt or identity', async () => {
    await openWith({ ...BALLOT, pseudo_anonymity: false, ballot: { ...BALLOT.ballot, already_voted: true, vote_status: 'responded' } });
    (fixture.componentInstance as unknown as { onStartUpdate: () => void }).onStartUpdate();
    submit();

    expect(text('vote-link-thank-you-heading')).toBe('Your vote is updated');
    expect(fixture.nativeElement.querySelector('nav, lfx-button')).toBeNull();
    const hrefs = Array.from<HTMLAnchorElement>(fixture.nativeElement.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/votes']);
    expect(fixture.nativeElement.textContent).not.toMatch(/sign in|log in/i);
  });

  it('recaps an abstention instead of answers', async () => {
    await openWith({ ...BALLOT, pseudo_anonymity: false });
    submit({ abstain: true });

    expect(text('vote-link-thank-you-abstained')).toBe('You abstained');
  });
});
