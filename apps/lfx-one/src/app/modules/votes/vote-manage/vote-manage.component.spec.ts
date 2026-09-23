// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FormArray, FormGroup } from '@angular/forms';
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

import type { Confirmation } from 'primeng/api';
import type { ParamMap } from '@angular/router';
import type { Observable } from 'rxjs';

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
  let messageAdd: ReturnType<typeof vi.fn>;
  let voteServiceMock: {
    getVote: ReturnType<typeof vi.fn>;
    fetchVote: ReturnType<typeof vi.fn>;
    createVote: ReturnType<typeof vi.fn>;
    updateVote: ReturnType<typeof vi.fn>;
    enableVote: ReturnType<typeof vi.fn>;
    beginSpeculativeCreate: ReturnType<typeof vi.fn>;
    confirmSpeculativeVote: ReturnType<typeof vi.fn>;
    discardSpeculativeVote: ReturnType<typeof vi.fn>;
    markVoteOpened: ReturnType<typeof vi.fn>;
  };

  // Mutable route double — edit mode by default; create-mode tests call setRouteMode(null) before
  // createComponent (the component reads paramMap/snapshot at construction).
  const routeMock: {
    paramMap: Observable<ParamMap>;
    queryParamMap: Observable<ParamMap>;
    snapshot: { queryParamMap: ParamMap; paramMap: ParamMap };
  } = {
    paramMap: of(convertToParamMap({ id: VOTE_UID })),
    queryParamMap: of(convertToParamMap({})),
    snapshot: { queryParamMap: convertToParamMap({}), paramMap: convertToParamMap({ id: VOTE_UID }) },
  };
  const setRouteMode = (id: string | null) => {
    routeMock.paramMap = of(convertToParamMap(id === null ? {} : { id }));
    routeMock.snapshot.paramMap = convertToParamMap(id === null ? {} : { id });
  };

  // A real signal, not a stub function: create-mode write access runs toObservable(activeContext).
  const activeContext = signal<Record<string, unknown> | null>(null);

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
    messageAdd = vi.fn();
    // Committee leg grants write access by default so the eviction predicate stays quiet.
    fetchCommittee = vi.fn().mockReturnValue(of({ uid: COMMITTEE_UID, writer: true }));
    routerEvents$ = new BehaviorSubject<NavigationEnd>(new NavigationEnd(0, '/project/votes/x/edit', '/project/votes/x/edit'));
    setRouteMode(VOTE_UID);
    activeContext.set(null);
    voteServiceMock = {
      // initVote loads via getVote; the fallback re-fetches via fetchVote with skipCache —
      // both land on the same mock so call ordering stays inspectable.
      getVote: vi.fn().mockImplementation((id: string) => fetchVote(id)),
      fetchVote,
      createVote: vi.fn().mockReturnValue(of(unenrichedVote())),
      updateVote: vi.fn().mockReturnValue(of(unenrichedVote())),
      enableVote: vi.fn().mockReturnValue(of({ uid: VOTE_UID, status: 'active' })),
      beginSpeculativeCreate: vi.fn().mockReturnValue(of(unenrichedVote())),
      confirmSpeculativeVote: vi.fn().mockReturnValue(of({ vote: unenrichedVote(), opened: true })),
      discardSpeculativeVote: vi.fn(),
      markVoteOpened: vi.fn(),
    };

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
          useValue: routeMock,
        },
        {
          provide: VoteService,
          useValue: voteServiceMock,
        },
        { provide: ProjectService, useValue: { getProject, project: signal(null) } },
        {
          provide: ProjectContextService,
          useValue: {
            activeContext,
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
        { provide: MessageService, useValue: { add: messageAdd } },
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

  // GH-2826 Design A: dialog-open fires the speculative create, accept chains the enable, all dismiss
  // paths (Cancel/X/Esc → PrimeNG rejectEvent) discard. confirm()/close() are spied, not rendered.
  describe('speculative create flow (GH-2826)', () => {
    let capturedConfirmation: Confirmation | null;

    const fillValidForm = (component: VoteManageComponent) => {
      const form = component.form();
      form.get('title')?.setValue('Board decision 2026');
      form.get('committee')?.setValue({ uid: COMMITTEE_UID, name: 'Test Committee' });
      form.get('eligible_participants')?.setValue('project_members');
      form.get('close_date')?.setValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      const firstQuestion = (form.get('questions') as FormArray).at(0) as FormGroup;
      firstQuestion.get('question')?.setValue('Approve the 2026 budget?');
      (firstQuestion.get('options') as FormArray).at(0).setValue('Yes');
      (firstQuestion.get('options') as FormArray).at(1).setValue('No');
      form.updateValueAndValidity();
    };

    const submitFromValidForm = async () => {
      const fixture = await createComponent();
      fillValidForm(fixture.componentInstance);
      fixture.componentInstance.onSubmit();
      return fixture;
    };

    beforeEach(() => {
      setRouteMode(null); // create mode
      activeContext.set({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: 'Test Project' });
      getProject.mockReturnValue(of({ uid: PROJECT_UID, writer: true }));
      capturedConfirmation = null;
      const confirmationService = TestBed.inject(ConfirmationService);
      vi.spyOn(confirmationService, 'confirm').mockImplementation((confirmation) => {
        capturedConfirmation = confirmation;
        return confirmationService;
      });
    });

    it('opening the dialog fires the speculative create with the built request in the same tick', async () => {
      const fixture = await submitFromValidForm();

      expect(voteServiceMock.beginSpeculativeCreate).toHaveBeenCalledTimes(1);
      expect(voteServiceMock.beginSpeculativeCreate.mock.calls[0][0]).toMatchObject({
        name: 'Board decision 2026',
        project_uid: PROJECT_UID,
        committee_uid: COMMITTEE_UID,
      });
      expect(capturedConfirmation).not.toBeNull();
      expect(fixture.componentInstance.confirmingOpenVote()).toBe(true);
    });

    it('accept chains onto the speculation: success toast + navigate, and the service (not the component) marks the vote opened', async () => {
      const router = TestBed.inject(Router);
      const fixture = await submitFromValidForm();

      capturedConfirmation?.accept?.();

      expect(voteServiceMock.confirmSpeculativeVote).toHaveBeenCalledTimes(1);
      expect(voteServiceMock.confirmSpeculativeVote.mock.calls[0][0]).toMatchObject({ project_uid: PROJECT_UID });
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
      expect(router.navigate).toHaveBeenCalledWith(['/votes']);
      expect(fixture.componentInstance.submitting()).toBe(false);
      // markVoteOpened moved into the service's confirm chain (it must survive navigation).
      expect(voteServiceMock.markVoteOpened).not.toHaveBeenCalled();
      expect(voteServiceMock.discardSpeculativeVote).not.toHaveBeenCalled();
    });

    it('accept with opened: false warns and navigates — the draft residue is intentional, no delete', async () => {
      voteServiceMock.confirmSpeculativeVote.mockReturnValue(of({ vote: unenrichedVote(), opened: false }));
      const router = TestBed.inject(Router);
      await submitFromValidForm();

      capturedConfirmation?.accept?.();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
      expect(router.navigate).toHaveBeenCalledWith(['/votes']);
      expect(voteServiceMock.discardSpeculativeVote).not.toHaveBeenCalled();
    });

    it('accept surfaces a create failure as an error toast and stays on the form', async () => {
      voteServiceMock.confirmSpeculativeVote.mockReturnValue(throwError(() => new Error('upstream down')));
      const router = TestBed.inject(Router);
      const fixture = await submitFromValidForm();

      capturedConfirmation?.accept?.();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
      expect(router.navigate).not.toHaveBeenCalled();
      expect(fixture.componentInstance.submitting()).toBe(false);
    });

    it('reject discards the speculation instantly without confirming', async () => {
      const fixture = await submitFromValidForm();

      capturedConfirmation?.reject?.();

      expect(voteServiceMock.discardSpeculativeVote).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.confirmingOpenVote()).toBe(false);
      expect(voteServiceMock.confirmSpeculativeVote).not.toHaveBeenCalled();
      expect(messageAdd).not.toHaveBeenCalled();
    });

    it('destroying the component mid-dialog discards the pending speculation (in-app navigation)', async () => {
      const fixture = await submitFromValidForm();

      fixture.destroy();

      expect(voteServiceMock.discardSpeculativeVote).toHaveBeenCalled();
    });

    it('a deadline that expired during reading time discards the draft and shows the invalid-submit UX', async () => {
      const fixture = await submitFromValidForm();
      fixture.componentInstance
        .form()
        .get('close_date')
        ?.setValue(new Date(Date.now() - 24 * 60 * 60 * 1000));

      capturedConfirmation?.accept?.();

      expect(voteServiceMock.discardSpeculativeVote).toHaveBeenCalled();
      expect(voteServiceMock.confirmSpeculativeVote).not.toHaveBeenCalled();
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Deadline expired' }));
    });

    it('a speculative create failure while the dialog is open resets the guard, discards, closes, and surfaces the error', async () => {
      const pendingCreate$ = new Subject<Vote>();
      voteServiceMock.beginSpeculativeCreate.mockReturnValue(pendingCreate$.asObservable());
      const confirmationService = TestBed.inject(ConfirmationService);
      const closeSpy = vi.spyOn(confirmationService, 'close').mockImplementation(() => confirmationService);
      const fixture = await submitFromValidForm();
      expect(capturedConfirmation).not.toBeNull();

      pendingCreate$.error(new Error('create failed'));

      // ConfirmationService.close() emits no rejectEvent in PrimeNG 20.4.0 (the dialog hides
      // without running reject), so the error branch itself must run the reject path's cleanup:
      // guard flag reset so the organizer can retry, errored slot discarded, dialog hidden.
      expect(fixture.componentInstance.confirmingOpenVote()).toBe(false);
      expect(voteServiceMock.discardSpeculativeVote).toHaveBeenCalledTimes(1);
      expect(closeSpy).toHaveBeenCalled();
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });

    it('edit mode submits without any speculation — update then enable, component marks opened', async () => {
      setRouteMode(VOTE_UID); // back to edit mode for this test
      fetchVote.mockReturnValue(of(enrichedVote()));
      const router = TestBed.inject(Router);
      const fixture = await createComponent();
      fillValidForm(fixture.componentInstance);

      fixture.componentInstance.onSubmit();

      expect(voteServiceMock.beginSpeculativeCreate).not.toHaveBeenCalled();
      expect(voteServiceMock.confirmSpeculativeVote).not.toHaveBeenCalled();
      expect(capturedConfirmation).toBeNull(); // no confirmation dialog in edit mode
      expect(voteServiceMock.updateVote).toHaveBeenCalledWith(VOTE_UID, expect.objectContaining({ project_uid: PROJECT_UID }));
      expect(voteServiceMock.enableVote).toHaveBeenCalledWith(VOTE_UID);
      expect(voteServiceMock.markVoteOpened).toHaveBeenCalledWith(VOTE_UID);
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
      expect(router.navigate).toHaveBeenCalledWith(['/votes']);
    });
  });
});
