// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { IndexedVoteResponseStatus, PollStatus } from '@lfx-one/shared/enums';
import { MyVoteResponse, Project, ServerRequestContext, Vote, VotePermalinkState } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectService } from '@services/project.service';
import { VoteService } from '@services/vote.service';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VotePermalinkComponent } from './vote-permalink.component';

function makeVote(overrides: Partial<Vote> = {}): Vote {
  return {
    uid: 'vote-1',
    name: 'Board election',
    status: PollStatus.ACTIVE,
    project_uid: 'proj-1',
    project_slug: 'kubernetes',
    committee_uid: 'committee-1',
    ...overrides,
  } as Vote;
}

function makeResponse(status: IndexedVoteResponseStatus): MyVoteResponse {
  return { uid: 'resp-1', vote_uid: 'vote-1', vote_status: status };
}

function httpError(status: number): Observable<never> {
  return throwError(() => new HttpErrorResponse({ status }));
}

describe('VotePermalinkComponent', () => {
  let voteService: { fetchVote: ReturnType<typeof vi.fn>; getMyVoteResponse: ReturnType<typeof vi.fn> };
  let projectService: { getProjectStrict: ReturnType<typeof vi.fn> };
  let committeeService: { fetchCommittee: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let reqContext: ServerRequestContext;

  async function setup(platform: 'browser' | 'server' = 'browser'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [VotePermalinkComponent],
      providers: [
        { provide: VoteService, useValue: voteService },
        { provide: ProjectService, useValue: projectService },
        { provide: CommitteeService, useValue: committeeService },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(new Map([['id', 'vote-1']])) } },
        { provide: PLATFORM_ID, useValue: platform },
        { provide: REQUEST_CONTEXT, useValue: reqContext },
      ],
    })
      // The state stream is what's under test — keep the embedded dashboard and its dependencies out.
      .overrideComponent(VotePermalinkComponent, { set: { imports: [], template: '' } })
      .compileComponents();
  }

  function stateOf(): VotePermalinkState {
    const fixture = TestBed.createComponent(VotePermalinkComponent);
    TestBed.tick();
    return fixture.componentInstance['state']();
  }

  beforeEach(() => {
    voteService = { fetchVote: vi.fn().mockReturnValue(of(makeVote())), getMyVoteResponse: vi.fn().mockReturnValue(of(null)) };
    projectService = { getProjectStrict: vi.fn().mockReturnValue(of({ writer: false } as Project)) };
    committeeService = { fetchCommittee: vi.fn().mockReturnValue(of({ writer: false })) };
    router = { navigate: vi.fn() };
    reqContext = {} as ServerRequestContext;
  });

  describe('not found vs transient error', () => {
    it.each([400, 403, 404])('maps a %i on the vote fetch to the in-place not-found state', async (status) => {
      voteService.fetchVote.mockReturnValue(httpError(status));
      await setup();

      expect(stateOf()).toEqual({ loading: false, notFound: true, error: false, target: null });
      expect(voteService.getMyVoteResponse).not.toHaveBeenCalled();
    });

    it('maps a 500 to the error state without flagging an SSR 404', async () => {
      voteService.fetchVote.mockReturnValue(httpError(500));
      await setup('server');

      expect(stateOf()).toEqual({ loading: false, notFound: false, error: true, target: null });
      expect(reqContext.notFound).toBeUndefined();
    });

    it('treats a failed my-response call as transient, not not-found', async () => {
      voteService.getMyVoteResponse.mockReturnValue(httpError(500));
      await setup();

      expect(stateOf().error).toBe(true);
    });

    it.each([403, 404])('sets the SSR not-found flag without a drawer target for status %i', async (status) => {
      voteService.fetchVote.mockReturnValue(httpError(status));
      await setup('server');

      expect(stateOf()).toEqual({ loading: false, notFound: true, error: false, target: null });
      expect(reqContext.notFound).toBe(true);
      expect(voteService.getMyVoteResponse).not.toHaveBeenCalled();
    });

    it('stops after the vote fetch on the server, leaving the drawer target to the browser', async () => {
      await setup('server');

      expect(stateOf()).toEqual({ loading: true, notFound: false, error: false, target: null });
      expect(voteService.fetchVote).toHaveBeenCalledWith('vote-1');
      expect(reqContext.notFound).toBeUndefined();
      expect(voteService.getMyVoteResponse).not.toHaveBeenCalled();
      expect(projectService.getProjectStrict).not.toHaveBeenCalled();
      expect(committeeService.fetchCommittee).not.toHaveBeenCalled();
    });

    it('does not set reqContext.notFound in the browser', async () => {
      voteService.fetchVote.mockReturnValue(httpError(404));
      await setup('browser');

      stateOf();

      expect(reqContext.notFound).toBeUndefined();
    });

    it('re-runs the load on retry', async () => {
      voteService.fetchVote.mockReturnValueOnce(httpError(503)).mockReturnValue(of(makeVote()));
      await setup();
      const fixture = TestBed.createComponent(VotePermalinkComponent);
      TestBed.tick();
      expect(fixture.componentInstance['state']().error).toBe(true);

      fixture.componentInstance['retry']();
      TestBed.tick();

      expect(fixture.componentInstance['state']().target).toEqual({ uid: 'vote-1', drawer: 'results', audience: 'voter' });
    });
  });

  describe('drawer and audience', () => {
    it('opens the cast drawer for a voter awaiting their ballot, skipping the writer check', async () => {
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE)));
      await setup();

      expect(stateOf().target).toEqual({ uid: 'vote-1', drawer: 'cast', audience: 'voter' });
      expect(projectService.getProjectStrict).not.toHaveBeenCalled();
      expect(committeeService.fetchCommittee).not.toHaveBeenCalled();
    });

    it.each([false, true])('does not open the cast drawer for a removed voter (project writer: %s)', async (writer) => {
      voteService.getMyVoteResponse.mockReturnValue(of({ ...makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE), voter_removed: true }));
      projectService.getProjectStrict.mockReturnValue(of({ writer } as Project));
      await setup();

      expect(stateOf().target).toEqual({ uid: 'vote-1', drawer: 'results', audience: writer ? 'creator' : 'voter' });
      expect(projectService.getProjectStrict).toHaveBeenCalledWith('kubernetes');
    });

    it('opens the results drawer for an awaiting row on an ended vote', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE)));
      await setup();

      expect(stateOf().target).toEqual({ uid: 'vote-1', drawer: 'results', audience: 'voter' });
    });

    it('opens the creator results drawer for a project writer who is not invited', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      await setup();

      expect(stateOf().target).toEqual({ uid: 'vote-1', drawer: 'results', audience: 'creator' });
      expect(projectService.getProjectStrict).toHaveBeenCalledWith('kubernetes');
      expect(committeeService.fetchCommittee).not.toHaveBeenCalled();
    });

    it('falls back to the committee writer check when the project is not writable', async () => {
      committeeService.fetchCommittee.mockReturnValue(of({ writer: true }));
      await setup();

      expect(stateOf().target).toEqual({ uid: 'vote-1', drawer: 'results', audience: 'creator' });
      expect(committeeService.fetchCommittee).toHaveBeenCalledWith('committee-1');
    });

    it.each([undefined, ''])('uses the project UID when the enriched slug is %s', async (projectSlug) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ project_slug: projectSlug })));
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      await setup();

      expect(stateOf().target).toEqual({ uid: 'vote-1', drawer: 'results', audience: 'creator' });
      expect(projectService.getProjectStrict).toHaveBeenCalledWith('proj-1');
      expect(committeeService.fetchCommittee).not.toHaveBeenCalled();
    });

    it('falls back to the committee when the UID-resolved project is not writable', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ project_slug: undefined })));
      committeeService.fetchCommittee.mockReturnValue(of({ writer: true }));
      await setup();

      expect(stateOf().target?.audience).toBe('creator');
      expect(projectService.getProjectStrict).toHaveBeenCalledWith('proj-1');
      expect(committeeService.fetchCommittee).toHaveBeenCalledWith('committee-1');
    });

    it('checks only the committee when the vote carries no project identifier', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ project_slug: undefined, project_uid: '' })));
      committeeService.fetchCommittee.mockReturnValue(of({ writer: true }));
      await setup();

      expect(stateOf().target?.audience).toBe('creator');
      expect(projectService.getProjectStrict).not.toHaveBeenCalled();
    });

    it('opens the voter results drawer for a viewer who is neither invited nor a writer', async () => {
      await setup();

      expect(stateOf().target).toEqual({ uid: 'vote-1', drawer: 'results', audience: 'voter' });
    });

    it('opens the voter results drawer for a voter who already responded', async () => {
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      await setup();

      expect(stateOf().target).toEqual({ uid: 'vote-1', drawer: 'results', audience: 'voter' });
    });

    it('logs a failed project writer check and keeps the voter view, never not-found', async () => {
      const error = new HttpErrorResponse({ status: 500 });
      const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      projectService.getProjectStrict.mockReturnValue(throwError(() => error));
      committeeService.fetchCommittee.mockReturnValue(httpError(500));
      try {
        await setup();

        expect(stateOf()).toEqual({ loading: false, notFound: false, error: false, target: { uid: 'vote-1', drawer: 'results', audience: 'voter' } });
        expect(logError).toHaveBeenCalledWith('Failed to check project write access for vote permalink', error);
      } finally {
        logError.mockRestore();
      }
    });
  });

  // #4148: the QR lands here, so the cast drawer must open on arrival exactly when the viewer can cast.
  describe('cast drawer on arrival (#4148)', () => {
    const cases: { name: string; vote: Vote; response: MyVoteResponse | null; cast: boolean }[] = [
      {
        name: 'active vote, eligible voter who has not responded',
        vote: makeVote(),
        response: makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE),
        cast: true,
      },
      { name: 'ended vote', vote: makeVote({ status: PollStatus.ENDED }), response: makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE), cast: false },
      { name: 'non-voter (no invitation row)', vote: makeVote(), response: null, cast: false },
      { name: 'voter who already cast', vote: makeVote(), response: makeResponse(IndexedVoteResponseStatus.RESPONDED), cast: false },
    ];

    it.each(cases)('$name -> cast drawer open: $cast', async ({ vote, response, cast }) => {
      voteService.fetchVote.mockReturnValue(of(vote));
      voteService.getMyVoteResponse.mockReturnValue(of(response));
      await setup();

      const target = stateOf().target;

      expect(target?.drawer).toBe(cast ? 'cast' : 'results');
      expect(target?.audience).toBe('voter');
    });
  });

  it('navigates to /votes with replaceUrl when the permalink drawer closes', async () => {
    await setup();
    const fixture = TestBed.createComponent(VotePermalinkComponent);

    fixture.componentInstance['onPermalinkClosed']();

    expect(router.navigate).toHaveBeenCalledWith(['/votes'], { replaceUrl: true });
  });
});
