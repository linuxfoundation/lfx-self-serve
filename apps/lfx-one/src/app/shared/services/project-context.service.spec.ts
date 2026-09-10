// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Project, ProjectContext } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieRegistryService } from './cookie-registry.service';
import { FeatureFlagService } from './feature-flag.service';
import { LensService } from './lens.service';
import { PersonaService } from './persona.service';
import { ProjectContextService } from './project-context.service';
import { ProjectService } from './project.service';
import { UserService } from './user.service';

const CONTEXT: ProjectContext = { uid: 'proj-1', name: 'Project One', slug: 'project-one' };

/**
 * Minimal fixture; `stage` is what most assertions care about. `uid` defaults to the shared
 * `proj-1` but must be overridden with a fresh value in any test that also asserts on
 * `activeProjectAnnouncementDate`/`Loading`/`HasError` — `PermissionsService.getProjectSettings`
 * caches per uid (`shareReplay(1)`), so reusing `proj-1` would replay the *first* call this suite
 * ever made for that uid (in the outer `beforeEach`, against the default `{}` HTTP mock) instead of
 * hitting the test's own overridden mock.
 */
function project(stage: string, uid = 'proj-1'): Project {
  return {
    uid,
    slug: 'project-one',
    description: '',
    name: 'Project One',
    public: true,
    parent_uid: '',
    stage,
    category: '',
    funding_model: [],
    charter_url: '',
    legal_entity_type: '',
    legal_entity_name: '',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '',
    logo_url: '',
    repository_url: '',
    website_url: '',
    created_at: '',
    updated_at: '',
    mailing_list_count: 0,
  } as Project;
}

describe('ProjectContextService — Formation signals (GH-1955)', () => {
  let getProject: ReturnType<typeof vi.fn>;
  let userService: UserService;
  let service: ProjectContextService;

  beforeEach(() => {
    getProject = vi.fn().mockReturnValue(of(project('Active')));

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectService, useValue: { getProject, getProjectSfid: vi.fn().mockReturnValue(of(null)) } },
        { provide: SsrCookieService, useValue: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } },
        { provide: CookieRegistryService, useValue: { registerCookie: vi.fn(), unregisterCookie: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: PersonaService,
          useValue: { isMarketingAuditor: signal(false), isCampaignManager: signal(false), marketingGrantSlug: signal(null), currentPersona: signal(null) },
        },
        { provide: Router, useValue: { getCurrentNavigation: () => null, parseUrl: vi.fn(), serializeUrl: vi.fn(), url: '/' } },
        { provide: Location, useValue: { replaceState: vi.fn() } },
        { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of({})), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });

    userService = TestBed.inject(UserService);
    userService.authenticated.set(true);
    service = TestBed.inject(ProjectContextService);
    service.setRouteLensKind('project');
    // `syncUrl: false` — this suite only cares about the Formation signals, not URL sync.
    service.setProject(CONTEXT, false);
    TestBed.inject(ApplicationRef).tick();
  });

  it.each([
    ['Formation - Exploratory', 'Exploratory'],
    ['Formation - Engaged', 'Engaged'],
    ['Formation - On Hold', 'On Hold'],
    ['Formation - Disengaged', 'Disengaged'],
    ['Formation - Confidential', 'Confidential'],
    ['Draft', 'Draft'],
  ])('reports isActiveProjectInFormation=true and the %s sub-stage label for stage %s', (stage, expectedLabel) => {
    getProject.mockReturnValue(of(project(stage)));
    service.setProject({ ...CONTEXT, uid: `${CONTEXT.uid}-${stage}` }, false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.activeProjectFormationSubStage()).toBe(expectedLabel);
    expect(service.isActiveProjectInFormation()).toBe(true);
  });

  it.each(['Active', 'Archived', 'Prospect'])('reports isActiveProjectInFormation=false for stage %s', (stage) => {
    getProject.mockReturnValue(of(project(stage)));
    service.setProject({ ...CONTEXT, uid: `${CONTEXT.uid}-${stage}` }, false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.activeProjectFormationSubStage()).toBeNull();
    expect(service.isActiveProjectInFormation()).toBe(false);
  });

  it('reports isActiveProjectConfidential only for the Confidential stage', () => {
    getProject.mockReturnValue(of(project('Formation - Confidential')));
    service.setProject({ ...CONTEXT, uid: 'confidential-project' }, false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.isActiveProjectConfidential()).toBe(true);
    expect(service.activeProjectFormationSubStage()).toBe('Confidential');

    getProject.mockReturnValue(of(project('Formation - Engaged')));
    service.setProject({ ...CONTEXT, uid: 'engaged-project' }, false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.isActiveProjectConfidential()).toBe(false);
  });

  it('resolves the announcement date via PermissionsService, triggered by the active-project fetch', () => {
    const httpGet = TestBed.inject(HttpClient).get as ReturnType<typeof vi.fn>;
    httpGet.mockReturnValue(of({ announcement_date: '2026-09-01' }));
    getProject.mockReturnValue(of(project('Formation - Engaged', 'announce-project')));
    service.setProject({ ...CONTEXT, uid: 'announce-project' }, false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.activeProjectAnnouncementDate()).toBe('2026-09-01');
    expect(service.activeProjectAnnouncementDateLoading()).toBe(false);
    expect(service.activeProjectAnnouncementDateHasError()).toBe(false);
  });

  it('reports the announcement-date error state independently of the Formation signals', () => {
    const httpGet = TestBed.inject(HttpClient).get as ReturnType<typeof vi.fn>;
    httpGet.mockReturnValue(throwError(() => new Error('network error')));
    getProject.mockReturnValue(of(project('Formation - Engaged', 'error-project')));
    service.setProject({ ...CONTEXT, uid: 'error-project' }, false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.activeProjectAnnouncementDateHasError()).toBe(true);
    expect(service.activeProjectFormationSubStage()).toBe('Engaged');
  });

  it('stays false with no active project fetched when unauthenticated (LFXV2-3266 auth gate)', () => {
    userService.authenticated.set(false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.isActiveProjectInFormation()).toBe(false);
    expect(service.canWrite()).toBe(false);
  });

  it('derives canWrite from the same shared fetch as the Formation signals', () => {
    getProject.mockReturnValue(of({ ...project('Active'), writer: true }));
    service.setProject({ ...CONTEXT, uid: 'writer-project' }, false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.canWrite()).toBe(true);
  });

  it('never emits a transient null/false while a project switch is in flight — evictOnWriteAccessLoss (vote/survey/mailing-list manage pages) takes the first canWrite=false as a permanent access loss', () => {
    getProject.mockReturnValue(of({ ...project('Active'), writer: true }));
    service.setProject({ ...CONTEXT, uid: 'p1' }, false);
    TestBed.inject(ApplicationRef).tick();
    expect(service.canWrite()).toBe(true);

    const pending = new Subject<Project | null>();
    getProject.mockReturnValue(pending);
    service.setProject({ ...CONTEXT, uid: 'p2' }, false);
    TestBed.inject(ApplicationRef).tick();

    // Still p1's value while p2's fetch is in flight — no premature false/null flip.
    expect(service.activeProject()).not.toBeNull();
    expect(service.canWrite()).toBe(true);

    pending.next({ ...project('Active'), writer: false });
    TestBed.inject(ApplicationRef).tick();
    expect(service.canWrite()).toBe(false);
  });
});

/**
 * Covers the meeting-authoring gate every meeting surface reads. It is derived on the root singleton,
 * so it resolves on the SSR critical path of *every* page — which makes the number of requests it
 * costs part of the behavior, not just the answer it returns.
 */
describe('ProjectContextService — canWriteMeetings', () => {
  /** Cache keys the stub actually went out for — one entry per HTTP round trip. */
  let fetchedKeys: string[];

  const setup = (responses: { plain: Partial<Project> | null; coordinator?: Partial<Project> | null }, authenticated = true): ProjectContextService => {
    fetchedKeys = [];
    // Memoized per cache key, the way `ProjectService.getProject` is (`shareReplay` behind a
    // `${slug}:${current}[:mc]` map). Without that, two gates reading the same key would look like two
    // requests here and the round-trip assertions below would measure nothing real.
    const cache = new Map<string, Observable<Partial<Project> | null>>();
    const getProject = vi.fn((slug: string, current: boolean, options?: { meetingCoordinator?: boolean }) => {
      const key = `${slug}:${current}${options?.meetingCoordinator ? ':mc' : ''}`;
      if (!cache.has(key)) {
        fetchedKeys.push(key);
        cache.set(key, of(options?.meetingCoordinator ? (responses.coordinator ?? null) : responses.plain));
      }
      return cache.get(key)!;
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectService, useValue: { getProject, getProjectSfid: vi.fn().mockReturnValue(of(null)) } },
        { provide: SsrCookieService, useValue: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } },
        { provide: CookieRegistryService, useValue: { registerCookie: vi.fn(), unregisterCookie: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: PersonaService,
          useValue: { isMarketingAuditor: signal(false), isCampaignManager: signal(false), marketingGrantSlug: signal(null), currentPersona: signal(null) },
        },
        { provide: Router, useValue: { getCurrentNavigation: () => null, parseUrl: vi.fn(), serializeUrl: vi.fn(), url: '/' } },
        { provide: Location, useValue: { replaceState: vi.fn() } },
        { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of({})), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });

    // The gate hangs off `activeContext` *and* the session, so the default here is a resolved one —
    // an unauthenticated fixture would measure the gate's closed branch, not its answer. The two tests
    // at the bottom pass `false` deliberately to measure exactly that.
    TestBed.inject(UserService).authenticated.set(authenticated);

    const service = TestBed.inject(ProjectContextService);
    service.setRouteLensKind('project');
    // `syncUrl: false` — the URL sync is the Router's business and not what these assert.
    service.setProject(CONTEXT, false);
    TestBed.inject(ApplicationRef).tick();

    return service;
  };

  it('grants a project writer without asking for the coordinator role', () => {
    const service = setup({ plain: { writer: true } });

    expect(service.canWriteMeetings()).toBe(true);
    // The upstream skips the `meeting_coordinator` FGA check for writers anyway, so the `:mc` request
    // could only echo what this one already said — and it would land on every page.
    expect(fetchedKeys).toEqual([`${CONTEXT.slug}:false`]);
  });

  it('grants a non-writer who holds the coordinator role', () => {
    const service = setup({ plain: { writer: false }, coordinator: { writer: false, meetingCoordinator: true } });

    expect(service.canWriteMeetings()).toBe(true);
    expect(fetchedKeys).toEqual([`${CONTEXT.slug}:false`, `${CONTEXT.slug}:false:mc`]);
  });

  it('refuses a non-writer who holds neither role', () => {
    const service = setup({ plain: { writer: false }, coordinator: { writer: false, meetingCoordinator: false } });

    expect(service.canWriteMeetings()).toBe(false);
  });

  // The coordinator check returns `undefined` rather than `false` when the FGA call itself failed, so
  // "unknown" must not read as a grant.
  it('refuses when the coordinator check could not be resolved', () => {
    const service = setup({ plain: { writer: false }, coordinator: { writer: false } });

    expect(service.canWriteMeetings()).toBe(false);
  });

  it('refuses when the project could not be fetched at all', () => {
    const service = setup({ plain: null, coordinator: null });

    expect(service.canWriteMeetings()).toBe(false);
  });

  it('shares the plain fetch with the writer-only gate', () => {
    const service = setup({ plain: { writer: true } });

    expect(service.canWrite()).toBe(true);
    expect(service.canWriteMeetings()).toBe(true);
    // Both gates read the same cache key, which `projectQueryParamGuard` has already populated on
    // every navigation — so between them they add nothing.
    expect(fetchedKeys).toEqual([`${CONTEXT.slug}:false`]);
  });

  // `/api/projects/:slug` is session-authenticated, so with no session it answers 401 and the gate
  // lands on `false` through its `catchError` — after paying for the round trip on the SSR critical
  // path. The two sibling gates on this service already skip it for exactly that reason.
  it('asks for nothing while the session is unresolved', () => {
    const service = setup({ plain: { writer: true } }, false);

    expect(service.canWriteMeetings()).toBe(false);
    expect(fetchedKeys).toEqual([]);
  });

  // The half a `catchError` could never cover. Derived from the context alone, the gate resolved once
  // per navigation and never again — so a session that settled after the context left every meeting
  // surface reading a `false` computed before there was anyone to compute it for.
  it('re-resolves once the session lands, rather than staying closed', () => {
    const service = setup({ plain: { writer: true } }, false);
    expect(service.canWriteMeetings()).toBe(false);

    TestBed.inject(UserService).authenticated.set(true);
    TestBed.inject(ApplicationRef).tick();

    expect(service.canWriteMeetings()).toBe(true);
  });
});

/**
 * The reason the answer is published paired with the project it answers for, rather than left to be
 * recomposed against `activeContextUid()` at the point of use. A consumer watching for *lost* access
 * — the meeting composer, which closes itself on one — has to tell a revoked grant apart from the
 * context simply moving to another project, and can only do that if the uid and the verdict move
 * together.
 */
describe('ProjectContextService — meetingWriteAccess pairing', () => {
  const OTHER: ProjectContext = { uid: 'proj-2', name: 'Project Two', slug: 'project-two' };

  /**
   * One subject per probe, so each project's answer lands exactly when the test says it does.
   * `meetingWriteAccessFor` asks twice for a project the writer relation does not cover - once
   * plainly, then again with `meetingCoordinator` - and the two have to be answerable separately
   * or the second probe would silently inherit the first one's reply.
   */
  const answers = new Map<string, Subject<Partial<Project> | null>>();

  const answerFor = (slug: string, meetingCoordinator = false): Subject<Partial<Project> | null> => {
    const key = `${slug}:${meetingCoordinator}`;
    if (!answers.has(key)) {
      answers.set(key, new Subject<Partial<Project> | null>());
    }
    return answers.get(key)!;
  };

  const setup = (): ProjectContextService => {
    answers.clear();
    const getProject = vi.fn((slug: string, _current?: boolean, options?: { meetingCoordinator?: boolean }) =>
      answerFor(slug, options?.meetingCoordinator === true).asObservable()
    );

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectService, useValue: { getProject, getProjectSfid: vi.fn().mockReturnValue(of(null)) } },
        { provide: SsrCookieService, useValue: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } },
        { provide: CookieRegistryService, useValue: { registerCookie: vi.fn(), unregisterCookie: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: PersonaService,
          useValue: { isMarketingAuditor: signal(false), isCampaignManager: signal(false), marketingGrantSlug: signal(null), currentPersona: signal(null) },
        },
        { provide: Router, useValue: { getCurrentNavigation: () => null, parseUrl: vi.fn(), serializeUrl: vi.fn(), url: '/' } },
        { provide: Location, useValue: { replaceState: vi.fn() } },
        { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of({})), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });

    TestBed.inject(UserService).authenticated.set(true);
    const service = TestBed.inject(ProjectContextService);
    service.setRouteLensKind('project');
    return service;
  };

  it('never pairs a project uid with another project\u2019s answer', () => {
    const service = setup();

    // `toObservable` publishes from an effect, so the pipeline is not subscribed to the probe until
    // the first flush. Emitting before that tick would drop the answer on the floor.
    service.setProject(CONTEXT, false);
    TestBed.inject(ApplicationRef).tick();
    answerFor(CONTEXT.slug).next({ writer: true });
    TestBed.inject(ApplicationRef).tick();
    expect(service.meetingWriteAccess()).toEqual({ contextUid: CONTEXT.uid, canWrite: true });

    // Move the context. `activeContextUid()` follows immediately; the new project's answer is still
    // a round trip away. Composed from those two, this instant reads as "proj-2, and you may write
    // it" — an answer nobody gave — and the next instant as a revocation on proj-2.
    service.setProject(OTHER, false);
    TestBed.inject(ApplicationRef).tick();
    expect(service.activeContextUid()).toBe(OTHER.uid);
    expect(service.meetingWriteAccess()).toEqual({ contextUid: CONTEXT.uid, canWrite: true });

    // Not a writer, so the coordinator probe follows; both have to answer before the verdict lands.
    answerFor(OTHER.slug).next({ writer: false });
    TestBed.inject(ApplicationRef).tick();
    answerFor(OTHER.slug, true).next({ writer: false });
    TestBed.inject(ApplicationRef).tick();
    expect(service.meetingWriteAccess()).toEqual({ contextUid: OTHER.uid, canWrite: false });
  });
});
