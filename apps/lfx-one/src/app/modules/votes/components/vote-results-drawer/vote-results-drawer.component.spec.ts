// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { PollStatus } from '@lfx-one/shared/enums';
import { MyVoteResponse, Vote } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { Observable, of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoteResultsDrawerComponent } from './vote-results-drawer.component';

let fixture: ComponentFixture<VoteResultsDrawerComponent>;

afterEach(() => {
  fixture?.destroy();
  document.body.innerHTML = '';
});

function makeVote(status: PollStatus, uid = 'vote-1'): Vote {
  return { uid, name: 'Charter ratification', description: '<p>Approve the revised charter.</p>', project_uid: 'project-1', status } as Vote;
}

async function setupDrawer(vote: Vote, myResponse: Observable<MyVoteResponse | null> = of(null), audience: 'voter' | 'creator' = 'voter') {
  const service = {
    getVote: vi.fn(() => of(vote)),
    getMyVoteResponse: vi.fn(() => myResponse),
    getVoteResults: vi.fn(() => of(null)),
  };
  await TestBed.configureTestingModule({
    imports: [VoteResultsDrawerComponent],
    providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
  }).compileComponents();
  fixture = TestBed.createComponent(VoteResultsDrawerComponent);
  fixture.componentRef.setInput('voteId', vote.uid);
  fixture.componentRef.setInput('audience', audience);
  fixture.componentRef.setInput('visible', true);
  await fixture.whenStable();
  fixture.detectChanges();
  return service;
}

describe('VoteResultsDrawerComponent — view-only permalink', () => {
  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('shows vote details without casting or results for a non-voter (%s)', async (status) => {
    const service = await setupDrawer(makeVote(status));

    expect(document.querySelector('[data-testid="vote-results-voter-not-participant"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="vote-results-voter-description"]')?.textContent).toContain('Approve the revised charter.');
    expect(document.querySelector('[data-testid="vote-results-drawer-cast-button"]')).toBeNull();
    expect(document.querySelector('[data-testid="vote-results-voter-final"]')).toBeNull();
    expect(service.getVoteResults).not.toHaveBeenCalled();
  });

  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('never fetches results for a removed voter (%s)', async (status) => {
    const service = await setupDrawer(makeVote(status), of({ uid: 'response-1', vote_uid: 'vote-1', voter_removed: true }));

    expect(document.querySelector('[data-testid="vote-results-voter-access-denied"]')).toBeTruthy();
    expect(service.getVoteResults).not.toHaveBeenCalled();
  });

  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('fetches confirmed voter results only after close (%s)', async (status) => {
    const service = await setupDrawer(makeVote(status), of({ uid: 'response-1', vote_uid: 'vote-1' }));

    expect(service.getVoteResults).toHaveBeenCalledTimes(status === PollStatus.ENDED ? 1 : 0);
    if (status === PollStatus.ENDED) expect(service.getVoteResults).toHaveBeenCalledWith('vote-1');
  });

  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('preserves creator results regardless of participation (%s)', async (status) => {
    const service = await setupDrawer(makeVote(status), of(null), 'creator');

    expect(service.getVoteResults).toHaveBeenCalledWith('vote-1');
    expect(service.getMyVoteResponse).not.toHaveBeenCalled();
  });

  it('waits for a pending participation check before requesting closed-vote results', async () => {
    const pending = new Subject<MyVoteResponse | null>();
    const service = await setupDrawer(makeVote(PollStatus.ENDED), pending);
    expect(service.getVoteResults).not.toHaveBeenCalled();

    pending.next({ uid: 'response-1', vote_uid: 'vote-1' });
    pending.complete();
    await fixture.whenStable();

    expect(service.getVoteResults).toHaveBeenCalledTimes(1);
    expect(service.getVoteResults).toHaveBeenCalledWith('vote-1');
  });

  it('does not request results when the participation check fails', async () => {
    const pending = new Subject<MyVoteResponse | null>();
    const service = await setupDrawer(makeVote(PollStatus.ENDED), pending);
    pending.error(new Error('Synthetic participation lookup failure'));
    await fixture.whenStable();

    expect(service.getVoteResults).not.toHaveBeenCalled();
    expect(fixture.componentInstance['myResponseError']()).toBe(true);
  });

  it('does not reuse the previous vote participation row while changing votes', async () => {
    const service = await setupDrawer(makeVote(PollStatus.ENDED), of({ uid: 'response-1', vote_uid: 'vote-1' }));
    expect(service.getVoteResults).toHaveBeenCalledTimes(1);

    const nextResponse = new Subject<MyVoteResponse | null>();
    service.getVote.mockReturnValue(of(makeVote(PollStatus.ENDED, 'vote-2')));
    service.getMyVoteResponse.mockReturnValue(nextResponse);
    fixture.componentRef.setInput('voteId', 'vote-2');
    await fixture.whenStable();
    expect(service.getVoteResults).toHaveBeenCalledTimes(1);

    nextResponse.next(null);
    nextResponse.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.getVoteResults).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="vote-results-voter-not-participant"]')).toBeTruthy();
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86uAEES @cursor "Drawer reopen token double-fetches vote"): an effect()
  // bumping a reopen token fired in addition to combineLatest's own initial emission, so opening the drawer
  // called getVote twice. Pins the fix: initVote() keys off toObservable(visible) directly (the pattern
  // initMyResponse already used) instead of an effect()-driven counter, so opening fetches exactly once.
  it('fetches the vote exactly once when the drawer opens', async () => {
    const vote = makeVote(PollStatus.ACTIVE);
    const service = {
      getVote: vi.fn(() => of(vote)),
      getMyVoteResponse: vi.fn(() => of(null)),
      getVoteResults: vi.fn(() => of(null)),
    };
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();
    fixture.detectChanges();

    service.getVote.mockClear();
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.getVote).toHaveBeenCalledTimes(1);
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86uO6AL @greptile-apps, PRRT_kwDOPMiRQ86uO6wo @cursor,
  // PRRT_kwDOPMiRQ86uO-Du @copilot-pull-request-reviewer): the fix above forced initVote() to
  // re-emit on every visibility toggle but only destructured the id, so closing the drawer re-fetched
  // (and could clear) an already-loaded vote. Pins the fix: closing short-circuits with EMPTY instead,
  // so the last-loaded vote is retained through the close animation with no extra request.
  it('does not re-fetch the vote when the drawer closes', async () => {
    const vote = makeVote(PollStatus.ACTIVE);
    const service = {
      getVote: vi.fn(() => of(vote)),
      getMyVoteResponse: vi.fn(() => of(null)),
      getVoteResults: vi.fn(() => of(null)),
    };
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.getVote).toHaveBeenCalledTimes(1);

    service.getVote.mockClear();
    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.getVote).not.toHaveBeenCalled();
    expect(fixture.componentInstance['vote']()).toEqual(vote);
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86uSzGw @cursor "Open drawer keeps stale deadline"): a manager extending
  // a vote's deadline from the table row while this drawer stays open on the same vote never re-fetched,
  // since neither voteId nor visible() changed — only the caller's listVote input updated once it re-fetched.
  // Pins the fix: initVote() also keys off listVote()'s end_time/end_time_timezone, so an extended deadline
  // re-fetches the vote while the drawer remains open.
  it('re-fetches the vote when the open listVote input gets an extended deadline', async () => {
    const vote = makeVote(PollStatus.ACTIVE);
    vote.end_time = '2026-01-01T00:00:00Z';
    const service = {
      getVote: vi.fn(() => of(vote)),
      getMyVoteResponse: vi.fn(() => of(null)),
      getVoteResults: vi.fn(() => of(null)),
    };
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('listVote', vote);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.getVote).toHaveBeenCalledTimes(1);

    service.getVote.mockClear();
    const extended = { ...vote, end_time: '2026-02-01T00:00:00Z' };
    service.getVote.mockReturnValue(of(extended));
    fixture.componentRef.setInput('listVote', extended);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.getVote).toHaveBeenCalledTimes(1);
    expect(service.getVote).toHaveBeenCalledWith(vote.uid, { skipCache: true });
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86uWkkK @copilot-pull-request-reviewer "stale cache on deadline
  // change"): getVote()/getVoteDetail() share a short-TTL request cache, so the re-fetch above could
  // still echo the pre-extension response if it landed within that TTL. Pins the fix against the real
  // VoteService (not the mock above): a deadline-change re-fetch passes skipCache so it always hits
  // the network, while a plain reopen on the same deadline still reuses the cached in-flight response.
  it('bypasses the real VoteService cache when the open listVote input gets an extended deadline', async () => {
    const vote = makeVote(PollStatus.ACTIVE);
    vote.end_time = '2026-01-01T00:00:00Z';

    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('listVote', vote);
    await fixture.whenStable();
    fixture.detectChanges();

    const firstReq = httpMock.expectOne(`/api/votes/${vote.uid}`);
    firstReq.flush(vote);
    httpMock.expectOne((req) => req.url.includes('/my-response')).flush(null);

    const extended = { ...vote, end_time: '2026-02-01T00:00:00Z' };
    fixture.componentRef.setInput('listVote', extended);
    await fixture.whenStable();
    fixture.detectChanges();

    // A second real HTTP request — not the cached first response — proves skipCache worked.
    // (initMyResponse only keys off voteId/audience/visible, so it does not re-fire here.)
    const secondReq = httpMock.expectOne(`/api/votes/${vote.uid}`);
    secondReq.flush(extended);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['vote']()).toEqual(extended);
    httpMock.verify();
  });

  it('does not re-fetch when listVote is replaced without a deadline change', async () => {
    const vote = makeVote(PollStatus.ACTIVE);
    vote.end_time = '2026-01-01T00:00:00Z';
    const service = {
      getVote: vi.fn(() => of(vote)),
      getMyVoteResponse: vi.fn(() => of(null)),
      getVoteResults: vi.fn(() => of(null)),
    };
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('listVote', vote);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.getVote).toHaveBeenCalledTimes(1);

    service.getVote.mockClear();
    fixture.componentRef.setInput('listVote', { ...vote });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.getVote).not.toHaveBeenCalled();
  });
});
