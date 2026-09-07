// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, NavigationEnd, Router } from '@angular/router';
import { Vote } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { VoteService } from '@services/vote.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteManageComponent } from './vote-manage.component';

// Regression coverage for the relation-gated-null → uncached-detail context fallback (GH-1568):
// when the by-uid project lookup is relation-gated into null for an organizer without a viewer
// relation, the vote detail is re-fetched uncached so its ungated enrichment can supply the
// project the lookup withheld. Also pins the resolved-context cache (a later NavigationEnd must
// re-apply the cached context — MainLayout's route-lens re-assert would clobber it otherwise —
// without a second uncached fetch) and the transient-error retry release.
describe('VoteManageComponent', () => {
  const VOTE_UID = 'vote-uid-1';
  const PROJECT_UID = 'project-uid-1';
  const PROJECT_SLUG = 'test-project';
  const COMMITTEE_UID = 'committee-uid-1';

  let fetchVote: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let fetchCommittee: ReturnType<typeof vi.fn>;
  let routerEvents$: BehaviorSubject<NavigationEnd>;
  let setProject: ReturnType<typeof vi.fn>;

  // Unenriched detail payload: project_uid only, no project_slug — the trigger condition for the
  // context fallback. The committee_uid keeps the write-access committee leg grantable so the
  // eviction predicate never fires mid-test.
  const unenrichedVote = () =>
    ({
      uid: VOTE_UID,
      project_uid: PROJECT_UID,
      committee_uid: COMMITTEE_UID,
    }) as unknown as Vote;

  const enrichedVote = () =>
    ({
      ...unenrichedVote(),
      project_slug: PROJECT_SLUG,
      project_name: 'Test Project',
      is_foundation: false,
    }) as unknown as Vote;

  const createComponent = async () => {
    const fixture = TestBed.createComponent(VoteManageComponent);
    // No fixture.detectChanges(): these tests exercise the constructor context-sync streams, not
    // the template, and rendering would pull in the full PrimeNG stepper subtree for no signal.
    await TestBed.inject(ApplicationRef).whenStable();
    return fixture;
  };

  const emitNavigationEnd = async () => {
    routerEvents$.next(new NavigationEnd(1, '/project/votes/x/edit?step=2', '/project/votes/x/edit?step=2'));
    await TestBed.inject(ApplicationRef).whenStable();
  };

  const skipCacheCalls = () => fetchVote.mock.calls.filter(([, opts]) => (opts as { skipCache?: boolean } | undefined)?.skipCache === true);

  beforeEach(() => {
    fetchVote = vi.fn();
    getProject = vi.fn();
    setProject = vi.fn();
    // Committee leg grants write access by default so the eviction predicate stays quiet.
    fetchCommittee = vi.fn().mockReturnValue(of({ uid: COMMITTEE_UID, writer: true }));
    routerEvents$ = new BehaviorSubject<NavigationEnd>(new NavigationEnd(0, '/project/votes/x/edit', '/project/votes/x/edit'));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            events: routerEvents$.asObservable(),
            url: '/project/votes/x/edit',
            parseUrl: vi.fn().mockReturnValue({ queryParams: {} }),
            serializeUrl: vi.fn().mockReturnValue('/project/votes/x/edit'),
            navigate: vi.fn(),
            navigateByUrl: vi.fn(),
            createUrlTree: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: VOTE_UID })),
            queryParamMap: of(convertToParamMap({})),
            snapshot: { queryParamMap: convertToParamMap({}), paramMap: convertToParamMap({ id: VOTE_UID }) },
          },
        },
        {
          provide: VoteService,
          useValue: {
            // initVote loads via getVote; the fallback re-fetches via fetchVote with skipCache —
            // both land on the same mock so call ordering stays inspectable.
            getVote: vi.fn().mockImplementation((id: string) => fetchVote(id)),
            fetchVote,
          },
        },
        { provide: ProjectService, useValue: { getProject, project: signal(null) } },
        {
          provide: ProjectContextService,
          useValue: {
            activeContext: () => null,
            activeContextUid: () => '',
            isFoundationContext: () => false,
            setProject,
            setFoundation: vi.fn(),
            setRouteLensKind: vi.fn(),
          },
        },
        {
          provide: CommitteeService,
          useValue: {
            getCommittee: vi.fn().mockReturnValue(of(null)),
            fetchCommittee,
          },
        },
        // Real ConfirmationService — the template's p-confirmdialog subscribes to its Subjects.
        ConfirmationService,
        // Transitive DI (LensService → PersonaService → HttpClient) — never called in these tests.
        { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of(null)), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
        // PrimeNG stepper binds @content.start animation listeners when the template is compiled —
        // required even without detectChanges(), since compilation alone wires the listener.
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
  });

  it('resolves context from a fresh uncached detail fetch when the uid lookup is relation-gated to null', async () => {
    fetchVote.mockImplementation((_uid: string, opts?: { skipCache?: boolean }) => (opts?.skipCache ? of(enrichedVote()) : of(unenrichedVote())));
    getProject.mockReturnValue(of(null));
    await createComponent();

    // The uid lookup returned null, so the fallback re-fetched the detail uncached and resolved
    // the context from its (ungated) enrichment.
    expect(fetchVote).toHaveBeenCalledWith(VOTE_UID, { skipCache: true });
    expect(setProject).toHaveBeenCalledWith({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG }, false);
  });

  it('re-applies the cached context on a later NavigationEnd without a second fresh fetch', async () => {
    fetchVote.mockImplementation((_uid: string, opts?: { skipCache?: boolean }) => (opts?.skipCache ? of(enrichedVote()) : of(unenrichedVote())));
    getProject.mockReturnValue(of(null));
    await createComponent();

    const callsBefore = fetchVote.mock.calls.length;
    await emitNavigationEnd();
    await emitNavigationEnd();

    // The fallback already resolved the context for this vote, so step navigations re-apply the
    // cached resolution without burning another uncached fetch.
    expect(skipCacheCalls()).toHaveLength(1);
    expect(fetchVote.mock.calls.length).toBe(callsBefore);
    expect(setProject).toHaveBeenCalledWith({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG }, false);
  });

  it('releases the retry marker when the fresh fetch fails transiently, so a later navigation can retry', async () => {
    let failFreshFetch = false;
    fetchVote.mockImplementation((_uid: string, opts?: { skipCache?: boolean }) => {
      if (!opts?.skipCache) {
        return of(unenrichedVote());
      }
      return failFreshFetch ? throwError(() => new Error('network')) : of(enrichedVote());
    });
    getProject.mockReturnValue(of(null));
    failFreshFetch = true;
    await createComponent();

    // Every fresh fetch so far failed transiently — context untouched, marker released each time.
    const failedAttempts = skipCacheCalls().length;
    expect(failedAttempts).toBeGreaterThan(0);
    expect(setProject).not.toHaveBeenCalled();

    // …so the next NavigationEnd re-apply attempts the fresh fetch again and now resolves.
    failFreshFetch = false;
    await emitNavigationEnd();
    expect(skipCacheCalls().length).toBeGreaterThan(failedAttempts);
    expect(setProject).toHaveBeenCalledWith({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG }, false);
  });

  it('short-circuits the committee leg when the project leg grants write access', async () => {
    // Pins the `if (project)` gate: a granted project leg must not fire the committee HTTP probe.
    fetchVote.mockReturnValue(of(unenrichedVote()));
    getProject.mockReturnValue(of({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG, writer: true }));
    await createComponent();

    expect(fetchCommittee).not.toHaveBeenCalled();
  });

  it('evicts to the overview when both write-access legs resolve false', async () => {
    // Pins the fail-closed transition into evictOnWriteAccessLoss: a null project lookup plus a
    // committee denial flips writeAccess from provisionally true to false. A plain Subject (not
    // of()) defers the committee denial past the provisional-true boot emission — synchronous
    // mocks resolve the whole chain in the first effect pass and skip(1) swallows the eviction.
    const committeeDecision$ = new Subject<{ uid: string; writer: boolean }>();
    fetchVote.mockReturnValue(of(enrichedVote()));
    getProject.mockReturnValue(of(null));
    fetchCommittee.mockReturnValue(committeeDecision$.asObservable());
    const router = TestBed.inject(Router);
    await createComponent();

    committeeDecision$.next({ uid: COMMITTEE_UID, writer: false });
    await TestBed.inject(ApplicationRef).whenStable();

    expect(router.navigateByUrl).toHaveBeenCalled();
    expect(router.parseUrl).toHaveBeenCalledWith(expect.stringMatching(/^\/(project|foundation)\/overview$/));
  });
});
