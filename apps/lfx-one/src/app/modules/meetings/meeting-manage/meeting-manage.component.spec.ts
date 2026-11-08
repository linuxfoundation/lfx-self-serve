// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, NavigationEnd, Router } from '@angular/router';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { CancelOnCommitteeRemoval, MeetingType, MeetingVisibility } from '@lfx-one/shared/enums';
import { Meeting } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, NEVER, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { MeetingManageComponent } from './meeting-manage.component';
import { MeetingCommitteeManagerComponent } from '../components/meeting-committee-manager/meeting-committee-manager.component';

// Regression coverage for the relation-gated-null → uncached-detail context fallback (GH-1579):
// when the by-uid project lookup is relation-gated into null for an organizer without a viewer
// relation, the meeting detail is re-fetched uncached so its ungated enrichment can supply the
// project the lookup withheld. Also pins the retry-once guard (a fresh fetch must not repeat on
// every NavigationEnd step navigation) and the transient-error retry release.
// The nested "owner payload" describe pins the meeting-owner include/omit contract (GH-1673).
describe('MeetingManageComponent', () => {
  const MEETING_UID = 'meeting-uid-1';
  const PROJECT_UID = 'project-uid-1';
  const PROJECT_SLUG = 'test-project';

  let getMeetingDetail: Mock;
  let getProject: Mock;
  let messageAdd: Mock;
  let navigate: Mock;
  let routerEvents$: BehaviorSubject<NavigationEnd>;
  let setProject: Mock;

  // Unenriched detail payload: project_uid only, no project_slug — the trigger condition for
  // initMeetingContextFallback. Note `id` (not just `uid`): meetingEntityContext keys off
  // `meeting.id`, so a stub without it never reaches the fallback.
  const unenrichedMeeting = () =>
    ({
      id: MEETING_UID,
      uid: MEETING_UID,
      project_uid: PROJECT_UID,
      committees: [],
    }) as unknown as Meeting;

  const enrichedMeeting = () =>
    ({
      ...unenrichedMeeting(),
      project_slug: PROJECT_SLUG,
      project_name: 'Test Project',
      is_foundation: false,
    }) as unknown as Meeting;

  const createComponent = async () => {
    const fixture = TestBed.createComponent(MeetingManageComponent);
    // No fixture.detectChanges(): these tests exercise the constructor context-sync streams, not
    // the template, and rendering would pull in the full PrimeNG stepper subtree for no signal.
    await TestBed.inject(ApplicationRef).whenStable();
    return fixture;
  };

  const emitNavigationEnd = async () => {
    routerEvents$.next(new NavigationEnd(1, '/project/meetings/x/edit?step=2', '/project/meetings/x/edit?step=2'));
    await TestBed.inject(ApplicationRef).whenStable();
  };

  const skipCacheCalls = () => getMeetingDetail.mock.calls.filter(([, opts]) => (opts as { skipCache?: boolean } | undefined)?.skipCache === true);

  beforeEach(() => {
    getMeetingDetail = vi.fn();
    getProject = vi.fn();
    messageAdd = vi.fn();
    navigate = vi.fn();
    setProject = vi.fn();
    routerEvents$ = new BehaviorSubject<NavigationEnd>(new NavigationEnd(0, '/project/meetings/x/edit', '/project/meetings/x/edit'));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            events: routerEvents$.asObservable(),
            url: '/project/meetings/x/edit',
            parseUrl: vi.fn().mockReturnValue({ queryParams: {} }),
            serializeUrl: vi.fn().mockReturnValue('/project/meetings/x/edit'),
            navigate,
            // evictOnWriteAccessLoss navigates via navigateByUrl when the loaded meeting's
            // project resolves without write access (getProject → null in these tests).
            navigateByUrl: vi.fn(),
            createUrlTree: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: MEETING_UID })),
            queryParamMap: of(convertToParamMap({})),
            snapshot: { queryParamMap: convertToParamMap({}), paramMap: convertToParamMap({ id: MEETING_UID }) },
          },
        },
        {
          provide: MeetingService,
          useValue: {
            // initializeMeeting probes via getMeeting; the fallback re-fetches via getMeetingDetail
            // with skipCache — both land on the same mock so call ordering stays inspectable.
            getMeeting: vi.fn().mockImplementation((id: string) => getMeetingDetail(id)),
            getMeetingDetail,
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
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
        { provide: CommitteeService, useValue: { getCommittee: vi.fn().mockReturnValue(of(null)), fetchCommittee: vi.fn().mockReturnValue(of(null)) } },
        // Transitive DI (LensService → PersonaService → HttpClient) — never called in these tests.
        { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of(null)), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
        // PrimeNG stepper binds @content.start animation listeners when the template is compiled —
        // required even without detectChanges(), since compilation alone wires the listener.
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    });
  });

  // Pins the create-mode access defaults (private + restricted) and the Board-type reaffirm
  // behavior, independent of the edit-mode hydration the rest of this file exercises. Reconfigures
  // ActivatedRoute with no `id` param so the component takes the create-mode branch.
  describe('create-mode access defaults', () => {
    const createNewComponent = async () => {
      TestBed.configureTestingModule({
        providers: [
          {
            provide: ActivatedRoute,
            useValue: {
              paramMap: of(convertToParamMap({})),
              queryParamMap: of(convertToParamMap({})),
              snapshot: { queryParamMap: convertToParamMap({}), paramMap: convertToParamMap({}) },
            },
          },
        ],
      });
      getProject.mockReturnValue(of(null));
      return createComponent();
    };

    it('defaults a new meeting to private and restricted', async () => {
      const fixture = await createNewComponent();
      const form = fixture.componentInstance.form();
      expect(form.get('visibility')?.value).toBe(MeetingVisibility.PRIVATE);
      expect(form.get('restricted')?.value).toBe(true);
    });

    it('keeps private and restricted after selecting Board, then moving away from it', async () => {
      const fixture = await createNewComponent();
      const form = fixture.componentInstance.form();
      form.get('meeting_type')?.setValue(MeetingType.BOARD);
      form.get('meeting_type')?.setValue(MeetingType.TECHNICAL);
      expect(form.get('visibility')?.value).toBe(MeetingVisibility.PRIVATE);
      expect(form.get('restricted')?.value).toBe(true);
    });

    it('resets manually-loosened access back to private and restricted on leaving Board', async () => {
      const fixture = await createNewComponent();
      const form = fixture.componentInstance.form();
      form.get('meeting_type')?.setValue(MeetingType.BOARD);
      // The organizer explicitly loosens access while still on Board.
      form.patchValue({ visibility: MeetingVisibility.PUBLIC, restricted: false });

      form.get('meeting_type')?.setValue(MeetingType.TECHNICAL);

      expect(form.get('visibility')?.value).toBe(MeetingVisibility.PRIVATE);
      expect(form.get('restricted')?.value).toBe(true);
    });

    it('does not touch visibility or restricted when changing type in edit mode', async () => {
      getMeetingDetail.mockReturnValue(of(unenrichedMeeting()));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();
      const form = fixture.componentInstance.form();
      // Simulates an organizer's saved public/unrestricted meeting -- hydration already set
      // these; patched again here only to make the starting point explicit for the assertion.
      form.patchValue({ visibility: MeetingVisibility.PUBLIC, restricted: false });

      form.get('meeting_type')?.setValue(MeetingType.BOARD);
      form.get('meeting_type')?.setValue(MeetingType.TECHNICAL);

      expect(form.get('visibility')?.value).toBe(MeetingVisibility.PUBLIC);
      expect(form.get('restricted')?.value).toBe(false);
    });
  });

  describe('committee roster readiness', () => {
    const mountReadyForm = async () => {
      getMeetingDetail.mockReturnValue(of(unenrichedMeeting()));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();
      const component = fixture.componentInstance;
      const form = component.form();
      Object.values(form.controls).forEach((control) => {
        control.clearValidators();
        control.updateValueAndValidity({ emitEvent: false });
      });
      form.clearValidators();
      form.updateValueAndValidity({ emitEvent: false });
      const updateMeeting = vi.fn().mockReturnValue(NEVER);
      Object.assign(TestBed.inject(MeetingService), { updateMeeting });
      vi.spyOn(component as any, 'prepareMeetingData').mockReturnValue({});
      vi.spyOn(component as any, 'buildRegistrantOperations').mockReturnValue([]);
      vi.spyOn(component as any, 'processAttachmentOperations').mockReturnValue(of(null));
      return { component, form, updateMeeting };
    };

    it('blocks a pending or failed selected roster and permits saving after successful retry coverage', async () => {
      const { component, form, updateMeeting } = await mountReadyForm();
      form.get('committees')!.setValue([{ uid: 'group-a' }]);
      component.onSubmitAll();
      expect(updateMeeting).not.toHaveBeenCalled();
      expect(component.submitting()).toBe(false);

      // A failed strict fetch emits no coverage; even unrelated coverage must not unlock Save.
      component.onCommitteeMembersResolved([]);
      component.onSubmitAll();
      expect(updateMeeting).not.toHaveBeenCalled();

      component.onCommitteeMembersResolved(['group-a']);
      expect(component.committeeMembersReady()).toBe(true);
      component.onSubmitAll();
      expect(updateMeeting).toHaveBeenCalledTimes(1);
    });

    it('invalidates previous coverage on selection changes, including returning to an earlier selection', async () => {
      const { component, form, updateMeeting } = await mountReadyForm();
      form.get('committees')!.setValue([{ uid: 'group-a' }]);
      component.onCommitteeMembersResolved(['group-a']);
      form.get('committees')!.setValue([{ uid: 'group-b' }]);
      expect(component.committeeMembersReady()).toBe(false);
      form.get('committees')!.setValue([{ uid: 'group-a' }]);
      component.onSubmitAll();
      expect(updateMeeting).not.toHaveBeenCalled();
      component.onCommitteeMembersResolved(['group-b']);
      expect(component.committeeMembersReady()).toBe(false);
    });

    it('preserves readiness when options retry rewrites the same selected roster', async () => {
      const { component, form } = await mountReadyForm();
      const group = { uid: 'group-a', name: 'Example Group', enable_voting: false };
      const committeeService = TestBed.inject(CommitteeService);
      Object.assign(committeeService, {
        getCommitteesByProjectOrThrow: vi
          .fn()
          .mockReturnValueOnce(throwError(() => new Error('options unavailable')))
          .mockReturnValue(of([group])),
        getCommitteeMembers: vi.fn().mockReturnValue(of([])),
      });
      Object.assign(TestBed.inject(ProjectContextService), { activeContextUid: () => PROJECT_UID });
      form.get('committees')!.setValue([{ uid: group.uid }]);
      const pickerFixture = TestBed.createComponent(MeetingCommitteeManagerComponent);
      pickerFixture.componentRef.setInput('form', form);
      pickerFixture.componentRef.setInput('selectedCommittees', [{ uid: group.uid }]);
      pickerFixture.componentInstance.committeeMembersResolvedChange.subscribe((uids) => component.onCommitteeMembersResolved(uids));
      await pickerFixture.whenStable();
      expect(pickerFixture.componentInstance.committeeOptionsFailed()).toBe(true);
      expect(component.committeeMembersReady()).toBe(true);
      pickerFixture.componentInstance.retryCommitteeOptions();
      await pickerFixture.whenStable();
      expect(pickerFixture.componentInstance.committeeOptionsFailed()).toBe(false);
      expect(component.committeeMembersReady()).toBe(true);
      expect(committeeService.getCommitteeMembers).toHaveBeenCalledTimes(1);
    });

    it('ignores equivalent group/filter writes but invalidates real filter changes and pending reports', async () => {
      const { component, form } = await mountReadyForm();
      form.get('committees')!.setValue([{ uid: 'group-a', allowed_voting_statuses: ['voting_rep', 'observer'] }, { uid: 'group-b' }]);
      component.onCommitteeMembersResolved(['group-a', 'group-b']);
      form.get('committees')!.setValue([{ uid: 'group-b' }, { uid: 'group-a', name: 'New label', allowed_voting_statuses: ['Observer', 'Voting Rep'] }]);
      expect(component.committeeMembersReady()).toBe(true);
      form.get('committees')!.setValue([{ uid: 'group-b' }, { uid: 'group-a', allowed_voting_statuses: ['observer'] }]);
      expect(component.committeeMembersReady()).toBe(false);
      component.onCommitteeMembersResolved(['group-a', 'group-b']);
      component.onCommitteeMembersResolved(null);
      expect(component.committeeMembersReady()).toBe(false);
    });

    it('waits for empty-selection reconciliation and guards invitation-only submits too', async () => {
      const { component, form, updateMeeting } = await mountReadyForm();
      form.get('committees')!.setValue([{ uid: 'group-a' }]);
      component.onCommitteeMembersResolved(['group-a']);
      form.get('committees')!.setValue([]);
      expect(component.committeeMembersReady()).toBe(false);
      const operations = vi.mocked((component as any).buildRegistrantOperations);
      component.onManageRegistrants();
      expect(operations).not.toHaveBeenCalled();
      component.onSubmitAll();
      expect(updateMeeting).not.toHaveBeenCalled();

      component.onCommitteeMembersResolved([]);
      expect(component.committeeMembersReady()).toBe(true);
      component.onManageRegistrants();
      expect(operations).toHaveBeenCalledTimes(1);
    });
  });

  it('resolves context from a fresh uncached detail fetch when the uid lookup is relation-gated to null', async () => {
    getMeetingDetail.mockImplementation((_uid: string, opts?: { skipCache?: boolean }) => (opts?.skipCache ? of(enrichedMeeting()) : of(unenrichedMeeting())));
    getProject.mockReturnValue(of(null));
    await createComponent();

    // The uid lookup returned null, so the fallback re-fetched the detail uncached and resolved
    // the context from its (ungated) enrichment.
    expect(getMeetingDetail).toHaveBeenCalledWith(MEETING_UID, { skipCache: true });
    expect(setProject).toHaveBeenCalledWith({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG }, false);
  });

  it('does not repeat the fresh fetch when NavigationEnd re-applies the fallback for the same meeting', async () => {
    getMeetingDetail.mockImplementation((_uid: string, opts?: { skipCache?: boolean }) => (opts?.skipCache ? of(enrichedMeeting()) : of(unenrichedMeeting())));
    getProject.mockReturnValue(of(null));
    await createComponent();

    const callsBefore = getMeetingDetail.mock.calls.length;
    await emitNavigationEnd();
    await emitNavigationEnd();

    // The fallback already resolved the context for this meeting, so step navigations must not
    // burn another uncached fetch.
    expect(skipCacheCalls()).toHaveLength(1);
    expect(getMeetingDetail.mock.calls.length).toBe(callsBefore);
  });

  it('releases the retry marker when the fresh fetch fails transiently, so a later navigation can retry', async () => {
    let failFreshFetch = false;
    getMeetingDetail.mockImplementation((_uid: string, opts?: { skipCache?: boolean }) => {
      if (!opts?.skipCache) {
        return of(unenrichedMeeting());
      }
      return failFreshFetch ? throwError(() => new Error('network')) : of(enrichedMeeting());
    });
    getProject.mockReturnValue(of(null));
    failFreshFetch = true;
    await createComponent();

    // Every fresh fetch so far failed transiently (the seeded initial NavigationEnd plus the
    // entity emission can each trigger one) — context untouched, marker released each time.
    const failedAttempts = skipCacheCalls().length;
    expect(failedAttempts).toBeGreaterThan(0);
    expect(setProject).not.toHaveBeenCalled();

    // …so the next NavigationEnd re-apply attempts the fresh fetch again and now resolves.
    failFreshFetch = false;
    await emitNavigationEnd();
    expect(skipCacheCalls().length).toBeGreaterThan(failedAttempts);
    expect(setProject).toHaveBeenCalledWith({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG }, false);
  });

  // GH-2037: the edit-mode detail fetch is load-bearing (it pre-populates the form) — a
  // transient failure stays mounted with the inline error + Retry; only a 404/403 ejects.
  describe('edit-mode load failure (GH-2037)', () => {
    const httpError = (status: number) => new HttpErrorResponse({ status });

    it('stays mounted with the inline error state on a transient failure', async () => {
      getMeetingDetail.mockReturnValue(throwError(() => httpError(500)));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();
      const component = fixture.componentInstance;

      expect(component.meetingLoadError()).toBe(true);
      // The error state is not "loading": the template's @if ordering already kept the skeleton
      // hidden, and the computed now excludes the error state outright.
      expect(component.meetingLoading()).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(messageAdd).not.toHaveBeenCalled();
    });

    it('re-fetches the meeting and clears the error state on retryMeetingLoad', async () => {
      let fail = true;
      getMeetingDetail.mockImplementation(() => (fail ? throwError(() => httpError(500)) : of(enrichedMeeting())));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();
      const component = fixture.componentInstance;
      expect(component.meetingLoadError()).toBe(true);
      const callsBefore = getMeetingDetail.mock.calls.length;

      fail = false;
      component.retryMeetingLoad();
      await TestBed.inject(ApplicationRef).whenStable();

      expect(getMeetingDetail.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(component.meetingLoadError()).toBe(false);
      expect(component.meeting()?.id).toBe(MEETING_UID);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('ejects with the not-found toast on a real 404', async () => {
      getMeetingDetail.mockReturnValue(throwError(() => httpError(404)));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();

      expect(fixture.componentInstance.meetingLoadError()).toBe(false);
      expect(messageAdd).toHaveBeenCalledWith({
        severity: 'error',
        summary: 'Error',
        detail: 'Meeting not found or you do not have permission to access it',
      });
      expect(navigate).toHaveBeenCalledWith(['/', 'meetings']);
    });

    it('ejects with the permission toast on a 403 — Retry cannot restore guard-owned access', async () => {
      getMeetingDetail.mockReturnValue(throwError(() => httpError(403)));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();

      expect(fixture.componentInstance.meetingLoadError()).toBe(false);
      expect(messageAdd).toHaveBeenCalledWith({
        severity: 'error',
        summary: 'Error',
        detail: 'Meeting not found or you do not have permission to access it',
      });
      expect(navigate).toHaveBeenCalledWith(['/', 'meetings']);
    });
  });

  // initWriteAccess's tri-state project leg (meetingWriteAccessState) must not collapse an
  // unconfirmed lookup into a denial and evict a legitimate meeting coordinator mid-form
  // (linuxfoundation/lfx-self-serve-ops#500). A plain Subject (not of()) defers each project
  // resolution past the provisional-true boot emission — a synchronous mock resolves the whole
  // chain in the first effect pass, and evictOnWriteAccessLoss's skip(1) would swallow the
  // transition before the test could observe it (see vote-manage.component.spec.ts's analogous
  // eviction test for the same reasoning).
  describe('write-access eviction (linuxfoundation/lfx-self-serve-ops#500)', () => {
    let project$: Subject<{ writer: boolean; meetingCoordinator?: boolean } | null>;

    beforeEach(() => {
      project$ = new Subject();
      getMeetingDetail.mockReturnValue(of(enrichedMeeting()));
      getProject.mockReturnValue(project$.asObservable());
    });

    it('does not evict when the BFF omits meetingCoordinator — its own FGA check failed, not a confirmed denial', async () => {
      const router = TestBed.inject(Router);
      await createComponent();

      project$.next({ writer: false, meetingCoordinator: undefined });
      await TestBed.inject(ApplicationRef).whenStable();

      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('does not evict when the project lookup errors transiently', async () => {
      const router = TestBed.inject(Router);
      await createComponent();

      project$.error(new Error('network'));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('still evicts once write access is confirmedly denied', async () => {
      const router = TestBed.inject(Router);
      await createComponent();

      project$.next({ writer: false, meetingCoordinator: false });
      await TestBed.inject(ApplicationRef).whenStable();

      expect(router.navigateByUrl).toHaveBeenCalled();
    });
  });

  // GH-1673: prepareOwnerData / syncHydratedOwnerFromForm are private but carry the owner
  // include/omit contract — re-sending an unchanged owner would replace the stored object
  // upstream and drop its profile_picture — so they get direct component-level coverage
  // rather than relying only on the (skippable) e2e suite.
  describe('owner payload (GH-1673)', () => {
    const HYDRATED = { username: 'ghopper', name: 'Grace Hopper', email: 'grace@example.com' };

    const createOwnerComponent = async () => {
      getMeetingDetail.mockReturnValue(of(unenrichedMeeting()));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();
      // Private-member access is deliberate: the omit rule is the unit under test.
      return fixture.componentInstance as any;
    };

    it('omits owner when every control is empty or whitespace', async () => {
      const component = await createOwnerComponent();
      expect(component.prepareOwnerData({ ownerUsername: null, ownerName: '', ownerEmail: '   ' })).toEqual({});
    });

    it('omits owner when the trimmed values still match the hydrated owner', async () => {
      const component = await createOwnerComponent();
      component.hydratedOwner.set({ ...HYDRATED });
      expect(component.prepareOwnerData({ ownerUsername: ' ghopper ', ownerName: 'Grace Hopper', ownerEmail: 'grace@example.com' })).toEqual({});
    });

    it('includes only the non-empty owner fields when the selection changed', async () => {
      const component = await createOwnerComponent();
      component.hydratedOwner.set({ ...HYDRATED });
      // Manual-entry shape: no username — the key must not appear as an empty string.
      expect(component.prepareOwnerData({ ownerUsername: '', ownerName: 'Radia Perlman', ownerEmail: 'radia@example.com' })).toEqual({
        owner: { name: 'Radia Perlman', email: 'radia@example.com' },
      });
    });

    it('omits owner after a revert-to-saved brings the picker back in line with the hydrated owner', async () => {
      // Mirrors the organizer picker's revert affordance: the wizard patches the owner controls
      // back to the saved baseline (meeting-details.component.ts's revertOwnerToSaved), and the
      // next save must see no diff against hydratedOwner — same contract as an untouched picker.
      const component = await createOwnerComponent();
      component.hydratedOwner.set({ ...HYDRATED });
      component.form().patchValue({ ownerUsername: 'someone-else', ownerName: 'Someone Else', ownerEmail: 'someone@example.com' });
      expect(component.prepareOwnerData(component.form().getRawValue())).toEqual({
        owner: { username: 'someone-else', name: 'Someone Else', email: 'someone@example.com' },
      });

      component.form().patchValue({ ownerUsername: HYDRATED.username, ownerName: HYDRATED.name, ownerEmail: HYDRATED.email });
      expect(component.prepareOwnerData(component.form().getRawValue())).toEqual({});
    });

    it('re-baselines on syncHydratedOwnerFromForm so a repeat save omits the unchanged owner', async () => {
      const component = await createOwnerComponent();
      component.form().patchValue({ ownerUsername: HYDRATED.username, ownerName: HYDRATED.name, ownerEmail: HYDRATED.email });

      // First save sends the owner (nothing hydrated yet)…
      expect(component.prepareOwnerData(component.form().getRawValue())).toEqual({ owner: { ...HYDRATED } });

      // …the success handler re-baselines…
      component.syncHydratedOwnerFromForm();

      // …so an untouched second save omits the key (upstream keeps the enriched stored owner).
      expect(component.prepareOwnerData(component.form().getRawValue())).toEqual({});
    });

    it('keeps the previous baseline when the form is empty — that save omitted the key, so the stored owner is unchanged', async () => {
      const component = await createOwnerComponent();
      component.hydratedOwner.set({ ...HYDRATED });
      component.syncHydratedOwnerFromForm();
      expect(component.hydratedOwner()).toEqual(HYDRATED);
    });
  });

  // Pins the stale-value fix: hiding the override control (private meeting, or no linked
  // committees) must not let a previously-chosen cancel/keep value leak into the save payload.
  describe('cancel_on_committee_removal payload gating', () => {
    const createPayloadComponent = async () => {
      getMeetingDetail.mockReturnValue(of(unenrichedMeeting()));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();
      return fixture.componentInstance as any;
    };

    it('preserves an explicit cancel/keep override on a public meeting with a linked committee', async () => {
      const component = await createPayloadComponent();
      component.form().patchValue({
        visibility: MeetingVisibility.PUBLIC,
        committees: [{ uid: 'committee-1' }],
        cancel_on_committee_removal: CancelOnCommitteeRemoval.CANCEL,
      });
      expect(component.prepareMeetingData().cancel_on_committee_removal).toBe(CancelOnCommitteeRemoval.CANCEL);
    });

    it('forces inherit when the meeting is private, even if a stale override value remains in the form', async () => {
      const component = await createPayloadComponent();
      component.form().patchValue({
        visibility: MeetingVisibility.PRIVATE,
        committees: [{ uid: 'committee-1' }],
        cancel_on_committee_removal: CancelOnCommitteeRemoval.CANCEL,
      });
      expect(component.prepareMeetingData().cancel_on_committee_removal).toBe(CancelOnCommitteeRemoval.INHERIT);
    });

    it('forces inherit when no committee is linked, even if a stale override value remains in the form', async () => {
      const component = await createPayloadComponent();
      component.form().patchValue({
        visibility: MeetingVisibility.PUBLIC,
        committees: [],
        cancel_on_committee_removal: CancelOnCommitteeRemoval.KEEP,
      });
      expect(component.prepareMeetingData().cancel_on_committee_removal).toBe(CancelOnCommitteeRemoval.INHERIT);
    });
  });

  // GH-1796: the mapper specs cover the helpers in isolation; this pins the save-boundary wiring so
  // dropping the normalization from prepareMeetingData() fails here instead of silently regressing.
  describe('committees voting-status normalization (GH-1796)', () => {
    const createPayloadComponent = async () => {
      getMeetingDetail.mockReturnValue(of(unenrichedMeeting()));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();
      return fixture.componentInstance as any;
    };

    it('resubmits legacy display statuses in the meeting API snake_case vocabulary', async () => {
      const component = await createPayloadComponent();
      component.form().patchValue({
        committees: [{ uid: 'committee-1', name: 'TSC', allowed_voting_statuses: ['Voting Rep', 'Alternate Voting Rep', 'Observer'] }],
      });
      expect(component.prepareMeetingData().committees).toEqual([
        { uid: 'committee-1', name: 'TSC', allowed_voting_statuses: ['voting_rep', 'alt_voting_rep', 'observer'] },
      ]);
    });
  });

  describe('show_meeting_attendees lock', () => {
    it('disables and clears the toggle when meeting type is Board', async () => {
      getMeetingDetail.mockReturnValue(of(unenrichedMeeting()));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();
      const form = fixture.componentInstance.form();
      form.get('show_meeting_attendees')?.setValue(true);
      form.get('meeting_type')?.setValue(MeetingType.BOARD);
      await TestBed.inject(ApplicationRef).whenStable();
      expect(form.get('show_meeting_attendees')?.disabled).toBe(true);
      expect(form.get('show_meeting_attendees')?.value).toBe(false);
    });

    it('includes show_meeting_attendees in the save payload', async () => {
      getMeetingDetail.mockReturnValue(of(unenrichedMeeting()));
      getProject.mockReturnValue(of(null));
      const component = (await createComponent()).componentInstance as any;
      component.form().get('meeting_type')?.setValue('Technical');
      component.form().get('restricted')?.setValue(false);
      component.form().get('show_meeting_attendees')?.enable();
      component.form().get('show_meeting_attendees')?.setValue(true);
      expect(component.prepareMeetingData().show_meeting_attendees).toBe(true);
    });

    it('persists false after a hydrated true meeting is re-typed as Board', async () => {
      getMeetingDetail.mockReturnValue(
        of({
          ...unenrichedMeeting(),
          show_meeting_attendees: true,
          meeting_type: 'Technical',
          restricted: false,
          start_time: '2099-01-01T00:00:00.000Z',
          duration: 60,
          timezone: 'UTC',
          title: 'Test',
        } as Meeting)
      );
      getProject.mockReturnValue(of(null));
      const component = (await createComponent()).componentInstance as any;
      await TestBed.inject(ApplicationRef).whenStable();
      component.form().get('meeting_type')?.setValue(MeetingType.BOARD);
      await TestBed.inject(ApplicationRef).whenStable();
      expect(component.prepareMeetingData().show_meeting_attendees).toBe(false);
    });
  });
  /**
   * Covers what this page hands the group picker as the organizer's saved sharing decision.
   * @description The picker cannot work this out for itself — it mounts on `meetingId()` against a
   * form that is still empty and unlocked — so the whole guarantee rests on this computed being
   * wired to the meeting rather than to the form.
   */
  describe('saved attendee visibility passed to the group picker', () => {
    const meetingWith = (overrides: Partial<Meeting>) =>
      ({
        ...unenrichedMeeting(),
        meeting_type: MeetingType.TECHNICAL,
        restricted: false,
        ...overrides,
      }) as Meeting;

    const resolveFor = async (meeting: Meeting | null) => {
      getMeetingDetail.mockReturnValue(meeting ? of(meeting) : NEVER);
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();
      return fixture.componentInstance.savedAttendeeVisibility();
    };

    it('reports no decision while the meeting is still loading', async () => {
      expect(await resolveFor(null)).toBeNull();
    });

    it('reports no decision for a board meeting carrying a stale opt-in', async () => {
      // The legacy `true` predates the lock and hydration shows the toggle off, so switching the
      // meeting to an unlocked type must not resurrect it.
      expect(await resolveFor(meetingWith({ meeting_type: MeetingType.BOARD, show_meeting_attendees: true }))).toBeNull();
    });

    it('reports no decision for a restricted meeting', async () => {
      expect(await resolveFor(meetingWith({ restricted: true, show_meeting_attendees: true }))).toBeNull();
    });

    it('reports an opt-out for a meeting whose flag the API omitted', async () => {
      // Omission is how a stored-off meeting arrives — reading it as undecided would let a group
      // default turn sharing back on behind the organizer.
      expect(await resolveFor(meetingWith({ show_meeting_attendees: undefined }))).toBe(false);
    });

    it('reports the saved opt-in of an unlocked meeting', async () => {
      expect(await resolveFor(meetingWith({ show_meeting_attendees: true }))).toBe(true);
    });
  });
});
