// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { CommitteeService } from '@shared/services/committee.service';
import { MeetingService } from '@shared/services/meeting.service';
import { PersonaService } from '@shared/services/persona.service';
import { ProjectContextService } from '@shared/services/project-context.service';
import { ProjectService } from '@shared/services/project.service';
import { Committee, Meeting } from '@lfx-one/shared/interfaces';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writerGuard } from './writer.guard';

// Pins the fail-closed contract of the meeting edit slug resolution (GH-1579): only a 404
// on the meeting read may fall back to the stale active context — every other failure must
// resolve no slug at all so the guard redirects instead of authorizing against an unrelated
// project. A future broadened catch would silently restore the cross-project authorization bug.
// The committee edit route (GH-1566) shares the same entity-scoped resolution through
// fetchCommittee, so its cases pin the identical contract for the committees branch.
// Also covers the non-meetings early-returns (ED fast path, non-entity-scoped features) so the
// file isn't a false sense of coverage for the guard's default flow.
describe('writerGuard', () => {
  const MEETING_UID = 'meeting-uid-1';
  const MEETING_SLUG = 'meeting-project';
  const COMMITTEE_UID = 'committee-uid-1';
  const COMMITTEE_SLUG = 'committee-project';
  const STALE_SLUG = 'stale-project';

  let getMeetingDetail: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let getCommittee: ReturnType<typeof vi.fn>;
  let fetchCommittee: ReturnType<typeof vi.fn>;
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
        { provide: MeetingService, useValue: { getMeetingDetail } },
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
