// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { CommitteeService } from '@shared/services/committee.service';
import { MailingListService } from '@shared/services/mailing-list.service';
import { MeetingService } from '@shared/services/meeting.service';
import { PersonaService } from '@shared/services/persona.service';
import { ProjectContextService } from '@shared/services/project-context.service';
import { ProjectService } from '@shared/services/project.service';
import { SurveyService } from '@shared/services/survey.service';
import { VoteService } from '@shared/services/vote.service';
import { Committee, GroupsIOMailingList, Meeting, Survey, Vote } from '@lfx-one/shared/interfaces';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writerGuard } from './writer.guard';

// Pins the fail-closed entity-scoped slug contract (GH-1579/GH-1566/GH-1567/GH-1568/GH-1569): only a 404 probe read
// falls back to the stale context — anything else resolves no slug. Also covers the ED fast path and non-entity-scoped features.
// GH-2176: a persistent non-404 failure classifies transient (one retry, `_notice=error`) vs denial (`_notice=<writeFeature>`).
describe('writerGuard', () => {
  const MEETING_UID = 'meeting-uid-1';
  const MEETING_SLUG = 'meeting-project';
  const COMMITTEE_UID = 'committee-uid-1';
  const COMMITTEE_SLUG = 'committee-project';
  const VOTE_UID = 'vote-uid-1';
  const VOTE_SLUG = 'vote-project';
  const MAILING_LIST_UID = 'mailing-list-uid-1';
  const MAILING_LIST_SLUG = 'mailing-list-project';
  const SURVEY_UID = 'survey-uid-1';
  const SURVEY_SLUG = 'survey-project';
  const STALE_SLUG = 'stale-project';

  let getMeetingDetail: ReturnType<typeof vi.fn>;
  let getProjectStrict: ReturnType<typeof vi.fn>;
  let getCommittee: ReturnType<typeof vi.fn>;
  let fetchCommittee: ReturnType<typeof vi.fn>;
  let fetchVote: ReturnType<typeof vi.fn>;
  let getMailingList: ReturnType<typeof vi.fn>;
  let getSurvey: ReturnType<typeof vi.fn>;
  let router: { parseUrl: ReturnType<typeof vi.fn>; createUrlTree: ReturnType<typeof vi.fn> };
  let currentPersona: ReturnType<typeof signal<string>>;

  const httpError = (status: number) => new HttpErrorResponse({ status });

  // The retry resubscribes the probe's observable — it does not re-invoke the service
  // method — so a subscription counter is what proves the second attempt fired.
  const flakyError = (status: number, onSubscribe: () => void) =>
    new Observable<never>((subscriber) => {
      onSubscribe();
      subscriber.error(httpError(status));
    });

  const meetingRoute = (data: Record<string, unknown> = { writeFeature: 'meetings', entityScopedSlug: true }): ActivatedRouteSnapshot =>
    ({
      queryParamMap: convertToParamMap({}),
      paramMap: convertToParamMap({ id: MEETING_UID }),
      data,
      parent: null,
    }) as unknown as ActivatedRouteSnapshot;

  const committeeRoute = (): ActivatedRouteSnapshot =>
    ({
      queryParamMap: convertToParamMap({}),
      paramMap: convertToParamMap({ id: COMMITTEE_UID }),
      data: { writeFeature: 'committees', entityScopedSlug: true },
      parent: null,
    }) as unknown as ActivatedRouteSnapshot;

  const voteRoute = (): ActivatedRouteSnapshot =>
    ({
      queryParamMap: convertToParamMap({}),
      paramMap: convertToParamMap({ id: VOTE_UID }),
      data: { writeFeature: 'votes', entityScopedSlug: true },
      parent: null,
    }) as unknown as ActivatedRouteSnapshot;

  const mailingListRoute = (): ActivatedRouteSnapshot =>
    ({
      queryParamMap: convertToParamMap({}),
      paramMap: convertToParamMap({ id: MAILING_LIST_UID }),
      data: { writeFeature: 'mailing-lists', entityScopedSlug: true },
      parent: null,
    }) as unknown as ActivatedRouteSnapshot;

  const surveyRoute = (): ActivatedRouteSnapshot =>
    ({
      queryParamMap: convertToParamMap({}),
      paramMap: convertToParamMap({ id: SURVEY_UID }),
      data: { writeFeature: 'surveys', entityScopedSlug: true },
      parent: null,
    }) as unknown as ActivatedRouteSnapshot;

  const runGuard = async (route: ActivatedRouteSnapshot = meetingRoute()) => {
    // The guard returns `true` synchronously for the ED fast path, an Observable otherwise —
    // never a bare UrlTree (redirects are always wrapped in `of(...)`).
    const result = TestBed.runInInjectionContext(() => writerGuard(route, {} as RouterStateSnapshot));
    return typeof result === 'boolean' ? result : firstValueFrom(result as import('rxjs').Observable<boolean | UrlTree>);
  };

  beforeEach(() => {
    getMeetingDetail = vi.fn();
    getProjectStrict = vi.fn().mockReturnValue(of(null));
    getCommittee = vi.fn();
    fetchCommittee = vi.fn();
    fetchVote = vi.fn();
    getMailingList = vi.fn();
    getSurvey = vi.fn();
    currentPersona = signal('maintainer');
    router = {
      parseUrl: vi.fn().mockImplementation((url: string) => ({ redirect: url }) as unknown as UrlTree),
      createUrlTree: vi.fn().mockImplementation((commands: string[], opts: unknown) => ({ denied: commands[0], opts }) as unknown as UrlTree),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: PersonaService, useValue: { currentPersona } },
        { provide: ProjectContextService, useValue: { activeContext: () => ({ uid: 'stale-uid', slug: STALE_SLUG, name: 'Stale' }) } },
        { provide: ProjectService, useValue: { getProjectStrict } },
        { provide: CommitteeService, useValue: { getCommittee, fetchCommittee } },
        { provide: MailingListService, useValue: { getMailingList } },
        { provide: MeetingService, useValue: { getMeetingDetail } },
        { provide: SurveyService, useValue: { getSurvey } },
        { provide: VoteService, useValue: { fetchVote } },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('falls back to the active context only on a 404 meeting read', async () => {
    getMeetingDetail.mockReturnValue(throwError(() => httpError(404)));
    getProjectStrict.mockReturnValue(of({ uid: 'stale-uid', slug: STALE_SLUG, writer: true }));

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getProjectStrict).toHaveBeenCalledWith(STALE_SLUG, { meetingCoordinator: true });
  });

  it('redirects with an error notice on a persistent 500 meeting read, without probing the stale project', async () => {
    let probeSubscriptions = 0;
    getMeetingDetail.mockReturnValue(flakyError(500, () => probeSubscriptions++));

    const result = await runGuard();

    // One transient retry, then the explained redirect: still fail-closed with NO downstream
    // authorization probe, but the error notice distinguishes the blip from a real denial.
    expect(probeSubscriptions).toBe(2);
    expect(router.parseUrl).not.toHaveBeenCalled();
    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { _notice: 'error' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { _notice: 'error' } } });
    expect(getProjectStrict).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('redirects with an access-denied notice on a genuine 403 meeting read, without retrying', async () => {
    getMeetingDetail.mockReturnValue(throwError(() => httpError(403)));

    const result = await runGuard();

    // A 403 is a real denial, not a blip — no retry, and the notice is the denial copy.
    expect(getMeetingDetail).toHaveBeenCalledTimes(1);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { _notice: 'meetings' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { _notice: 'meetings' } } });
    expect(getProjectStrict).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('redirects with an error notice when the project fetch fails transiently', async () => {
    getMeetingDetail.mockReturnValue(of({ uid: MEETING_UID, project_uid: 'p-uid', project_slug: MEETING_SLUG } as unknown as Meeting));
    let fetchSubscriptions = 0;
    getProjectStrict.mockReturnValue(flakyError(500, () => fetchSubscriptions++));

    const result = await runGuard();

    expect(fetchSubscriptions).toBe(2);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { project: MEETING_SLUG, _notice: 'error' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: MEETING_SLUG, _notice: 'error' } } });
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('still admits a committee writer when the project fetch fails transiently', async () => {
    getMeetingDetail.mockReturnValue(
      of({ uid: MEETING_UID, project_uid: 'p-uid', project_slug: MEETING_SLUG, committee_uid: COMMITTEE_UID } as unknown as Meeting)
    );
    getProjectStrict.mockReturnValue(throwError(() => httpError(500)));
    getCommittee.mockReturnValue(of({ uid: COMMITTEE_UID, writer: true } as unknown as Committee));

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getCommittee).toHaveBeenCalledWith(COMMITTEE_UID);
  });

  it('redirects with an access-denied notice when the project fetch returns 403', async () => {
    getMeetingDetail.mockReturnValue(of({ uid: MEETING_UID, project_uid: 'p-uid', project_slug: MEETING_SLUG } as unknown as Meeting));
    getProjectStrict.mockReturnValue(throwError(() => httpError(403)));

    const result = await runGuard();

    expect(getProjectStrict).toHaveBeenCalledTimes(1);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { project: MEETING_SLUG, _notice: 'meetings' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: MEETING_SLUG, _notice: 'meetings' } } });
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('authorizes against the meeting’s own project when the read succeeds', async () => {
    getMeetingDetail.mockReturnValue(of({ uid: MEETING_UID, project_uid: 'p-uid', project_slug: MEETING_SLUG } as unknown as Meeting));
    getProjectStrict.mockReturnValue(of({ uid: 'p-uid', slug: MEETING_SLUG, writer: true }));

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getProjectStrict).toHaveBeenCalledWith(MEETING_SLUG, { meetingCoordinator: true });
  });

  it('resolves the uid when the payload lacks an enriched slug, never the stale context', async () => {
    getMeetingDetail.mockReturnValue(of({ uid: MEETING_UID, project_uid: 'p-uid', project_slug: null } as unknown as Meeting));
    getProjectStrict.mockReturnValue(of({ uid: 'p-uid', slug: MEETING_SLUG, writer: true }));

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getProjectStrict).toHaveBeenCalledWith('p-uid', { meetingCoordinator: true });
  });

  it('authorizes committee edit against the committee’s own project when the read succeeds', async () => {
    fetchCommittee.mockReturnValue(of({ uid: COMMITTEE_UID, project_uid: 'c-uid', project_slug: COMMITTEE_SLUG } as unknown as Committee));
    getProjectStrict.mockReturnValue(of({ uid: 'c-uid', slug: COMMITTEE_SLUG, writer: true }));

    const result = await runGuard(committeeRoute());

    expect(result).toBe(true);
    expect(fetchCommittee).toHaveBeenCalledWith(COMMITTEE_UID);
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProjectStrict).toHaveBeenCalledWith(COMMITTEE_SLUG, { meetingCoordinator: false });
  });

  it('resolves the committee uid when the payload lacks an enriched slug, never the stale context', async () => {
    fetchCommittee.mockReturnValue(of({ uid: COMMITTEE_UID, project_uid: 'c-uid', project_slug: null } as unknown as Committee));
    getProjectStrict.mockReturnValue(of({ uid: 'c-uid', slug: COMMITTEE_SLUG, writer: true }));

    const result = await runGuard(committeeRoute());

    expect(result).toBe(true);
    expect(getProjectStrict).toHaveBeenCalledWith('c-uid', { meetingCoordinator: false });
  });

  it('falls back to the active context only on a 404 committee read', async () => {
    fetchCommittee.mockReturnValue(throwError(() => httpError(404)));
    getProjectStrict.mockReturnValue(of({ uid: 'stale-uid', slug: STALE_SLUG, writer: true }));

    const result = await runGuard(committeeRoute());

    expect(result).toBe(true);
    expect(getProjectStrict).toHaveBeenCalledWith(STALE_SLUG, { meetingCoordinator: false });
  });

  it('redirects with an error notice on a persistent 500 committee read, without probing the stale project', async () => {
    let probeSubscriptions = 0;
    fetchCommittee.mockReturnValue(flakyError(500, () => probeSubscriptions++));

    const result = await runGuard(committeeRoute());

    expect(probeSubscriptions).toBe(2);
    expect(router.parseUrl).not.toHaveBeenCalled();
    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { _notice: 'error' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { _notice: 'error' } } });
    expect(getProjectStrict).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('authorizes vote edit against the vote’s own project when the read succeeds', async () => {
    fetchVote.mockReturnValue(of({ uid: VOTE_UID, project_uid: 'v-uid', project_slug: VOTE_SLUG } as unknown as Vote));
    getProjectStrict.mockReturnValue(of({ uid: 'v-uid', slug: VOTE_SLUG, writer: true }));

    const result = await runGuard(voteRoute());

    expect(result).toBe(true);
    expect(fetchVote).toHaveBeenCalledWith(VOTE_UID);
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProjectStrict).toHaveBeenCalledWith(VOTE_SLUG, { meetingCoordinator: false });
  });

  it('falls back to the active context only on a 404 vote read', async () => {
    fetchVote.mockReturnValue(throwError(() => httpError(404)));
    getProjectStrict.mockReturnValue(of({ uid: 'stale-uid', slug: STALE_SLUG, writer: true }));

    const result = await runGuard(voteRoute());

    expect(result).toBe(true);
    expect(getProjectStrict).toHaveBeenCalledWith(STALE_SLUG, { meetingCoordinator: false });
  });

  it('admits a committee writer via the vote’s own committee_uid when the URL omits it', async () => {
    fetchVote.mockReturnValue(of({ uid: VOTE_UID, project_uid: 'v-uid', project_slug: VOTE_SLUG, committee_uid: COMMITTEE_UID } as unknown as Vote));
    getProjectStrict.mockReturnValue(of({ uid: 'v-uid', slug: VOTE_SLUG, writer: false }));
    getCommittee.mockReturnValue(of({ uid: COMMITTEE_UID, writer: true } as unknown as Committee));

    const result = await runGuard(voteRoute());

    expect(result).toBe(true);
    expect(getCommittee).toHaveBeenCalledWith(COMMITTEE_UID);
  });

  it('authorizes against the vote’s own committee, not a URL committee_uid naming an unrelated one', async () => {
    fetchVote.mockReturnValue(of({ uid: VOTE_UID, project_uid: 'v-uid', project_slug: VOTE_SLUG, committee_uid: 'vote-committee' } as unknown as Vote));
    getProjectStrict.mockReturnValue(of({ uid: 'v-uid', slug: VOTE_SLUG, writer: false }));
    getCommittee.mockReturnValue(of({ uid: 'vote-committee', writer: false } as unknown as Committee));
    const route = {
      queryParamMap: convertToParamMap({ committee_uid: 'attacker-committee' }),
      paramMap: convertToParamMap({ id: VOTE_UID }),
      data: { writeFeature: 'votes', entityScopedSlug: true },
      parent: null,
    } as unknown as ActivatedRouteSnapshot;

    const result = await runGuard(route);

    expect(getCommittee).toHaveBeenCalledWith('vote-committee');
    expect(getCommittee).not.toHaveBeenCalledWith('attacker-committee');
    expect(result).not.toBe(true);
  });

  it('redirects with an error notice on a persistent 500 vote read, without probing the stale project', async () => {
    let probeSubscriptions = 0;
    fetchVote.mockReturnValue(flakyError(500, () => probeSubscriptions++));

    const result = await runGuard(voteRoute());

    expect(probeSubscriptions).toBe(2);
    expect(router.parseUrl).not.toHaveBeenCalled();
    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { _notice: 'error' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { _notice: 'error' } } });
    expect(getProjectStrict).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('redirects with an error notice when the committee fetch fails transiently', async () => {
    fetchVote.mockReturnValue(of({ uid: VOTE_UID, project_uid: 'v-uid', project_slug: VOTE_SLUG, committee_uid: COMMITTEE_UID } as unknown as Vote));
    getProjectStrict.mockReturnValue(of({ uid: 'v-uid', slug: VOTE_SLUG, writer: false }));
    let fetchSubscriptions = 0;
    getCommittee.mockReturnValue(flakyError(500, () => fetchSubscriptions++));

    const result = await runGuard(voteRoute());

    expect(fetchSubscriptions).toBe(2);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { project: VOTE_SLUG, _notice: 'error' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: VOTE_SLUG, _notice: 'error' } } });
  });

  it('redirects with an access-denied notice when the committee fetch returns 403', async () => {
    fetchVote.mockReturnValue(of({ uid: VOTE_UID, project_uid: 'v-uid', project_slug: VOTE_SLUG, committee_uid: COMMITTEE_UID } as unknown as Vote));
    getProjectStrict.mockReturnValue(of({ uid: 'v-uid', slug: VOTE_SLUG, writer: false }));
    getCommittee.mockReturnValue(throwError(() => httpError(403)));

    const result = await runGuard(voteRoute());

    expect(getCommittee).toHaveBeenCalledTimes(1);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { project: VOTE_SLUG, _notice: 'votes' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { project: VOTE_SLUG, _notice: 'votes' } } });
  });

  it('authorizes mailing-list edit against the list’s own project when the read succeeds', async () => {
    getMailingList.mockReturnValue(of({ uid: MAILING_LIST_UID, project_uid: 'ml-uid', project_slug: MAILING_LIST_SLUG } as unknown as GroupsIOMailingList));
    getProjectStrict.mockReturnValue(of({ uid: 'ml-uid', slug: MAILING_LIST_SLUG, writer: true }));

    const result = await runGuard(mailingListRoute());

    expect(result).toBe(true);
    expect(getMailingList).toHaveBeenCalledWith(MAILING_LIST_UID);
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProjectStrict).toHaveBeenCalledWith(MAILING_LIST_SLUG, { meetingCoordinator: false });
  });

  it('resolves the uid when the list payload carries the v1-sync empty-string slug, never the stale context', async () => {
    getMailingList.mockReturnValue(of({ uid: MAILING_LIST_UID, project_uid: 'ml-uid', project_slug: '' } as unknown as GroupsIOMailingList));
    getProjectStrict.mockReturnValue(of({ uid: 'ml-uid', slug: MAILING_LIST_SLUG, writer: true }));

    const result = await runGuard(mailingListRoute());

    expect(result).toBe(true);
    expect(getProjectStrict).toHaveBeenCalledWith('ml-uid', { meetingCoordinator: false });
  });

  it('falls back to the active context only on a 404 mailing-list read', async () => {
    getMailingList.mockReturnValue(throwError(() => httpError(404)));
    getProjectStrict.mockReturnValue(of({ uid: 'stale-uid', slug: STALE_SLUG, writer: true }));

    const result = await runGuard(mailingListRoute());

    expect(result).toBe(true);
    expect(getProjectStrict).toHaveBeenCalledWith(STALE_SLUG, { meetingCoordinator: false });
  });

  it('redirects with an error notice on a persistent 500 mailing-list read, without probing the stale project', async () => {
    let probeSubscriptions = 0;
    getMailingList.mockReturnValue(flakyError(500, () => probeSubscriptions++));

    const result = await runGuard(mailingListRoute());

    expect(probeSubscriptions).toBe(2);
    expect(router.parseUrl).not.toHaveBeenCalled();
    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { _notice: 'error' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { _notice: 'error' } } });
    expect(getProjectStrict).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('allows the executive-director persona synchronously with no HTTP calls', async () => {
    currentPersona.set('executive-director');

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProjectStrict).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('resolves the slug from the active context without probing the meeting for non-meetings features', async () => {
    getProjectStrict.mockReturnValue(of({ uid: 'stale-uid', slug: STALE_SLUG, writer: true }));

    const result = await runGuard(meetingRoute({ writeFeature: 'surveys' }));

    expect(result).toBe(true);
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProjectStrict).toHaveBeenCalledWith(STALE_SLUG, { meetingCoordinator: false });
  });

  it('fails closed when an entity-scoped route has no registered entity probe', async () => {
    // entityScopedSlug with no usable probe is a route misconfiguration — fail closed (redirect,
    // no downstream authorization probe) rather than fall back to the possibly stale context.
    const result = await runGuard(meetingRoute({ writeFeature: 'newsletters', entityScopedSlug: true }));

    expect(router.parseUrl).toHaveBeenCalledWith('/project/overview');
    expect(result).toEqual({ redirect: '/project/overview' });
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProjectStrict).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('authorizes survey edit against the survey’s own project when the read succeeds', async () => {
    getSurvey.mockReturnValue(of({ uid: SURVEY_UID, project_uid: 's-uid', project_slug: SURVEY_SLUG } as unknown as Survey));
    getProjectStrict.mockReturnValue(of({ uid: 's-uid', slug: SURVEY_SLUG, writer: true }));

    const result = await runGuard(surveyRoute());

    expect(result).toBe(true);
    expect(getSurvey).toHaveBeenCalledWith(SURVEY_UID);
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProjectStrict).toHaveBeenCalledWith(SURVEY_SLUG, { meetingCoordinator: false });
  });

  it('resolves the survey uid when the payload lacks an enriched slug, never the stale context', async () => {
    // Survey.project_uid is typed optional — the probe maps absent to '' and
    // resolveEntityWriteSlug treats '' as absent, so only a real uid reaches the lookup.
    getSurvey.mockReturnValue(of({ uid: SURVEY_UID, project_uid: 's-uid' } as unknown as Survey));
    getProjectStrict.mockReturnValue(of({ uid: 's-uid', slug: SURVEY_SLUG, writer: true }));

    const result = await runGuard(surveyRoute());

    expect(result).toBe(true);
    expect(getProjectStrict).toHaveBeenCalledWith('s-uid', { meetingCoordinator: false });
  });

  it('falls back to the active context only on a 404 survey read', async () => {
    getSurvey.mockReturnValue(throwError(() => httpError(404)));
    getProjectStrict.mockReturnValue(of({ uid: 'stale-uid', slug: STALE_SLUG, writer: true }));

    const result = await runGuard(surveyRoute());

    expect(result).toBe(true);
    expect(getProjectStrict).toHaveBeenCalledWith(STALE_SLUG, { meetingCoordinator: false });
  });

  it('redirects with an error notice on a persistent 500 survey read, without probing the stale project', async () => {
    let probeSubscriptions = 0;
    getSurvey.mockReturnValue(flakyError(500, () => probeSubscriptions++));

    const result = await runGuard(surveyRoute());

    expect(probeSubscriptions).toBe(2);
    expect(router.parseUrl).not.toHaveBeenCalled();
    expect(router.createUrlTree).toHaveBeenCalledWith(['/project/overview'], { queryParams: { _notice: 'error' } });
    expect(result).toEqual({ denied: '/project/overview', opts: { queryParams: { _notice: 'error' } } });
    expect(getProjectStrict).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('admits a committee writer via a URL committee_uid the survey’s own committees contain', async () => {
    getSurvey.mockReturnValue(
      of({
        uid: SURVEY_UID,
        project_uid: 's-uid',
        project_slug: SURVEY_SLUG,
        committees: [{ committee_uid: COMMITTEE_UID }, { committee_uid: 'other-committee' }],
      } as unknown as Survey)
    );
    getProjectStrict.mockReturnValue(of({ uid: 's-uid', slug: SURVEY_SLUG, writer: false }));
    getCommittee.mockReturnValue(of({ uid: COMMITTEE_UID, writer: true } as unknown as Committee));
    const route = {
      queryParamMap: convertToParamMap({ committee_uid: COMMITTEE_UID }),
      paramMap: convertToParamMap({ id: SURVEY_UID }),
      data: { writeFeature: 'surveys', entityScopedSlug: true },
      parent: null,
    } as unknown as ActivatedRouteSnapshot;

    const result = await runGuard(route);

    expect(result).toBe(true);
    expect(getCommittee).toHaveBeenCalledWith(COMMITTEE_UID);
  });

  it('authorizes against the survey’s primary committee, not a URL committee_uid naming an unrelated one', async () => {
    getSurvey.mockReturnValue(
      of({ uid: SURVEY_UID, project_uid: 's-uid', project_slug: SURVEY_SLUG, committees: [{ committee_uid: 'survey-committee' }] } as unknown as Survey)
    );
    getProjectStrict.mockReturnValue(of({ uid: 's-uid', slug: SURVEY_SLUG, writer: false }));
    getCommittee.mockReturnValue(of({ uid: 'survey-committee', writer: false } as unknown as Committee));
    const route = {
      queryParamMap: convertToParamMap({ committee_uid: 'attacker-committee' }),
      paramMap: convertToParamMap({ id: SURVEY_UID }),
      data: { writeFeature: 'surveys', entityScopedSlug: true },
      parent: null,
    } as unknown as ActivatedRouteSnapshot;

    const result = await runGuard(route);

    expect(getCommittee).toHaveBeenCalledWith('survey-committee');
    expect(getCommittee).not.toHaveBeenCalledWith('attacker-committee');
    expect(result).not.toBe(true);
  });

  it('authorizes against the survey’s primary committee when the URL omits committee_uid', async () => {
    getSurvey.mockReturnValue(
      of({ uid: SURVEY_UID, project_uid: 's-uid', project_slug: SURVEY_SLUG, committees: [{ committee_uid: 'survey-committee' }] } as unknown as Survey)
    );
    getProjectStrict.mockReturnValue(of({ uid: 's-uid', slug: SURVEY_SLUG, writer: false }));
    getCommittee.mockReturnValue(of({ uid: 'survey-committee', writer: true } as unknown as Committee));

    const result = await runGuard(surveyRoute());

    expect(result).toBe(true);
    expect(getCommittee).toHaveBeenCalledWith('survey-committee');
  });

  it('falls back to the URL committee_uid for a committee-less survey', async () => {
    // Pins the documented deliberate path: a committee-less project survey has no entity committee
    // to win, so the (attacker-controllable but backend-enforced) URL param is the only committee leg.
    getSurvey.mockReturnValue(of({ uid: SURVEY_UID, project_uid: 's-uid', project_slug: SURVEY_SLUG, committees: [] } as unknown as Survey));
    getProjectStrict.mockReturnValue(of({ uid: 's-uid', slug: SURVEY_SLUG, writer: false }));
    getCommittee.mockReturnValue(of({ uid: COMMITTEE_UID, writer: true } as unknown as Committee));
    const route = {
      queryParamMap: convertToParamMap({ committee_uid: COMMITTEE_UID }),
      paramMap: convertToParamMap({ id: SURVEY_UID }),
      data: { writeFeature: 'surveys', entityScopedSlug: true },
      parent: null,
    } as unknown as ActivatedRouteSnapshot;

    const result = await runGuard(route);

    expect(result).toBe(true);
    expect(getCommittee).toHaveBeenCalledWith(COMMITTEE_UID);
  });

  it('fails closed when an entity-scoped route has no :id param', async () => {
    const route = {
      queryParamMap: convertToParamMap({}),
      paramMap: convertToParamMap({}),
      data: { writeFeature: 'meetings', entityScopedSlug: true },
      parent: null,
    } as unknown as ActivatedRouteSnapshot;

    const result = await runGuard(route);

    expect(router.parseUrl).toHaveBeenCalledWith('/project/overview');
    expect(result).toEqual({ redirect: '/project/overview' });
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProjectStrict).not.toHaveBeenCalled();
  });
});
