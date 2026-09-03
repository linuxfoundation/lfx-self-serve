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
import { VoteService } from '@shared/services/vote.service';
import { Committee, GroupsIOMailingList, Meeting, Vote } from '@lfx-one/shared/interfaces';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writerGuard } from './writer.guard';

// Pins the fail-closed entity-scoped slug contract (GH-1579/GH-1566/GH-1567/GH-1568): only a 404 probe read
// falls back to the stale context — anything else resolves no slug. Also covers the ED fast path and non-entity-scoped features.
describe('writerGuard', () => {
  const MEETING_UID = 'meeting-uid-1';
  const MEETING_SLUG = 'meeting-project';
  const COMMITTEE_UID = 'committee-uid-1';
  const COMMITTEE_SLUG = 'committee-project';
  const VOTE_UID = 'vote-uid-1';
  const VOTE_SLUG = 'vote-project';
  const MAILING_LIST_UID = 'mailing-list-uid-1';
  const MAILING_LIST_SLUG = 'mailing-list-project';
  const STALE_SLUG = 'stale-project';

  let getMeetingDetail: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let getCommittee: ReturnType<typeof vi.fn>;
  let fetchCommittee: ReturnType<typeof vi.fn>;
  let fetchVote: ReturnType<typeof vi.fn>;
  let getMailingList: ReturnType<typeof vi.fn>;
  let router: { parseUrl: ReturnType<typeof vi.fn>; createUrlTree: ReturnType<typeof vi.fn> };
  let currentPersona: ReturnType<typeof signal<string>>;

  const httpError = (status: number) => new HttpErrorResponse({ status });

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

  const runGuard = async (route: ActivatedRouteSnapshot = meetingRoute()) => {
    // The guard returns `true` synchronously for the ED fast path, an Observable otherwise —
    // never a bare UrlTree (redirects are always wrapped in `of(...)`).
    const result = TestBed.runInInjectionContext(() => writerGuard(route, {} as RouterStateSnapshot));
    return typeof result === 'boolean' ? result : firstValueFrom(result as import('rxjs').Observable<boolean | UrlTree>);
  };

  beforeEach(() => {
    getMeetingDetail = vi.fn();
    getProject = vi.fn().mockReturnValue(of(null));
    getCommittee = vi.fn();
    fetchCommittee = vi.fn();
    fetchVote = vi.fn();
    getMailingList = vi.fn();
    currentPersona = signal('maintainer');
    router = {
      parseUrl: vi.fn().mockImplementation((url: string) => ({ redirect: url }) as unknown as UrlTree),
      createUrlTree: vi.fn().mockImplementation((commands: string[], opts: unknown) => ({ denied: commands[0], opts }) as unknown as UrlTree),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: PersonaService, useValue: { currentPersona } },
        { provide: ProjectContextService, useValue: { activeContext: () => ({ uid: 'stale-uid', slug: STALE_SLUG, name: 'Stale' }) } },
        { provide: ProjectService, useValue: { getProject } },
        { provide: CommitteeService, useValue: { getCommittee, fetchCommittee } },
        { provide: MailingListService, useValue: { getMailingList } },
        { provide: MeetingService, useValue: { getMeetingDetail } },
        { provide: VoteService, useValue: { fetchVote } },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('falls back to the active context only on a 404 meeting read', async () => {
    getMeetingDetail.mockReturnValue(throwError(() => httpError(404)));
    getProject.mockReturnValue(of({ uid: 'stale-uid', slug: STALE_SLUG, writer: true }));

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith(STALE_SLUG, false, { meetingCoordinator: true });
  });

  it('fails closed on a 500 meeting read without probing the stale project', async () => {
    getMeetingDetail.mockReturnValue(throwError(() => httpError(500)));

    const result = await runGuard();

    // The interaction is the contract: fail-closed means a redirect with NO downstream
    // authorization probe — not a specific UrlTree stub shape.
    expect(router.parseUrl).toHaveBeenCalledWith('/project/overview');
    expect(result).toEqual({ redirect: '/project/overview' });
    expect(getProject).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('authorizes against the meeting’s own project when the read succeeds', async () => {
    getMeetingDetail.mockReturnValue(of({ uid: MEETING_UID, project_uid: 'p-uid', project_slug: MEETING_SLUG } as unknown as Meeting));
    getProject.mockReturnValue(of({ uid: 'p-uid', slug: MEETING_SLUG, writer: true }));

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith(MEETING_SLUG, false, { meetingCoordinator: true });
  });

  it('resolves the uid when the payload lacks an enriched slug, never the stale context', async () => {
    getMeetingDetail.mockReturnValue(of({ uid: MEETING_UID, project_uid: 'p-uid', project_slug: null } as unknown as Meeting));
    getProject.mockReturnValue(of({ uid: 'p-uid', slug: MEETING_SLUG, writer: true }));

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith('p-uid', false, { meetingCoordinator: true });
  });

  it('authorizes committee edit against the committee’s own project when the read succeeds', async () => {
    fetchCommittee.mockReturnValue(of({ uid: COMMITTEE_UID, project_uid: 'c-uid', project_slug: COMMITTEE_SLUG } as unknown as Committee));
    getProject.mockReturnValue(of({ uid: 'c-uid', slug: COMMITTEE_SLUG, writer: true }));

    const result = await runGuard(committeeRoute());

    expect(result).toBe(true);
    expect(fetchCommittee).toHaveBeenCalledWith(COMMITTEE_UID);
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProject).toHaveBeenCalledWith(COMMITTEE_SLUG, false, { meetingCoordinator: false });
  });

  it('resolves the committee uid when the payload lacks an enriched slug, never the stale context', async () => {
    fetchCommittee.mockReturnValue(of({ uid: COMMITTEE_UID, project_uid: 'c-uid', project_slug: null } as unknown as Committee));
    getProject.mockReturnValue(of({ uid: 'c-uid', slug: COMMITTEE_SLUG, writer: true }));

    const result = await runGuard(committeeRoute());

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith('c-uid', false, { meetingCoordinator: false });
  });

  it('falls back to the active context only on a 404 committee read', async () => {
    fetchCommittee.mockReturnValue(throwError(() => httpError(404)));
    getProject.mockReturnValue(of({ uid: 'stale-uid', slug: STALE_SLUG, writer: true }));

    const result = await runGuard(committeeRoute());

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith(STALE_SLUG, false, { meetingCoordinator: false });
  });

  it('fails closed on a 500 committee read without probing the stale project', async () => {
    fetchCommittee.mockReturnValue(throwError(() => httpError(500)));

    const result = await runGuard(committeeRoute());

    expect(router.parseUrl).toHaveBeenCalledWith('/project/overview');
    expect(result).toEqual({ redirect: '/project/overview' });
    expect(getProject).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('authorizes vote edit against the vote’s own project when the read succeeds', async () => {
    fetchVote.mockReturnValue(of({ uid: VOTE_UID, project_uid: 'v-uid', project_slug: VOTE_SLUG } as unknown as Vote));
    getProject.mockReturnValue(of({ uid: 'v-uid', slug: VOTE_SLUG, writer: true }));

    const result = await runGuard(voteRoute());

    expect(result).toBe(true);
    expect(fetchVote).toHaveBeenCalledWith(VOTE_UID);
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProject).toHaveBeenCalledWith(VOTE_SLUG, false, { meetingCoordinator: false });
  });

  it('falls back to the active context only on a 404 vote read', async () => {
    fetchVote.mockReturnValue(throwError(() => httpError(404)));
    getProject.mockReturnValue(of({ uid: 'stale-uid', slug: STALE_SLUG, writer: true }));

    const result = await runGuard(voteRoute());

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith(STALE_SLUG, false, { meetingCoordinator: false });
  });

  it('admits a committee writer via the vote’s own committee_uid when the URL omits it', async () => {
    fetchVote.mockReturnValue(of({ uid: VOTE_UID, project_uid: 'v-uid', project_slug: VOTE_SLUG, committee_uid: COMMITTEE_UID } as unknown as Vote));
    getProject.mockReturnValue(of({ uid: 'v-uid', slug: VOTE_SLUG, writer: false }));
    getCommittee.mockReturnValue(of({ uid: COMMITTEE_UID, writer: true } as unknown as Committee));

    const result = await runGuard(voteRoute());

    expect(result).toBe(true);
    expect(getCommittee).toHaveBeenCalledWith(COMMITTEE_UID);
  });

  it('authorizes against the vote’s own committee, not a URL committee_uid naming an unrelated one', async () => {
    fetchVote.mockReturnValue(of({ uid: VOTE_UID, project_uid: 'v-uid', project_slug: VOTE_SLUG, committee_uid: 'vote-committee' } as unknown as Vote));
    getProject.mockReturnValue(of({ uid: 'v-uid', slug: VOTE_SLUG, writer: false }));
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

  it('fails closed on a 500 vote read without probing the stale project', async () => {
    fetchVote.mockReturnValue(throwError(() => httpError(500)));

    const result = await runGuard(voteRoute());

    expect(router.parseUrl).toHaveBeenCalledWith('/project/overview');
    expect(result).toEqual({ redirect: '/project/overview' });
    expect(getProject).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('authorizes mailing-list edit against the list’s own project when the read succeeds', async () => {
    getMailingList.mockReturnValue(of({ uid: MAILING_LIST_UID, project_uid: 'ml-uid', project_slug: MAILING_LIST_SLUG } as unknown as GroupsIOMailingList));
    getProject.mockReturnValue(of({ uid: 'ml-uid', slug: MAILING_LIST_SLUG, writer: true }));

    const result = await runGuard(mailingListRoute());

    expect(result).toBe(true);
    expect(getMailingList).toHaveBeenCalledWith(MAILING_LIST_UID);
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProject).toHaveBeenCalledWith(MAILING_LIST_SLUG, false, { meetingCoordinator: false });
  });

  it('resolves the uid when the list payload carries the v1-sync empty-string slug, never the stale context', async () => {
    getMailingList.mockReturnValue(of({ uid: MAILING_LIST_UID, project_uid: 'ml-uid', project_slug: '' } as unknown as GroupsIOMailingList));
    getProject.mockReturnValue(of({ uid: 'ml-uid', slug: MAILING_LIST_SLUG, writer: true }));

    const result = await runGuard(mailingListRoute());

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith('ml-uid', false, { meetingCoordinator: false });
  });

  it('falls back to the active context only on a 404 mailing-list read', async () => {
    getMailingList.mockReturnValue(throwError(() => httpError(404)));
    getProject.mockReturnValue(of({ uid: 'stale-uid', slug: STALE_SLUG, writer: true }));

    const result = await runGuard(mailingListRoute());

    expect(result).toBe(true);
    expect(getProject).toHaveBeenCalledWith(STALE_SLUG, false, { meetingCoordinator: false });
  });

  it('fails closed on a 500 mailing-list read without probing the stale project', async () => {
    getMailingList.mockReturnValue(throwError(() => httpError(500)));

    const result = await runGuard(mailingListRoute());

    expect(router.parseUrl).toHaveBeenCalledWith('/project/overview');
    expect(result).toEqual({ redirect: '/project/overview' });
    expect(getProject).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('allows the executive-director persona synchronously with no HTTP calls', async () => {
    currentPersona.set('executive-director');

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProject).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
  });

  it('resolves the slug from the active context without probing the meeting for non-meetings features', async () => {
    getProject.mockReturnValue(of({ uid: 'stale-uid', slug: STALE_SLUG, writer: true }));

    const result = await runGuard(meetingRoute({ writeFeature: 'surveys' }));

    expect(result).toBe(true);
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProject).toHaveBeenCalledWith(STALE_SLUG, false, { meetingCoordinator: false });
  });

  it('fails closed when an entity-scoped route has no registered entity probe', async () => {
    // entityScopedSlug with no usable probe is a route misconfiguration — fail closed (redirect,
    // no downstream authorization probe) rather than fall back to the possibly stale context.
    const result = await runGuard(meetingRoute({ writeFeature: 'newsletters', entityScopedSlug: true }));

    expect(router.parseUrl).toHaveBeenCalledWith('/project/overview');
    expect(result).toEqual({ redirect: '/project/overview' });
    expect(getMeetingDetail).not.toHaveBeenCalled();
    expect(getProject).not.toHaveBeenCalled();
    expect(getCommittee).not.toHaveBeenCalled();
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
    expect(getProject).not.toHaveBeenCalled();
  });
});
