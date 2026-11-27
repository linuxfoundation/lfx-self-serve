// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, ChangeDetectionStrategy, Component, PLATFORM_ID, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FormArray, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, NavigationEnd, Router } from '@angular/router';
import { CommitteeMemberVotingStatus, PollStatus, PollType } from '@lfx-one/shared/enums';
import { CommitteeMember, Vote } from '@lfx-one/shared/interfaces';
import { getDefaultVoteCloseDate, toZonedDateCarrier } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { VoteService } from '@services/vote.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { VoteManageComponent } from './vote-manage.component';

import type { Confirmation } from 'primeng/api';
import type { ParamMap } from '@angular/router';
import type { Observable } from 'rxjs';

/** Runs the real vote form/signals without rendering the stepper; #6104 assertions are state-only. */
@Component({ selector: 'lfx-vote-manage-state-only', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class StateOnlyVoteManageComponent extends VoteManageComponent {}

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

  let fetchVote: Mock;
  let getProject: Mock;
  let fetchCommittee: Mock;
  let getCommittee: Mock;
  let getCommitteeDetail: Mock;
  let getCommitteeMembers: Mock;
  let routerEvents$: BehaviorSubject<NavigationEnd>;
  let setProject: Mock;
  let messageAdd: Mock;
  let voteServiceMock: {
    getVote: Mock;
    fetchVote: Mock;
    createVote: Mock;
    updateVote: Mock;
    enableVote: Mock;
    beginSpeculativeCreate: Mock;
    confirmSpeculativeVote: Mock;
    discardSpeculativeVote: Mock;
    markVoteOpened: Mock;
    markVoteCreated: Mock;
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
    getCommitteeDetail = vi.fn().mockReturnValue(of({ uid: COMMITTEE_UID, enable_voting: true }));
    getCommitteeMembers = vi.fn().mockReturnValue(of([]));
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
      markVoteCreated: vi.fn(),
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
            getCommitteeDetail,
            getCommitteeMembers,
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
        allow_vote_change: true, // default Yes, always sent (#4723)
      });
      expect(capturedConfirmation).not.toBeNull();
      expect(fixture.componentInstance.confirmingOpenVote()).toBe(true);
    });

    it('accept chains onto the speculation: success toast + navigate, and the service (not the component) marks the vote opened/created', async () => {
      const router = TestBed.inject(Router);
      const fixture = await submitFromValidForm();

      capturedConfirmation?.accept?.();

      expect(voteServiceMock.confirmSpeculativeVote).toHaveBeenCalledTimes(1);
      expect(voteServiceMock.confirmSpeculativeVote.mock.calls[0][0]).toMatchObject({ project_uid: PROJECT_UID });
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
      expect(router.navigate).toHaveBeenCalledWith(['/votes']);
      expect(fixture.componentInstance.submitting()).toBe(false);
      // markVoteOpened and markVoteCreated both moved into the service's confirm chain (GH-4007
      // round 2: marking from the component's own subscriber drops the carrier on fast navigation).
      expect(voteServiceMock.markVoteOpened).not.toHaveBeenCalled();
      expect(voteServiceMock.markVoteCreated).not.toHaveBeenCalled();
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
            allow_vote_change: false,
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
      expect(form.get('allow_vote_change')?.value).toBe(false); // source setting preselected (#4723)
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

    // GH-4007: a cloned vote previously went missing from the votes list until a manual page
    // reload, because the search index hadn't caught up yet. Clone shares submitVote()'s create
    // path exactly, so confirming creation marks the new vote the same way a plain create does —
    // now inside the service's own confirm chain (see vote.service.spec.ts), so this component test
    // only needs to verify the clone flow reaches confirmSpeculativeVote, not the marking itself.
    it('reaches confirmSpeculativeVote for the cloned vote so it gets marked created the same way a plain create does (GH-4007)', async () => {
      const SOURCE_PROJECT_UID = 'source-project-uid';
      const createdVote = { uid: 'new-cloned-vote-uid', project_uid: SOURCE_PROJECT_UID } as unknown as Vote;
      voteServiceMock.confirmSpeculativeVote.mockReturnValue(of({ vote: createdVote, opened: true }));
      activeContext.set({ uid: SOURCE_PROJECT_UID, slug: 'source-project', name: 'Source Project' });
      getProject.mockReturnValue(of({ uid: SOURCE_PROJECT_UID, writer: true }));
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

      fixture.componentInstance.onSubmit();
      (capturedConfirmation as Confirmation | null)?.accept?.();

      expect(voteServiceMock.confirmSpeculativeVote).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.submitting()).toBe(false);
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

      expect(voteServiceMock.confirmSpeculativeVote).not.toHaveBeenCalled();
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'No project selected' }));
    });

    // GH-3781 review round 4 (PRRT_kwDOPMiRQ86uNsR8, dealako): resolveAuthorizedProjectUid() fails
    // closed on a pending (not just a denied) write-access leg — pin it directly rather than only
    // through the eviction tests, which exercise the optimistic leg, not the strict one this gate
    // actually reads.
    it('blocks submission while project write access is still pending on a clone', async () => {
      const SOURCE_PROJECT_UID = 'source-project-uid';
      activeContext.set({ uid: SOURCE_PROJECT_UID, slug: 'source-project', name: 'Source Project' });
      getProject.mockReturnValue(new Subject<{ uid: string; writer: boolean } | null>().asObservable());
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

      // getProject never resolves — projectAccess stays pending (undefined), so the strict
      // resolvedWriteAccess() must stay false even though the clone's project matches activeContext.
      fixture.componentInstance.onSubmit();

      expect(voteServiceMock.beginSpeculativeCreate).not.toHaveBeenCalled();
    });

    // GH-3781 review round 4 (PRRT_kwDOPMiRQ86uNuyT, cursor "Clone submit trusts unrelated committee
    // grant"; PRRT_kwDOPMiRQ86uOJtD / PRRT_kwDOPMiRQ86uOLVe, greptile/copilot "Committee writers
    // cannot clone"): the committee leg of write access previously still resolved off
    // ?committee_uid= even while cloning, so a caller who happened to be a writer on some unrelated
    // committee (e.g. a stale or unrelated ?committee_uid= left over from navigation) could satisfy
    // resolvedWriteAccess() and have resolveAuthorizedProjectUid() hand back the clone's own
    // (unsynced, unauthorized) project_uid. Pins the fix: committeeCandidate$ swaps the URL uid for
    // the loaded SOURCE's own committee_uid while cloning — never an unrelated ?committee_uid= — so
    // the committee leg can vouch only for the committee the clone actually belongs to.
    it('does not authorize an unsynced clone project off write access to an unrelated committee', async () => {
      const SOURCE_PROJECT_UID = 'source-project-uid';
      // Sync never converged (e.g. the clone source lacks project_slug) — activeContext stays null,
      // so the project leg resolves false.
      activeContext.set(null);
      getProject.mockReturnValue(of(null));
      routeMock.queryParamMap = of(convertToParamMap({ clone: CLONE_SOURCE_UID, committee_uid: 'unrelated-committee-uid' }));
      // The caller IS a writer on the URL's unrelated committee but NOT on the source vote's own
      // committee (COMMITTEE_UID) — if the committee leg still consulted the URL's uid while cloning,
      // resolvedWriteAccess() would wrongly resolve true.
      fetchCommittee.mockImplementation((uid: string) => of({ uid, writer: uid === 'unrelated-committee-uid' }));
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

      expect(fetchCommittee).not.toHaveBeenCalledWith('unrelated-committee-uid');
      expect(voteServiceMock.beginSpeculativeCreate).not.toHaveBeenCalled();
    });

    // GH-3781 review round 4 (PRRT_kwDOPMiRQ86uOJtD / PRRT_kwDOPMiRQ86uOLVe, greptile/copilot
    // "Committee writers cannot clone"): an organizer with writer:true on the source vote's OWN
    // committee but writer:false on its project can still enter the clone flow through writerGuard's
    // committee leg. Folding committeeCandidate$ to null entirely while cloning (the round-4 fix's
    // first pass) would have denied both legs and blocked submission for this organizer. Pins the fix:
    // committeeCandidate$ swaps in the loaded source's own committee_uid, so this organizer's existing
    // committee grant still authorizes the clone.
    it('allows submission for a committee-only writer cloning a vote owned by their own committee', async () => {
      // Not a writer on the project — only the committee grant can authorize this clone.
      activeContext.set({ uid: PROJECT_UID, slug: 'project-a', name: 'Project A' });
      getProject.mockReturnValue(of({ uid: PROJECT_UID, writer: false }));
      fetchCommittee.mockImplementation((uid: string) => of({ uid, writer: uid === COMMITTEE_UID }));
      fetchVote.mockReturnValue(of(sourceVote({ project_uid: PROJECT_UID, committee_uid: COMMITTEE_UID })));
      const fixture = await createComponent();
      await TestBed.inject(ApplicationRef).whenStable();

      const form = fixture.componentInstance.form();
      form.get('eligible_participants')?.setValue('project_members');
      form.get('close_date')?.setValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      const firstQuestion = (form.get('questions') as FormArray).at(0) as FormGroup;
      firstQuestion.get('question')?.setValue('Approve the budget?');
      (firstQuestion.get('options') as FormArray).at(0).setValue('Yes');
      (firstQuestion.get('options') as FormArray).at(1).setValue('No');
      form.updateValueAndValidity();

      fixture.componentInstance.onSubmit();

      expect(fetchCommittee).toHaveBeenCalledWith(COMMITTEE_UID);
      expect(voteServiceMock.beginSpeculativeCreate).toHaveBeenCalled();
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

    // #4075: majority is not in isRankedPollType's allowlist, so it's exactly as representable by
    // this plain (non-ranked, non-anonymous) form as a generic poll — it must remain clonable.
    it('clones a majority-poll-type source successfully: no warning, form patched', async () => {
      fetchVote.mockReturnValue(of(sourceVote({ poll_type: PollType.MAJORITY, committee_uid: COMMITTEE_UID })));
      const fixture = await createComponent();

      expect(messageAdd).not.toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Cannot clone' }));
      expect(fixture.componentInstance.form().get('title')?.value).toBe('Copy of Original board election');
      expect(fixture.componentInstance.form().disabled).toBe(false);
    });

    it.each(['save', 'open'])('can %s a majority clone as a new plurality vote', async (action) => {
      routeMock.snapshot.queryParamMap = convertToParamMap({ clone: CLONE_SOURCE_UID });
      activeContext.set({ uid: PROJECT_UID, slug: PROJECT_SLUG });
      getProject.mockReturnValue(of({ uid: PROJECT_UID, writer: true }));
      fetchVote.mockReturnValue(of(sourceVote({ poll_type: PollType.MAJORITY, committee_uid: COMMITTEE_UID })));
      const fixture = await createComponent();
      const form = fixture.componentInstance.form();
      form.get('eligible_participants')?.setValue('all');
      const question = (form.get('questions') as FormArray).at(0) as FormGroup;
      question.get('question')?.setValue('Approve the proposed budget?');
      (question.get('options') as FormArray).at(0).setValue('Yes');
      (question.get('options') as FormArray).at(1).setValue('No');
      await TestBed.inject(ApplicationRef).whenStable();

      if (action === 'save') {
        fixture.componentInstance.onSaveAsDraft();
        expect(voteServiceMock.createVote).toHaveBeenCalledWith(expect.objectContaining({ poll_type: PollType.GENERIC }));
      } else {
        const confirm = vi.spyOn(TestBed.inject(ConfirmationService), 'confirm');
        fixture.componentInstance.onSubmit();
        expect(confirm).toHaveBeenCalled();
        confirm.mock.calls.at(-1)?.[0].accept?.();
        expect(voteServiceMock.confirmSpeculativeVote).toHaveBeenCalledWith(expect.objectContaining({ poll_type: PollType.GENERIC }));
      }
      expect(messageAdd).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Voting method unavailable' }));
    });

    // GH-3781 review round 3 (PRRT_kwDOPMiRQ86uDywE, dealako; pins the uAPFY/vote.utils.ts SSR fix):
    // cloning an ended vote resets its deadline through getUserTimezone() unless running on the
    // server, matching every other getUserTimezone() call site's isPlatformBrowser guard. Pins that
    // an SSR render (PLATFORM_ID: 'server') resolves the reset timezone to 'UTC' instead of calling
    // getUserTimezone(), which would otherwise diverge from the client's hydrated render.
    it('resets an ended clone source deadline to UTC during SSR instead of calling getUserTimezone()', async () => {
      TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
      fetchVote.mockReturnValue(of(sourceVote({ committee_uid: COMMITTEE_UID, end_time: '2000-01-01T00:00:00Z' })));
      const fixture = await createComponent();

      expect(fixture.componentInstance.form().get('timezone')?.value).toBe('UTC');
    });
  });

  describe('create defaults (#6104)', () => {
    const createStateOnlyComponent = async () => {
      const fixture = TestBed.createComponent(StateOnlyVoteManageComponent);
      await TestBed.inject(ApplicationRef).whenStable();
      return fixture;
    };

    const COMMITTEE_A = { uid: 'committee-uid-a', name: 'Committee A' };
    const COMMITTEE_B = { uid: 'committee-uid-b', name: 'Committee B' };
    const descriptionFor = (name: string) =>
      `Members of the ${name} are asked to vote on the question(s) below. Please review the options and cast your ballot before the vote closes.`;

    const selectCommittee = async (fixture: Awaited<ReturnType<typeof createStateOnlyComponent>>, committee: { uid: string; name: string } | null) => {
      fixture.componentInstance.form().get('committee')?.setValue(committee);
      await TestBed.inject(ApplicationRef).whenStable();
    };

    beforeEach(() => {
      setRouteMode(null);
      routeMock.queryParamMap = of(convertToParamMap({}));
      getProject.mockReturnValue(of(null));
    });

    afterEach(() => {
      routeMock.queryParamMap = of(convertToParamMap({}));
      routeMock.snapshot.queryParamMap = convertToParamMap({});
    });

    it("starts a new vote with 'all' eligibility and a weekday close date 7 days out, with title and description empty", async () => {
      const fixture = await createStateOnlyComponent();
      const form = fixture.componentInstance.form();

      expect(form.get('eligible_participants')?.value).toBe('all');
      const closeDate = form.get('close_date')?.value as Date;
      expect(closeDate).toEqual(getDefaultVoteCloseDate(Date.now(), form.get('timezone')?.value));
      expect([0, 6]).not.toContain(closeDate.getDay());
      expect(form.get('title')?.value).toBe('');
      expect(form.get('description')?.value).toBe('');
      expect(fixture.componentInstance.prefilledTitle()).toBe(false);
    });

    it('seeds the title and description once per group pick, keeps them pristine, and re-seeds on a group switch', async () => {
      const fixture = await createStateOnlyComponent();
      const form = fixture.componentInstance.form();
      const titleWrites: unknown[] = [];
      form.get('title')?.valueChanges.subscribe((value) => titleWrites.push(value));

      await selectCommittee(fixture, COMMITTEE_A);

      expect(form.get('title')?.value).toBe('Committee A Vote');
      expect(form.get('description')?.value).toBe(descriptionFor('Committee A'));
      expect(form.get('title')?.pristine).toBe(true);
      expect(titleWrites).toEqual(['Committee A Vote']);
      expect(fixture.componentInstance.prefilledTitle()).toBe(true);
      expect(fixture.componentInstance.prefilledDescription()).toBe(true);

      await selectCommittee(fixture, COMMITTEE_B);

      expect(form.get('title')?.value).toBe('Committee B Vote');
      expect(form.get('description')?.value).toBe(descriptionFor('Committee B'));
      expect(titleWrites).toEqual(['Committee A Vote', 'Committee B Vote']);
    });

    it.each(['review', 'confirmation'] as const)('keeps untouched seeds following group changes after the deadline expires on %s', async (phase) => {
      activeContext.set({ uid: PROJECT_UID, slug: PROJECT_SLUG });
      getProject.mockReturnValue(of({ uid: PROJECT_UID, writer: true }));
      const fixture = await createStateOnlyComponent();
      const component = fixture.componentInstance;
      const form = component.form();
      await selectCommittee(fixture, COMMITTEE_A);
      const question = (form.get('questions') as FormArray).at(0) as FormGroup;
      question.get('question')?.setValue('Approve the proposed budget?');
      (question.get('options') as FormArray).at(0).setValue('Yes');
      (question.get('options') as FormArray).at(1).setValue('No');
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      form.get('close_date')?.setValue(futureDate);
      await TestBed.inject(ApplicationRef).whenStable();
      expect(form.valid).toBe(true);
      component.nextStep();
      await TestBed.inject(ApplicationRef).whenStable();
      component.nextStep();
      await TestBed.inject(ApplicationRef).whenStable();
      expect(component.currentStep()).toBe(3);
      const confirm = vi.spyOn(TestBed.inject(ConfirmationService), 'confirm');
      if (phase === 'confirmation') {
        component.onSubmit();
        expect(confirm).toHaveBeenCalledTimes(1);
      }

      form.get('close_date')?.setValue(new Date(Date.now() - 24 * 60 * 60 * 1000));
      if (phase === 'confirmation') {
        confirm.mock.calls[0][0].accept?.();
      } else {
        component.onSubmit();
      }
      await TestBed.inject(ApplicationRef).whenStable();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Deadline expired' }));
      expect(component.currentStep()).toBe(1);
      expect(voteServiceMock.confirmSpeculativeVote).not.toHaveBeenCalled();
      expect(form.get('title')?.touched).toBe(true);
      expect(form.get('description')?.touched).toBe(true);
      expect(question.get('question')?.touched).toBe(true);
      expect(form.get('title')?.pristine).toBe(true);
      expect(form.get('description')?.pristine).toBe(true);

      form.get('close_date')?.setValue(futureDate);
      await selectCommittee(fixture, COMMITTEE_B);
      expect(form.get('title')?.value).toBe('Committee B Vote');
      expect(form.get('description')?.value).toBe(descriptionFor('Committee B'));
      await selectCommittee(fixture, null);
      expect(form.get('title')?.value).toBe('');
      expect(form.get('description')?.value).toBe('');
    });

    it('preserves genuine edits and deliberate clearing after failed-submit validation', async () => {
      const fixture = await createStateOnlyComponent();
      const form = fixture.componentInstance.form();
      await selectCommittee(fixture, COMMITTEE_A);
      form.get('title')?.setValue('Approve the 2027 budget');
      form.get('title')?.markAsDirty();
      form.get('description')?.setValue('');
      form.get('description')?.markAsDirty();
      form.get('close_date')?.setValue(new Date(Date.now() - 24 * 60 * 60 * 1000));

      fixture.componentInstance.onSubmit();

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Deadline expired' }));
      expect(form.get('title')?.dirty).toBe(true);
      expect(form.get('description')?.dirty).toBe(true);
      await selectCommittee(fixture, COMMITTEE_B);
      expect(form.get('title')?.value).toBe('Approve the 2027 budget');
      expect(form.get('description')?.value).toBe('');
      await selectCommittee(fixture, null);
      expect(form.get('title')?.value).toBe('Approve the 2027 budget');
      expect(form.get('description')?.value).toBe('');
    });

    it("keeps an organizer's edited title on a group switch while the unedited description re-seeds", async () => {
      const fixture = await createStateOnlyComponent();
      const form = fixture.componentInstance.form();
      await selectCommittee(fixture, COMMITTEE_A);

      form.get('title')?.setValue('Approve the 2027 budget');
      form.get('title')?.markAsDirty();
      await selectCommittee(fixture, COMMITTEE_B);

      expect(form.get('title')?.value).toBe('Approve the 2027 budget');
      expect(form.get('description')?.value).toBe(descriptionFor('Committee B'));
      expect(fixture.componentInstance.prefilledTitle()).toBe(false);
      expect(fixture.componentInstance.prefilledDescription()).toBe(true);
    });

    it('clears only the unedited seed when the group is cleared', async () => {
      const fixture = await createStateOnlyComponent();
      const form = fixture.componentInstance.form();
      await selectCommittee(fixture, COMMITTEE_A);

      form.get('description')?.setValue('Context the organizer wrote');
      form.get('description')?.markAsDirty();
      await selectCommittee(fixture, null);

      expect(form.get('title')?.value).toBe('');
      expect(form.get('description')?.value).toBe('Context the organizer wrote');
      expect(fixture.componentInstance.prefilledTitle()).toBe(false);
    });

    it('keeps a description the organizer cleared when the group changes', async () => {
      const fixture = await createStateOnlyComponent();
      const form = fixture.componentInstance.form();
      await selectCommittee(fixture, COMMITTEE_A);

      form.get('description')?.setValue('');
      form.get('description')?.markAsDirty();
      await selectCommittee(fixture, COMMITTEE_B);

      expect(form.get('title')?.value).toBe('Committee B Vote');
      expect(form.get('description')?.value).toBe('');
    });

    it('seeds the title and description from a ?committee_uid= locked group', async () => {
      routeMock.queryParamMap = of(convertToParamMap({ committee_uid: COMMITTEE_A.uid }));
      getCommittee.mockReturnValue(of(COMMITTEE_A));
      const fixture = await createStateOnlyComponent();
      const form = fixture.componentInstance.form();

      expect(form.get('committee')?.disabled).toBe(true);
      expect(form.get('title')?.value).toBe('Committee A Vote');
      expect(form.get('description')?.value).toBe(descriptionFor('Committee A'));
    });

    it("keeps an edited vote's saved title, description, eligibility and close date", async () => {
      setRouteMode(VOTE_UID);
      fetchVote.mockReturnValue(
        of({
          ...unenrichedVote(),
          name: 'Saved draft',
          description: '',
          committee_name: 'Committee A',
          committee_filters: [CommitteeMemberVotingStatus.VOTING_REP],
          end_time: '2099-03-14T18:00:00Z',
          end_time_timezone: 'UTC',
        } as Vote)
      );
      const fixture = await createStateOnlyComponent();
      const form = fixture.componentInstance.form();

      expect(form.get('title')?.value).toBe('Saved draft');
      expect(form.get('description')?.value).toBe('');
      expect(form.get('eligible_participants')?.value).toBe('voting_rep');
      expect(form.get('close_date')?.value).toEqual(toZonedDateCarrier(new Date('2099-03-14T18:00:00Z'), 'UTC'));
      expect(fixture.componentInstance.prefilledTitle()).toBe(false);
    });

    it('keeps a clone\'s "Copy of" title and source description without seeding', async () => {
      routeMock.queryParamMap = of(convertToParamMap({ clone: 'vote-uid-source' }));
      routeMock.snapshot.queryParamMap = convertToParamMap({ clone: 'vote-uid-source' });
      fetchVote.mockReturnValue(
        of({
          uid: 'vote-uid-source',
          name: 'Original board election',
          description: '',
          status: PollStatus.ACTIVE,
          project_uid: PROJECT_UID,
          committee_uid: COMMITTEE_A.uid,
          committee_name: COMMITTEE_A.name,
          end_time: '2099-01-01T00:00:00Z',
        } as Vote)
      );
      const fixture = await createStateOnlyComponent();
      const form = fixture.componentInstance.form();

      expect(form.get('title')?.value).toBe('Copy of Original board election');
      expect(form.get('description')?.value).toBe('');
      expect(fixture.componentInstance.prefilledTitle()).toBe(false);
      expect(fixture.componentInstance.prefilledDescription()).toBe(false);
    });

    it.each([
      [
        'blocked',
        () =>
          of({
            uid: 'vote-uid-source',
            name: 'Secret ballot',
            status: PollStatus.ACTIVE,
            project_uid: PROJECT_UID,
            pseudo_anonymity: true,
            end_time: '2099-01-01T00:00:00Z',
          } as Vote),
      ],
      ['failed', () => throwError(() => new Error('not found'))],
    ])('seeds the fresh form a %s clone leaves behind once a group is picked', async (_label, source) => {
      routeMock.queryParamMap = of(convertToParamMap({ clone: 'vote-uid-source' }));
      routeMock.snapshot.queryParamMap = convertToParamMap({ clone: 'vote-uid-source' });
      fetchVote.mockReturnValue(source());
      const fixture = await createStateOnlyComponent();
      const form = fixture.componentInstance.form();
      expect(form.get('title')?.value).toBe('');

      await selectCommittee(fixture, COMMITTEE_A);

      expect(form.get('title')?.value).toBe('Committee A Vote');
      expect(form.get('description')?.value).toBe(descriptionFor('Committee A'));
      expect(fixture.componentInstance.prefilledTitle()).toBe(true);
    });

    it('keys the seed to its form across a create -> clone -> create round trip', async () => {
      const queryParams$ = new Subject<ParamMap>();
      routeMock.queryParamMap = queryParams$.asObservable();
      fetchVote.mockReturnValue(
        of({
          uid: 'vote-uid-source',
          name: 'Original',
          description: descriptionFor('Committee A'),
          status: PollStatus.ACTIVE,
          project_uid: PROJECT_UID,
          end_time: '2099-01-01T00:00:00Z',
        } as Vote)
      );
      const fixture = await createStateOnlyComponent();
      await selectCommittee(fixture, COMMITTEE_A);
      routeMock.snapshot.queryParamMap = convertToParamMap({ clone: 'vote-uid-source' });
      queryParams$.next(convertToParamMap({ clone: 'vote-uid-source' }));
      await TestBed.inject(ApplicationRef).whenStable();
      const cloneForm = fixture.componentInstance.form();

      // The clone's description matches the first form's seed, but it came from the source vote.
      expect(cloneForm.get('description')?.value).toBe(descriptionFor('Committee A'));
      expect(fixture.componentInstance.prefilledDescription()).toBe(false);

      routeMock.snapshot.queryParamMap = convertToParamMap({});
      queryParams$.next(convertToParamMap({}));
      await TestBed.inject(ApplicationRef).whenStable();
      const form = fixture.componentInstance.form();
      expect(form).not.toBe(cloneForm);
      expect(form.get('eligible_participants')?.value).toBe('all');

      await selectCommittee(fixture, COMMITTEE_A);

      expect(form.get('title')?.value).toBe('Committee A Vote');
      expect(form.get('description')?.value).toBe(descriptionFor('Committee A'));
      expect(fixture.componentInstance.prefilledTitle()).toBe(true);
    });
  });

  describe('committee context (?committee_uid=<uid>) reuse', () => {
    beforeEach(() => {
      setRouteMode(null); // create mode — committee_uid lock only applies on the create route
    });

    // GH-3781 review round 3 (PRRT_kwDOPMiRQ86uDywE, dealako): initCommitteeContext reacts to the
    // live committee_uid query param (not a one-shot take(1) read) so the rail's Create Vote dialog
    // can retarget a reused instance from one group to another without a full reload. Pins that a
    // plain committee_uid A -> B transition re-locks the form to B, rather than leaving it stuck on
    // A's lock or unlocked.
    it('re-locks the committee field to the newly selected group on a committee_uid A -> B transition', async () => {
      const queryParams$ = new Subject<ParamMap>();
      routeMock.queryParamMap = queryParams$.asObservable();
      const COMMITTEE_A_UID = 'committee-uid-a';
      const COMMITTEE_B_UID = 'committee-uid-b';
      getCommittee.mockImplementation((uid: string) =>
        of(uid === COMMITTEE_A_UID ? { uid: COMMITTEE_A_UID, name: 'Committee A' } : { uid: COMMITTEE_B_UID, name: 'Committee B' })
      );
      const fixture = await createComponent();

      queryParams$.next(convertToParamMap({ committee_uid: COMMITTEE_A_UID }));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(fixture.componentInstance.committeeContext()?.uid).toBe(COMMITTEE_A_UID);
      let committeeControl = fixture.componentInstance.form().get('committee');
      expect(committeeControl?.value).toEqual({ uid: COMMITTEE_A_UID, name: 'Committee A' });
      expect(committeeControl?.disabled).toBe(true);

      queryParams$.next(convertToParamMap({ committee_uid: COMMITTEE_B_UID }));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(fixture.componentInstance.committeeContext()?.uid).toBe(COMMITTEE_B_UID);
      committeeControl = fixture.componentInstance.form().get('committee');
      expect(committeeControl?.value).toEqual({ uid: COMMITTEE_B_UID, name: 'Committee B' });
      expect(committeeControl?.disabled).toBe(true);
    });

    // GH-3781 review round 3 (PRRT_kwDOPMiRQ86uDywA, copilot; PRRT_kwDOPMiRQ86uDywE, dealako):
    // resetOpenConfirmationIfPending now runs from both initCommitteeContext and initCloneFromQuery,
    // so a committee_uid change (not just a ?clone change) tears down a stale open confirmation and
    // its pending speculative vote instead of leaving them dangling against a form that's about to
    // be relocked to a different group.
    it('dismisses an open confirmation and discards its speculative vote when the committee_uid changes underneath it', async () => {
      const queryParams$ = new Subject<ParamMap>();
      routeMock.queryParamMap = queryParams$.asObservable();
      getCommittee.mockReturnValue(of({ uid: COMMITTEE_UID, name: 'Committee A' }));
      const fixture = await createComponent();

      queryParams$.next(convertToParamMap({}));
      await TestBed.inject(ApplicationRef).whenStable();

      const confirmationService = TestBed.inject(ConfirmationService);
      const closeSpy = vi.spyOn(confirmationService, 'close');
      fixture.componentInstance.confirmingOpenVote.set(true);

      queryParams$.next(convertToParamMap({ committee_uid: COMMITTEE_UID }));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(fixture.componentInstance.confirmingOpenVote()).toBe(false);
      expect(closeSpy).toHaveBeenCalled();
      expect(voteServiceMock.discardSpeculativeVote).toHaveBeenCalled();
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

  // #2921: the voting method is seeded from the Create Vote dropdown's ?poll_type=, locked once the
  // vote exists, and a Condorcet IRV vote needs at least three eligible voters before it can open.
  describe('voting method (#2921)', () => {
    let capturedConfirmation: Confirmation | null;

    const members = (count: number, status = CommitteeMemberVotingStatus.VOTING_REP): CommitteeMember[] =>
      Array.from({ length: count }, (_, index) => ({ uid: `member-${index}`, voting: { status } }) as CommitteeMember);

    const setQueryParams = (params: Record<string, string>) => {
      routeMock.queryParamMap = of(convertToParamMap(params));
      routeMock.snapshot.queryParamMap = convertToParamMap(params);
    };

    const fillValidForm = (component: VoteManageComponent, pollType: PollType = PollType.CONDORCET_IRV) => {
      const form = component.form();
      form.get('title')?.setValue('Chair election 2026');
      form.get('committee')?.setValue({ uid: COMMITTEE_UID, name: 'Test Committee' });
      form.get('eligible_participants')?.setValue('voting_rep');
      form.get('poll_type')?.setValue(pollType);
      form.get('close_date')?.setValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      const firstQuestion = (form.get('questions') as FormArray).at(0) as FormGroup;
      firstQuestion.get('question')?.setValue('Who should chair the board?');
      (firstQuestion.get('options') as FormArray).at(0).setValue('Alice');
      (firstQuestion.get('options') as FormArray).at(1).setValue('Bob');
      form.updateValueAndValidity();
    };

    const createFilled = async (pollType: PollType = PollType.CONDORCET_IRV) => {
      const fixture = await createComponent();
      fillValidForm(fixture.componentInstance, pollType);
      await TestBed.inject(ApplicationRef).whenStable();
      return fixture;
    };

    const rankedVote = () =>
      ({
        ...enrichedVote(),
        name: 'Ranked draft',
        status: PollStatus.DISABLED,
        poll_type: PollType.CONDORCET_IRV,
        committee_filters: [CommitteeMemberVotingStatus.VOTING_REP],
        end_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        end_time_timezone: 'UTC',
        poll_questions: [
          {
            question_id: 'q1',
            prompt: 'Who should chair the board?',
            type: 'multiple_choice',
            choices: [
              { choice_id: 'c1', choice_text: 'Alice' },
              { choice_id: 'c2', choice_text: 'Bob' },
            ],
          },
        ],
      }) as unknown as Vote;

    beforeEach(() => {
      setRouteMode(null); // create mode
      setQueryParams({});
      activeContext.set({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: 'Test Project' });
      getProject.mockReturnValue(of({ uid: PROJECT_UID, writer: true }));
      getCommitteeMembers.mockReturnValue(of(members(3)));
      capturedConfirmation = null;
      const confirmationService = TestBed.inject(ConfirmationService);
      vi.spyOn(confirmationService, 'confirm').mockImplementation((confirmation) => {
        capturedConfirmation = confirmation;
        return confirmationService;
      });
    });

    afterEach(() => setQueryParams({}));

    it.each([
      ['condorcet_irv', PollType.CONDORCET_IRV],
      ['instant_runoff_vote', PollType.INSTANT_RUNOFF_VOTE],
      ['generic', PollType.GENERIC],
      ['meek_stv', PollType.GENERIC],
      ['bogus', PollType.GENERIC],
    ])('seeds only enabled methods from ?poll_type=%s on create', async (param, expected) => {
      setQueryParams({ poll_type: param });
      const fixture = await createComponent();
      const control = fixture.componentInstance.form().get('poll_type')!;

      expect(control.value).toBe(expected);
      expect(control.enabled).toBe(true);
      control.setValue(PollType.GENERIC);
      expect(control.value).toBe(PollType.GENERIC);
    });

    it('defaults to plurality without a ?poll_type=', async () => {
      const fixture = await createComponent();

      expect(fixture.componentInstance.form().get('poll_type')?.value).toBe(PollType.GENERIC);
    });

    it('keeps an existing vote’s method in edit mode, locked, whatever ?poll_type= says', async () => {
      setRouteMode(VOTE_UID);
      setQueryParams({ poll_type: 'generic' });
      fetchVote.mockReturnValue(of(rankedVote()));
      const fixture = await createComponent();
      const control = fixture.componentInstance.form().get('poll_type')!;

      expect(control.value).toBe(PollType.CONDORCET_IRV);
      expect(control.disabled).toBe(true);
    });

    it('keeps an existing Instant Runoff vote’s method and ranked questions in edit mode, locked (#2936)', async () => {
      setRouteMode(VOTE_UID);
      setQueryParams({ poll_type: 'condorcet_irv' });
      fetchVote.mockReturnValue(of({ ...rankedVote(), poll_type: PollType.INSTANT_RUNOFF_VOTE } as Vote));
      const fixture = await createComponent();
      const form = fixture.componentInstance.form();
      const options = ((form.get('questions') as FormArray).at(0) as FormGroup).get('options') as FormArray;

      expect(form.get('poll_type')?.value).toBe(PollType.INSTANT_RUNOFF_VOTE);
      expect(form.get('poll_type')?.disabled).toBe(true);
      expect(options.value).toEqual(['Alice', 'Bob']);
    });

    it('saves a new Condorcet draft with ranked questions', async () => {
      const fixture = await createFilled();
      fixture.componentInstance.onSaveAsDraft();

      expect(voteServiceMock.createVote).toHaveBeenCalledWith(
        expect.objectContaining({ poll_type: PollType.CONDORCET_IRV, poll_questions: [expect.objectContaining({ type: 'multiple_choice' })] })
      );
      expect(messageAdd).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Voting method unavailable' }));
    });

    it('opens a new Condorcet vote with ranked questions after confirmation', async () => {
      const fixture = await createFilled();
      fixture.componentInstance.onSubmit();

      const request = expect.objectContaining({
        poll_type: PollType.CONDORCET_IRV,
        poll_questions: [expect.objectContaining({ type: 'multiple_choice' })],
      });
      expect(voteServiceMock.beginSpeculativeCreate).toHaveBeenCalledWith(request);
      expect(capturedConfirmation).not.toBeNull();
      expect(voteServiceMock.confirmSpeculativeVote).not.toHaveBeenCalled();
      capturedConfirmation!.accept!();
      expect(voteServiceMock.confirmSpeculativeVote).toHaveBeenCalledWith(request);
      expect(messageAdd).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Voting method unavailable' }));
    });

    it('saves a new Instant Runoff draft with ranked questions (#2936)', async () => {
      const fixture = await createFilled(PollType.INSTANT_RUNOFF_VOTE);
      fixture.componentInstance.onSaveAsDraft();

      expect(voteServiceMock.createVote).toHaveBeenCalledWith(
        expect.objectContaining({ poll_type: PollType.INSTANT_RUNOFF_VOTE, poll_questions: [expect.objectContaining({ type: 'multiple_choice' })] })
      );
      expect(messageAdd).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Voting method unavailable' }));
    });

    it('opens a new Instant Runoff vote with ranked questions after confirmation (#2936)', async () => {
      const fixture = await createFilled(PollType.INSTANT_RUNOFF_VOTE);
      fixture.componentInstance.onSubmit();

      const request = expect.objectContaining({
        poll_type: PollType.INSTANT_RUNOFF_VOTE,
        poll_questions: [expect.objectContaining({ type: 'multiple_choice' })],
      });
      expect(voteServiceMock.beginSpeculativeCreate).toHaveBeenCalledWith(request);
      expect(capturedConfirmation).not.toBeNull();
      capturedConfirmation!.accept!();
      expect(voteServiceMock.confirmSpeculativeVote).toHaveBeenCalledWith(request);
      expect(messageAdd).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Voting method unavailable' }));
    });

    it('opens a new Instant Runoff vote with a two-member group without counting eligible voters (#2936)', async () => {
      getCommitteeMembers.mockReturnValue(of(members(2)));
      const fixture = await createFilled(PollType.INSTANT_RUNOFF_VOTE);

      expect(getCommitteeMembers).not.toHaveBeenCalled();
      expect(fixture.componentInstance.eligibleVoterCountState().status).toBe('idle');
      expect(fixture.componentInstance.canGoNext()).toBe(true);

      fixture.componentInstance.onSubmit();
      expect(voteServiceMock.beginSpeculativeCreate).toHaveBeenCalledWith(expect.objectContaining({ poll_type: PollType.INSTANT_RUNOFF_VOTE }));
    });

    it.each(['onSubmit', 'onSaveAsDraft'] as const)('blocks unsupported methods at %s even if the form is set programmatically', async (action) => {
      const fixture = await createFilled(PollType.MEEK_STV);

      fixture.componentInstance[action]();

      expect(voteServiceMock.beginSpeculativeCreate).not.toHaveBeenCalled();
      expect(voteServiceMock.createVote).not.toHaveBeenCalled();
      expect(voteServiceMock.confirmSpeculativeVote).not.toHaveBeenCalled();
      expect(capturedConfirmation).toBeNull();
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Voting method unavailable' }));
    });

    it('rechecks availability after the open confirmation and discards a pending speculative vote', async () => {
      const fixture = await createFilled(PollType.GENERIC);
      fixture.componentInstance.onSubmit();
      expect(voteServiceMock.beginSpeculativeCreate).toHaveBeenCalledTimes(1);
      expect(capturedConfirmation).not.toBeNull();

      fixture.componentInstance.form().get('poll_type')?.setValue(PollType.MEEK_STV);
      capturedConfirmation!.accept!();

      expect(voteServiceMock.confirmSpeculativeVote).not.toHaveBeenCalled();
      expect(voteServiceMock.discardSpeculativeVote).toHaveBeenCalled();
      expect(fixture.componentInstance.submitting()).toBe(false);
    });

    it('still opens an existing Condorcet draft with ranked questions', async () => {
      setRouteMode(VOTE_UID);
      fetchVote.mockReturnValue(of(rankedVote()));
      const fixture = await createComponent();

      fixture.componentInstance.onSubmit();

      expect(voteServiceMock.updateVote).toHaveBeenCalledTimes(1);
      expect(voteServiceMock.updateVote.mock.calls[0][1].poll_questions.map((question: { type: string }) => question.type)).toEqual(['multiple_choice']);
      expect(voteServiceMock.enableVote).toHaveBeenCalledWith(VOTE_UID);
      expect(voteServiceMock.beginSpeculativeCreate).not.toHaveBeenCalled();
    });

    it('requires a complete roster before counting eligible voters for an existing Condorcet draft', async () => {
      setRouteMode(VOTE_UID);
      fetchVote.mockReturnValue(of(rankedVote()));
      const fixture = await createComponent();

      expect(getCommitteeMembers).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, expect.any(HttpParams));
      expect(getCommitteeMembers.mock.calls[0][1].get('require_complete')).toBe('true');
      expect(fixture.componentInstance.eligibleVoterCountState()).toEqual({ status: 'loaded', count: 3 });
    });

    it('keeps the method out of an edit’s update request, so ITX keeps the stored one', async () => {
      setRouteMode(VOTE_UID);
      fetchVote.mockReturnValue(of(rankedVote()));
      getProject.mockReturnValue(of({ uid: PROJECT_UID, writer: true }));
      const fixture = await createComponent();

      fixture.componentInstance.onSaveAsDraft();

      expect(voteServiceMock.updateVote).toHaveBeenCalledTimes(1);
      const request = voteServiceMock.updateVote.mock.calls[0][1];
      expect('poll_type' in request).toBe(false);
      expect(request.poll_questions.map((question: { type: string }) => question.type)).toEqual(['multiple_choice']);
    });

    it.each([
      ['2 eligible voters', () => of(members(2)), false, 'loaded'],
      ['3 eligible voters', () => of(members(3)), true, 'loaded'],
      ['a failed member fetch', () => throwError(() => new Error('503')), true, 'error'],
    ])('Step 1 with %s: valid = %s', async (_label, response, valid, status) => {
      getCommitteeMembers.mockImplementation(response);
      const fixture = await createFilled();

      expect(fixture.componentInstance.eligibleVoterCountState().status).toBe(status);
      expect(fixture.componentInstance.isCurrentStepValid()).toBe(valid);
      expect(fixture.componentInstance.canGoNext()).toBe(valid);
    });

    it('logs a failed count before falling back to the non-blocking error state', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      getCommitteeMembers.mockReturnValue(throwError(() => new Error('503')));
      const fixture = await createFilled();

      expect(fixture.componentInstance.eligibleVoterCountState()).toEqual({ status: 'error', count: null });
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to count eligible voters for a Condorcet IRV group',
        expect.objectContaining({ committeeUid: COMMITTEE_UID, message: '503' })
      );
      consoleError.mockRestore();
    });

    it('counts every member of a group without voting enabled, as ITX does', async () => {
      getCommitteeDetail.mockReturnValue(of({ uid: COMMITTEE_UID, enable_voting: false }));
      getCommitteeMembers.mockReturnValue(of(members(3, CommitteeMemberVotingStatus.NONE)));
      const fixture = await createFilled();

      expect(fixture.componentInstance.eligibleVoterCountState()).toEqual({ status: 'loaded', count: 3 });
      expect(fixture.componentInstance.canGoNext()).toBe(true);
    });

    it('blocks Next while the count is loading', async () => {
      getCommitteeMembers.mockReturnValue(new Subject<CommitteeMember[]>().asObservable());
      const fixture = await createFilled();

      expect(fixture.componentInstance.eligibleVoterCountState().status).toBe('loading');
      expect(fixture.componentInstance.canGoNext()).toBe(false);
    });

    it('never fetches members for a plurality vote', async () => {
      const fixture = await createFilled(PollType.GENERIC);

      expect(getCommitteeMembers).not.toHaveBeenCalled();
      expect(fixture.componentInstance.eligibleVoterCountState().status).toBe('idle');
      expect(fixture.componentInstance.canGoNext()).toBe(true);
    });

    it('refuses to open a new Condorcet vote below the minimum but still saves a draft', async () => {
      getCommitteeMembers.mockReturnValue(of(members(2)));
      const fixture = await createFilled();

      fixture.componentInstance.onSubmit();
      expect(voteServiceMock.beginSpeculativeCreate).not.toHaveBeenCalled();
      expect(capturedConfirmation).toBeNull();

      fixture.componentInstance.onSaveAsDraft();
      expect(voteServiceMock.createVote).toHaveBeenCalledWith(expect.objectContaining({ poll_type: PollType.CONDORCET_IRV }));
      expect(voteServiceMock.confirmSpeculativeVote).not.toHaveBeenCalled();
    });

    it('refuses to open an existing Condorcet draft below the minimum but still saves edits', async () => {
      getCommitteeMembers.mockReturnValue(of(members(2)));
      setRouteMode(VOTE_UID);
      fetchVote.mockReturnValue(of(rankedVote()));
      const fixture = await createComponent();

      fixture.componentInstance.onSubmit();
      expect(voteServiceMock.beginSpeculativeCreate).not.toHaveBeenCalled();
      expect(capturedConfirmation).toBeNull();

      fixture.componentInstance.onSaveAsDraft();
      expect(voteServiceMock.updateVote).toHaveBeenCalledTimes(1);
      expect(voteServiceMock.enableVote).not.toHaveBeenCalled();
      expect(voteServiceMock.createVote).not.toHaveBeenCalled();
    });
  });
});
