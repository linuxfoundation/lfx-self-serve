// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FormArray, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, NavigationEnd, Router } from '@angular/router';
import { CommitteeMemberVotingStatus, PollStatus, PollType } from '@lfx-one/shared/enums';
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
  let getCommittee: ReturnType<typeof vi.fn>;
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
    getCommittee = vi.fn().mockReturnValue(of(null));
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
            getCommittee,
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

  // GH-3660: cloning opens the create form prefilled from a source vote, via ?clone=<uid>.
  describe('clone flow (?clone=<uid>)', () => {
    const CLONE_SOURCE_UID = 'vote-uid-source';

    const sourceVote = (overrides: Partial<Vote> = {}): Vote => ({
      uid: CLONE_SOURCE_UID,
      name: 'Original board election',
      status: PollStatus.ACTIVE,
      project_uid: PROJECT_UID,
      end_time: '2099-01-01T00:00:00Z',
      ...overrides,
    });

    beforeEach(() => {
      setRouteMode(null); // create mode — clone only applies without an :id route param
      routeMock.queryParamMap = of(convertToParamMap({ clone: CLONE_SOURCE_UID }));
      // cloneSourceVote feeds syncEntityProjectContextFallback, which calls getProject(...).pipe(...)
      // once the clone fetch resolves — give it an Observable default so fixtures that don't care
      // about project-access resolution don't throw on the outer beforeEach's bare vi.fn(). The
      // project-access test below overrides this with its own resolved value.
      getProject.mockReturnValue(of(null));
    });

    it('prefills the create form with the source vote, prefixing the title, and stays in create mode, without creating a vote', async () => {
      fetchVote.mockReturnValue(
        of(
          sourceVote({
            committee_uid: COMMITTEE_UID,
            committee_filters: [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP],
            poll_questions: [
              {
                question_id: 'q1',
                prompt: 'Who should join?',
                type: 'single_choice',
                choices: [
                  { choice_id: 'c1', choice_text: 'Alice' },
                  { choice_id: 'c2', choice_text: 'Bob' },
                ],
              },
            ],
            poll_comment_prompts: [{ prompt_id: 'p1', prompt: 'Any concerns?' }],
          })
        )
      );
      const fixture = await createComponent();

      // Uses the tap-free fetch — getVote's signal write would leak the source vote into shared vote-detail state.
      expect(voteServiceMock.fetchVote).toHaveBeenCalledWith(CLONE_SOURCE_UID);
      expect(voteServiceMock.getVote).not.toHaveBeenCalled();
      expect(fixture.componentInstance.mode()).toBe('create');

      const form = fixture.componentInstance.form();
      expect(form.get('title')?.value).toBe('Copy of Original board election');
      expect(form.get('committee')?.value).toEqual({ uid: COMMITTEE_UID, name: undefined });
      expect(form.get('eligible_participants')?.value).toBe('voting_rep,alternate_voting_rep');
      expect((form.get('questions') as FormArray).length).toBe(1);
      expect((form.get('questions') as FormArray).at(0).get('question')?.value).toBe('Who should join?');
      expect((form.get('commentPrompts') as FormArray).length).toBe(1);
      expect((form.get('commentPrompts') as FormArray).at(0).get('prompt')?.value).toBe('Any concerns?');
      expect(voteServiceMock.createVote).not.toHaveBeenCalled();
    });

    it('does not fetch a clone source when an :id route param is present (edit mode)', async () => {
      setRouteMode(VOTE_UID);
      fetchVote.mockReturnValue(of(enrichedVote()));
      await createComponent();

      expect(voteServiceMock.fetchVote).not.toHaveBeenCalledWith(CLONE_SOURCE_UID);
    });

    it('surfaces an error and leaves the form blank when the clone source fails to load', async () => {
      fetchVote.mockReturnValue(throwError(() => new Error('not found')));
      const fixture = await createComponent();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
      expect(fixture.componentInstance.form().get('title')?.value).toBe('');
    });

    it('leaves the clone prefill in control when both ?clone and ?committee_uid are present (committee_uid is ignored)', async () => {
      routeMock.queryParamMap = of(convertToParamMap({ clone: CLONE_SOURCE_UID, committee_uid: 'other-committee-uid' }));
      fetchVote.mockReturnValue(of(sourceVote({ committee_uid: COMMITTEE_UID })));
      // initCommitteeContext (the ?committee_uid lock) reads via getCommittee — assert it's never
      // called and that committeeContext (the signal that actually gates the locked committee card)
      // stays null, not just that the form control carries the clone's own value.
      getCommittee.mockReturnValue(of({ uid: 'other-committee-uid', name: 'Other Committee' }));
      const fixture = await createComponent();

      expect(getCommittee).not.toHaveBeenCalled();
      expect(fixture.componentInstance.committeeContext()).toBeNull();
      const committeeControl = fixture.componentInstance.form().get('committee');
      expect(committeeControl?.value).toEqual({ uid: COMMITTEE_UID, name: undefined });
      expect(committeeControl?.disabled).toBe(false);
    });

    // GH-3781 review (PRRT_kwDOPMiRQ86t4nFQ): a clone's own project_uid is untrusted until the entity-
    // context sync has actually retargeted activeContext to match it — writeAccess in create mode follows
    // activeContext, so submitting straight off cloneSourceVote().project_uid could land in a project
    // writeAccess never admitted. Once sync has converged (activeContext === the clone's project), both
    // signals agree and submission proceeds normally.
    it("submits using the cloned source vote's own project_uid once the active context has synced to it", async () => {
      const SOURCE_PROJECT_UID = 'source-project-uid';
      // Simulates syncEntityProjectContextFallback already having retargeted activeContext to the
      // clone's project (the converged, authorized state) before the organizer finishes the form.
      activeContext.set({ uid: SOURCE_PROJECT_UID, slug: 'source-project', name: 'Source Project' });
      getProject.mockReturnValue(of({ uid: SOURCE_PROJECT_UID, writer: true }));
      fetchVote.mockReturnValue(of(sourceVote({ project_uid: SOURCE_PROJECT_UID, committee_uid: COMMITTEE_UID })));
      const fixture = await createComponent();

      const form = fixture.componentInstance.form();
      form.get('eligible_participants')?.setValue('project_members');
      form.get('close_date')?.setValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      const firstQuestion = (form.get('questions') as FormArray).at(0) as FormGroup;
      firstQuestion.get('question')?.setValue('Approve the budget?');
      (firstQuestion.get('options') as FormArray).at(0).setValue('Yes');
      (firstQuestion.get('options') as FormArray).at(1).setValue('No');
      form.updateValueAndValidity();

      fixture.componentInstance.onSubmit();

      expect(voteServiceMock.beginSpeculativeCreate).toHaveBeenCalledTimes(1);
      expect(voteServiceMock.beginSpeculativeCreate.mock.calls[0][0]).toMatchObject({ project_uid: SOURCE_PROJECT_UID });
    });

    // GH-3781 review (PRRT_kwDOPMiRQ86t4nFQ): fail closed rather than silently trusting the clone's own
    // project over the one writeAccess actually authorized — e.g. the clone's project_slug is missing so
    // entity-context sync never retargeted activeContext. Submitting with cloneSourceVote's project here
    // would bypass the write-access check entirely, since the voting service doesn't re-authorize project_uid.
    it('blocks submission instead of trusting an unsynced clone project that diverges from the active context', async () => {
      const SOURCE_PROJECT_UID = 'source-project-uid';
      activeContext.set({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: 'Viewer Active Project' });
      getProject.mockReturnValue(of({ uid: PROJECT_UID, writer: true }));
      fetchVote.mockReturnValue(of(sourceVote({ project_uid: SOURCE_PROJECT_UID, committee_uid: COMMITTEE_UID })));
      const fixture = await createComponent();

      let capturedConfirmation: Confirmation | null = null;
      const confirmationService = TestBed.inject(ConfirmationService);
      vi.spyOn(confirmationService, 'confirm').mockImplementation((confirmation: Confirmation) => {
        capturedConfirmation = confirmation;
        return confirmationService;
      });

      const form = fixture.componentInstance.form();
      form.get('eligible_participants')?.setValue('project_members');
      form.get('close_date')?.setValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      const firstQuestion = (form.get('questions') as FormArray).at(0) as FormGroup;
      firstQuestion.get('question')?.setValue('Approve the budget?');
      (firstQuestion.get('options') as FormArray).at(0).setValue('Yes');
      (firstQuestion.get('options') as FormArray).at(1).setValue('No');
      form.updateValueAndValidity();

      // projectUid resolves to null at dialog-open too (same divergence), so no speculative create fires.
      fixture.componentInstance.onSubmit();
      expect(voteServiceMock.beginSpeculativeCreate).not.toHaveBeenCalled();

      // Accepting the dialog still routes through submitVote()'s own resolution — surface the error there.
      (capturedConfirmation as Confirmation | null)?.accept?.();

      expect(voteServiceMock.createVote).not.toHaveBeenCalled();
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'No project selected' }));
    });

    // GH-3781 review (PRRT_kwDOPMiRQ86tkpJN): the clone fetch disables the form while in flight
    // (initCloneFromQuery's `this.form().disable()` / `.enable()` pair) so a slow fetch can't let
    // the organizer type into a form about to be overwritten by the prefill. This is the only test
    // in this file that drives `fetchVote` through a deferred `Subject` to actually observe that
    // disable/enable pair mid-flight; deleting the pair would turn it red.
    it('disables the form while the clone source is in flight and re-enables it once prefilled', async () => {
      const clone$ = new Subject<Vote>();
      fetchVote.mockReturnValue(clone$.asObservable());
      const fixture = await createComponent();

      expect(fixture.componentInstance.form().disabled).toBe(true);

      clone$.next(sourceVote({ committee_uid: COMMITTEE_UID }));
      clone$.complete();
      await TestBed.inject(ApplicationRef).whenStable();

      expect(fixture.componentInstance.form().disabled).toBe(false);
    });

    // GH-3781 review (PRRT_kwDOPMiRQ86tqj1g): the rail's Create Vote dialog navigates within this
    // same `create` route (e.g. ?project=A&clone=X -> ?project=B) without a full reload, and
    // Angular's default RouteReuseStrategy reuses this component instance rather than reconstructing
    // it. A one-shot (`take(1)`) clone read would leave cloneSourceVote — and every submission path's
    // project-uid resolution — pinned to project A's clone forever. Pins the reactive fix: removing
    // ?clone on a reused instance clears the stale source and form, so submission uses the current
    // project instead of the old clone's.
    it('clears the stale clone source and form state when the component is reused for a project with no ?clone', async () => {
      const queryParams$ = new Subject<ParamMap>();
      routeMock.queryParamMap = queryParams$.asObservable();
      fetchVote.mockReturnValue(of(sourceVote({ committee_uid: COMMITTEE_UID })));
      const fixture = await createComponent();

      queryParams$.next(convertToParamMap({ clone: CLONE_SOURCE_UID }));
      await TestBed.inject(ApplicationRef).whenStable();
      expect(fixture.componentInstance.form().get('title')?.value).toBe('Copy of Original board election');

      // Reused for project B's create flow — the dialog dropped ?clone entirely.
      const PROJECT_B_UID = 'project-uid-b';
      activeContext.set({ uid: PROJECT_B_UID, slug: 'project-b', name: 'Project B' });
      getProject.mockReturnValue(of({ uid: PROJECT_B_UID, writer: true }));
      queryParams$.next(convertToParamMap({}));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(fixture.componentInstance.form().get('title')?.value).toBe('');

      const form = fixture.componentInstance.form();
      form.get('title')?.setValue('A brand new vote for project B');
      form.get('committee')?.setValue({ uid: COMMITTEE_UID, name: undefined });
      form.get('eligible_participants')?.setValue('project_members');
      form.get('close_date')?.setValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      const firstQuestion = (form.get('questions') as FormArray).at(0) as FormGroup;
      firstQuestion.get('question')?.setValue('Approve the budget?');
      (firstQuestion.get('options') as FormArray).at(0).setValue('Yes');
      (firstQuestion.get('options') as FormArray).at(1).setValue('No');
      form.updateValueAndValidity();

      fixture.componentInstance.onSubmit();

      expect(voteServiceMock.beginSpeculativeCreate.mock.calls[0][0]).toMatchObject({ project_uid: PROJECT_B_UID });
    });

    // GH-3781 review (PRRT_kwDOPMiRQ86tqxLp / tqxLw / tqx6M / tqyZn, 4 bots): clearing ?clone replaced
    // the FormGroup via form.set(...), but `formValue` was a one-time toSignal pinned to the discarded
    // group's valueChanges, so canGoNext/isDraftSavable never saw edits to the replacement form, and
    // `internalStep` was never reset — an organizer who had advanced past Basics on the clone stayed
    // stranded on that step with a blank form. Drives Step 1 through nextStep() (not onSubmit()
    // directly) so a regression that only breaks Next, not submit, would still fail this test.
    it('keeps Next reactive and resets the step when the component is reused for a project with no ?clone', async () => {
      const queryParams$ = new Subject<ParamMap>();
      routeMock.queryParamMap = queryParams$.asObservable();
      fetchVote.mockReturnValue(of(sourceVote({ committee_uid: COMMITTEE_UID, committee_filters: [CommitteeMemberVotingStatus.VOTING_REP] })));
      const fixture = await createComponent();

      queryParams$.next(convertToParamMap({ clone: CLONE_SOURCE_UID }));
      await TestBed.inject(ApplicationRef).whenStable();
      // Finish Step 1 on the clone (the prefill alone doesn't guarantee every validator passes) and advance.
      const cloneForm = fixture.componentInstance.form();
      cloneForm.get('close_date')?.setValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      cloneForm.get('close_time')?.setValue('11:59 PM');
      cloneForm.updateValueAndValidity();
      await TestBed.inject(ApplicationRef).whenStable();
      fixture.componentInstance.nextStep();
      await TestBed.inject(ApplicationRef).whenStable();
      expect(fixture.componentInstance.currentStep()).toBe(2);

      // Reused for project B's create flow — the dialog dropped ?clone entirely.
      const PROJECT_B_UID = 'project-uid-b';
      activeContext.set({ uid: PROJECT_B_UID, slug: 'project-b', name: 'Project B' });
      getProject.mockReturnValue(of({ uid: PROJECT_B_UID, writer: true }));
      queryParams$.next(convertToParamMap({}));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(fixture.componentInstance.currentStep()).toBe(1);
      expect(fixture.componentInstance.canGoNext()).toBe(false);

      const form = fixture.componentInstance.form();
      form.get('title')?.setValue('A brand new vote for project B');
      form.get('committee')?.setValue({ uid: COMMITTEE_UID, name: undefined });
      form.get('eligible_participants')?.setValue('project_members');
      form.get('close_date')?.setValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      form.updateValueAndValidity();
      await TestBed.inject(ApplicationRef).whenStable();

      expect(fixture.componentInstance.canGoNext()).toBe(true);

      fixture.componentInstance.nextStep();
      await TestBed.inject(ApplicationRef).whenStable();

      expect(fixture.componentInstance.currentStep()).toBe(2);
    });

    // GH-3781 review (PRRT_kwDOPMiRQ86tt0g5, copilot): switching ?clone=X -> ?clone=Y on a reused
    // component didn't clear X's form/cloneSourceVote before fetching Y. If Y fails to load (this test)
    // or is rejected as unsupported, the callback just re-enabled X's form, leaving the stale clone's
    // data in place under a URL that now names Y. Pins the fix: the switch clears state up front, so a
    // failed replacement leaves a blank form instead of X's.
    it('clears the previous clone source instead of re-enabling it when switching to a replacement clone that fails to load', async () => {
      const queryParams$ = new Subject<ParamMap>();
      routeMock.queryParamMap = queryParams$.asObservable();
      fetchVote.mockReturnValue(of(sourceVote({ committee_uid: COMMITTEE_UID })));
      const fixture = await createComponent();

      queryParams$.next(convertToParamMap({ clone: CLONE_SOURCE_UID }));
      await TestBed.inject(ApplicationRef).whenStable();
      expect(fixture.componentInstance.form().get('title')?.value).toBe('Copy of Original board election');

      const REPLACEMENT_CLONE_UID = 'vote-uid-replacement';
      fetchVote.mockReturnValue(throwError(() => new Error('not found')));
      queryParams$.next(convertToParamMap({ clone: REPLACEMENT_CLONE_UID }));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(fixture.componentInstance.form().get('title')?.value).toBe('');
      expect(fixture.componentInstance.form().disabled).toBe(false);
      expect(fixture.componentInstance.currentStep()).toBe(1);
    });

    // GH-3781 review (PRRT_kwDOPMiRQ86t1wKG, copilot): clone X, use the rail to start a regular vote
    // (cloneSourceVote goes null, but the form/step keep advancing normally), then browser-Back into
    // ?clone=X. The removal branch only resets on exit when cloneSourceVote() was truthy, and the old
    // entry branch mirrored that same guard — so entering a clone while cloneSourceVote() is already
    // null left the regular vote's valid, step-2 form sitting enabled while X's slow/failing fetch was
    // in flight, letting onSubmit() fire with the stale payload. Pins the fix: entering a clone resets
    // unconditionally, regardless of whether a clone was previously active.
    it('clears a regular-create form in progress when navigating back into a clone', async () => {
      const queryParams$ = new Subject<ParamMap>();
      routeMock.queryParamMap = queryParams$.asObservable();
      const fixture = await createComponent();

      // Regular create flow (no ?clone=): advance past Step 1 with a valid, in-progress form.
      queryParams$.next(convertToParamMap({}));
      await TestBed.inject(ApplicationRef).whenStable();
      const form = fixture.componentInstance.form();
      form.get('title')?.setValue('A regular vote in progress');
      form.get('committee')?.setValue({ uid: COMMITTEE_UID, name: undefined });
      form.get('eligible_participants')?.setValue('project_members');
      form.get('close_date')?.setValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      form.updateValueAndValidity();
      await TestBed.inject(ApplicationRef).whenStable();
      fixture.componentInstance.nextStep();
      await TestBed.inject(ApplicationRef).whenStable();
      expect(fixture.componentInstance.currentStep()).toBe(2);

      // Browser Back into ?clone=X — fetch is slow/pending.
      const clone$ = new Subject<ReturnType<typeof sourceVote>>();
      fetchVote.mockReturnValue(clone$.asObservable());
      queryParams$.next(convertToParamMap({ clone: CLONE_SOURCE_UID }));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(fixture.componentInstance.form().get('title')?.value).toBe('');
      expect(fixture.componentInstance.form().disabled).toBe(true);
      expect(fixture.componentInstance.currentStep()).toBe(1);
    });

    // GH-3781 review (PRRT_kwDOPMiRQ86uAPFS, dealako): the poll-type/pseudo-anonymity guard is the
    // only thing standing between a ranked-choice/anonymous election and a silent plurality
    // re-creation — pin it so a refactor of this subscribe can't silently drop it.
    it.each([
      ['a non-generic poll type', sourceVote({ poll_type: PollType.CONDORCET_IRV })],
      ['a pseudo-anonymous source', sourceVote({ pseudo_anonymity: true })],
    ])('refuses to clone %s: warns and leaves the form blank and enabled', async (_label, unsupportedSource) => {
      fetchVote.mockReturnValue(of(unsupportedSource));
      const fixture = await createComponent();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Cannot clone' }));
      expect(fixture.componentInstance.form().get('title')?.value).toBe('');
      expect(fixture.componentInstance.form().disabled).toBe(false);
    });
  });

  // GH-3781 review (PRRT_kwDOPMiRQ86tkpJN, PRRT_kwDOPMiRQ86uAPFN dealako): pins the project leg's
  // `startWith(undefined)` fix against the specific race it guards — not just "no eviction while
  // switching" (true either way, since a stale *true* can never itself cause a wrongful eviction),
  // but the case the inline comment calls out: project A resolves to a definite `false` while the
  // committee leg is still pending (so overall access correctly stays provisional-true); a context
  // switch to project B then leaves B's own fetch pending too. Without the `startWith(undefined)`,
  // the project leg would keep exposing A's stale resolved `false` through the switch, and once the
  // committee leg's pending fetch resolves to `false` in that window, the stale `false` + the now-
  // resolved `false` would combine into an outright `false` — evicting an organizer who IS a writer
  // on B, before B's own fetch has had any chance to resolve `true`.
  it('does not evict on a stale denied leg while a project-context switch leaves the new key pending', async () => {
    const PROJECT_B_UID = 'project-uid-b';
    const PROJECT_B_SLUG = 'project-b';
    setRouteMode(null); // create mode — projectKey$ is driven directly off activeContext
    routeMock.queryParamMap = of(convertToParamMap({ committee_uid: COMMITTEE_UID })); // project leg alone resolving false must route through the committee leg
    activeContext.set({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: 'Project A' });
    const projectBFetch$ = new Subject<{ uid: string; writer: boolean }>();
    const committeeFetch$ = new Subject<{ uid: string; writer: boolean }>();
    getProject.mockImplementation((key: string) => (key === PROJECT_SLUG ? of({ uid: PROJECT_UID, writer: false }) : projectBFetch$.asObservable()));
    fetchCommittee.mockReturnValue(committeeFetch$.asObservable());
    const router = TestBed.inject(Router);
    await createComponent();

    // Project A denied (resolved); committee leg still pending — combined access stays
    // provisional-true while the committee check is in flight.
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    // The clone context sync re-targets activeContext to B mid-flight, before B's own write-access
    // fetch has resolved.
    activeContext.set({ uid: PROJECT_B_UID, slug: PROJECT_B_SLUG, name: 'Project B' });
    await TestBed.inject(ApplicationRef).whenStable();
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    // The committee leg's pending fetch (still keyed to the original committee, untouched by the
    // project switch) now resolves false. Without the project leg's `startWith(undefined)`, its
    // stale `false` from A would combine with this to evict before B's own fetch ever runs.
    committeeFetch$.next({ uid: COMMITTEE_UID, writer: false });
    committeeFetch$.complete();
    await TestBed.inject(ApplicationRef).whenStable();
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    // B's own fetch finally resolves — access is correctly granted directly via B's project leg.
    projectBFetch$.next({ uid: PROJECT_B_UID, writer: true });
    projectBFetch$.complete();
    await TestBed.inject(ApplicationRef).whenStable();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
