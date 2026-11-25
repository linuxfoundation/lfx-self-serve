// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, NavigationEnd, Router } from '@angular/router';
import { CommitteeMemberImportService } from '@services/committee-member-import.service';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '@lfx-one/shared/enums';
import {
  Committee,
  CommitteeMember,
  MemberImportRow,
  MemberImportStagedRunInput,
  MemberPendingChanges,
  PersonaType,
  Project,
  StagedCommitteeMemberRequest,
} from '@lfx-one/shared/interfaces';
import { classifyMemberImportBulkResult } from '@lfx-one/shared/utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, defer, EMPTY, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeManageComponent } from './committee-manage.component';
import { CommitteeMembersManagerComponent } from '../components/committee-members-manager/committee-members-manager.component';
import { MemberFormComponent } from '../components/member-form/member-form.component';

/** State-only save tests keep the real forms, signals and service orchestration without rendering children. */
@Component({ selector: 'lfx-committee-manage-state-only', template: '' })
class StateOnlyCommitteeManageComponent extends CommitteeManageComponent {}

// Regression coverage for the committee edit context-correction flow (GH-1566): an edit payload
// must select the COMMITTEE's project/tier (not the cookie-restored last-visited project), the
// by-uid fallback must apply when enrichment withholds project_slug, the write-access leg must
// stay provisionally true while pending so it cannot evict a guard-admitted user mid-edit, and
// step navigation must merge query params so ?project= survives. The harness drives the
// constructor context-sync streams only — no detectChanges, no template rendering.
describe('CommitteeManageComponent', () => {
  const COMMITTEE_UID = 'committee-uid-1';
  const PROJECT_UID = 'project-uid-1';
  const PROJECT_SLUG = 'committee-project';
  const STALE_SLUG = 'stale-project';

  let getCommittee: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let setProject: ReturnType<typeof vi.fn>;
  let setFoundation: ReturnType<typeof vi.fn>;
  let setRouteLensKind: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let routerEvents$: BehaviorSubject<NavigationEnd>;
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let activeContext: ReturnType<typeof signal<{ uid: string; slug: string; name: string } | null>>;
  let currentPersona: ReturnType<typeof signal<PersonaType>>;
  let personaLoaded: ReturnType<typeof signal<boolean>>;
  let createCommittee: ReturnType<typeof vi.fn>;
  let runStaged: ReturnType<typeof vi.fn>;
  let importOwner: ReturnType<typeof signal<string | null>>;

  // Enriched detail payload: project_slug + is_foundation populated by the BFF — drives
  // syncEntityProjectContext directly. Unenriched: project_uid only — triggers the by-uid
  // fallback in initCommitteeContextFallback.
  const enrichedCommittee = (isFoundation = false) =>
    ({
      uid: COMMITTEE_UID,
      project_uid: PROJECT_UID,
      project_slug: PROJECT_SLUG,
      project_name: 'Test Project',
      is_foundation: isFoundation,
      name: 'TSC',
      category: 'Technical Steering Committee',
    }) as unknown as Committee;

  const unenrichedCommittee = () =>
    ({
      uid: COMMITTEE_UID,
      project_uid: PROJECT_UID,
      name: 'TSC',
      category: 'Technical Steering Committee',
    }) as unknown as Committee;

  // Minimal project payload: no foundation markers, so computeIsFoundation resolves false.
  const resolvedProject = () => ({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG, writer: true }) as unknown as Project;

  const createComponent = async () => {
    const fixture = TestBed.createComponent(CommitteeManageComponent);
    // No fixture.detectChanges(): these tests exercise the constructor context-sync streams, not
    // the template, and rendering would pull in the full PrimeNG stepper subtree for no signal.
    await TestBed.inject(ApplicationRef).whenStable();
    return fixture;
  };

  beforeEach(() => {
    getCommittee = vi.fn();
    createCommittee = vi.fn();
    runStaged = vi.fn(() => EMPTY);
    importOwner = signal<string | null>('synthetic-manager');
    currentPersona = signal<PersonaType>('maintainer');
    personaLoaded = signal(true);
    getProject = vi.fn().mockReturnValue(of(resolvedProject()));
    setProject = vi.fn();
    setFoundation = vi.fn();
    setRouteLensKind = vi.fn();
    navigate = vi.fn();
    navigateByUrl = vi.fn();
    routerEvents$ = new BehaviorSubject<NavigationEnd>(new NavigationEnd(0, '/project/groups/x/edit', '/project/groups/x/edit'));
    queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
    activeContext = signal({ uid: 'stale-uid', slug: STALE_SLUG, name: 'Stale Project' });

    // Rendered step panels instantiate child components whose constructors fetch — stub the
    // ones reachable in these tests (zoneless signal writes schedule a change-detection tick
    // that whenStable() then waits on).
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            events: routerEvents$.asObservable(),
            url: '/project/groups/x/edit',
            parseUrl: vi.fn().mockReturnValue({ queryParams: {} }),
            serializeUrl: vi.fn().mockReturnValue('/project/groups/x/edit'),
            navigate,
            navigateByUrl,
            createUrlTree: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: COMMITTEE_UID })),
            queryParamMap: queryParamMap$.asObservable(),
            snapshot: { queryParamMap: convertToParamMap({}), paramMap: convertToParamMap({ id: COMMITTEE_UID }) },
          },
        },
        { provide: CommitteeService, useValue: { getCommittee, createCommittee, getCommitteesByProject: vi.fn().mockReturnValue(of([])) } },
        { provide: ProjectService, useValue: { getProject, project: signal(null) } },
        {
          provide: ProjectContextService,
          useValue: {
            activeContext,
            activeContextUid: () => 'stale-uid',
            isFoundationContext: () => false,
            canWrite: signal(true),
            setProject,
            setFoundation,
            setRouteLensKind,
          },
        },
        // evictOnWriteAccessLoss injects these directly — mocked so no transitive HttpClient chain.
        { provide: PersonaService, useValue: { currentPersona, personaLoaded } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        // The rendered members manager reads the signed-in user for "Add myself".
        { provide: UserService, useValue: { user: signal(null) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        // CSV wizard additions save through the import service's bulk run (#5529).
        { provide: CommitteeMemberImportService, useValue: { runStaged, viewerSubject: importOwner } },
        // Real class, not a useValue fake — ConfirmDialog touches ConfirmationService's internal
        // Subjects in its constructor (same pattern as committee-settings-tab.component.spec.ts).
        ConfirmationService,
        // PrimeNG stepper binds animation listeners when the template is compiled — required even
        // without detectChanges(), since compilation alone wires the listener.
        provideNoopAnimations(),
      ],
    });

    // jsdom doesn't implement window.scrollTo (scrollToStepper) — stub to keep stderr clean.
    window.scrollTo = vi.fn();
  });

  it('selects the committee’s own project and tier from an enriched edit payload', async () => {
    getCommittee.mockReturnValue(of(enrichedCommittee(false)));
    await createComponent();

    expect(setRouteLensKind).toHaveBeenCalledWith('project');
    expect(setProject).toHaveBeenCalledWith({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG }, false);
    expect(setFoundation).not.toHaveBeenCalled();
  });

  it('prefers the committee’s own tier over the /project/* route prefix for a foundation-owned group', async () => {
    getCommittee.mockReturnValue(of(enrichedCommittee(true)));
    await createComponent();

    // preferEntityKind: a foundation-owned group edited under /project/groups/:id/edit must land
    // in the foundation slot and re-point the route lens kind, not follow the URL prefix.
    expect(setRouteLensKind).toHaveBeenCalledWith('foundation');
    expect(setFoundation).toHaveBeenCalledWith({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG }, false);
    expect(setProject).not.toHaveBeenCalled();
  });

  it('falls back to a by-uid project lookup when the payload lacks project_slug', async () => {
    getCommittee.mockReturnValue(of(unenrichedCommittee()));
    await createComponent();

    expect(getProject).toHaveBeenCalledWith(PROJECT_UID, false);
    expect(setProject).toHaveBeenCalledWith({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG }, false);
    expect(setRouteLensKind).toHaveBeenCalledWith('project');
  });

  it('does not evict while the committee — and therefore the write-access leg — is still pending', async () => {
    getCommittee.mockReturnValue(of(null));

    await createComponent();

    // The access leg never resolved (no committee → no project key), so it stayed provisionally
    // true and no project lookup or eviction navigation fired.
    expect(getProject).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('keys the write-access check off the committee’s own project, not the stale active context', async () => {
    getCommittee.mockReturnValue(of(enrichedCommittee(false)));
    await createComponent();

    // writerGuard authorized against the committee's project; the access leg must evaluate that
    // same target — never the cookie-restored stale context, whose false could win the race
    // against the context correction and evict the admitted user mid-edit.
    expect(getProject).toHaveBeenCalledWith(PROJECT_SLUG, false);
    expect(getProject).not.toHaveBeenCalledWith(STALE_SLUG, expect.anything());
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('merges query params on step navigation so ?project= survives', async () => {
    getCommittee.mockReturnValue(of(enrichedCommittee(false)));
    queryParamMap$.next(convertToParamMap({ step: '2', project: PROJECT_SLUG }));

    const fixture = await createComponent();

    fixture.componentInstance.previousStep();

    expect(navigate).toHaveBeenCalledWith([], { queryParams: { step: 1 }, queryParamsHandling: 'merge' });
  });

  it('loads the group’s stored Social Listening setting', async () => {
    getCommittee.mockReturnValue(of({ ...enrichedCommittee(), members_can_view_social_listening: true }));
    const fixture = await createComponent();

    expect(fixture.componentInstance.form.get('members_can_view_social_listening')?.value).toBe(true);
  });

  describe('category preselection from ?category=', () => {
    const useRoute = (params: Record<string, string>, query: Record<string, string>) =>
      TestBed.overrideProvider(ActivatedRoute, {
        useValue: {
          paramMap: of(convertToParamMap(params)),
          queryParamMap: of(convertToParamMap(query)),
          snapshot: { queryParamMap: convertToParamMap(query), paramMap: convertToParamMap(params) },
        },
      });

    it('preselects a category the persona can pick on the create route', async () => {
      useRoute({}, { project: PROJECT_SLUG, category: 'Newsletter' });
      const fixture = await createComponent();

      expect(fixture.componentInstance.form.get('category')?.value).toBe('Newsletter');
    });

    it('ignores a category outside the persona’s selectable set', async () => {
      useRoute({}, { project: PROJECT_SLUG, category: 'Board' });
      const fixture = await createComponent();

      expect(fixture.componentInstance.form.get('category')?.value).toBe('');
    });

    it('ignores the param on the edit route so it never overrides a saved category', async () => {
      getCommittee.mockReturnValue(of({ ...enrichedCommittee(), category: 'Board' }));
      useRoute({ id: COMMITTEE_UID }, { category: 'Newsletter' });
      const fixture = await createComponent();

      expect(fixture.componentInstance.form.get('category')?.value).toBe('Board');

      currentPersona.set('contributor');
      await TestBed.inject(ApplicationRef).whenStable();
      currentPersona.set('maintainer');
      await TestBed.inject(ApplicationRef).whenStable();
      expect(fixture.componentInstance.form.get('category')?.value).toBe('Board');
    });

    it('waits for detected persona and rejects a restricted URL category after Contributor becomes Maintainer', async () => {
      currentPersona.set('contributor');
      personaLoaded.set(false);
      useRoute({}, { category: 'Board' });
      const fixture = await createComponent();
      const component = fixture.componentInstance;

      expect(component.form.get('category')?.value).toBe('');
      expect(component.canProceed()).toBe(false);
      currentPersona.set('maintainer');
      personaLoaded.set(true);
      await TestBed.inject(ApplicationRef).whenStable();

      expect(component.form.get('category')?.value).toBe('');
      component.nextStep();
      expect(component.currentStep()).toBe(1);
      component.form.get('name')?.setValue('Example Group');
      component.onSubmit();
      expect(createCommittee).not.toHaveBeenCalled();
    });

    it('preselects Newsletter after detection and never reapplies it over a later valid selection', async () => {
      currentPersona.set('contributor');
      personaLoaded.set(false);
      useRoute({}, { category: 'Newsletter' });
      const fixture = await createComponent();
      const component = fixture.componentInstance;

      currentPersona.set('maintainer');
      personaLoaded.set(true);
      await TestBed.inject(ApplicationRef).whenStable();
      expect(component.form.get('category')?.value).toBe('Newsletter');
      expect(component.canProceed()).toBe(true);

      component.form.get('category')?.setValue('Working Group');
      currentPersona.set('executive-director');
      await TestBed.inject(ApplicationRef).whenStable();
      expect(component.form.get('category')?.value).toBe('Working Group');
    });

    it('blocks submission synchronously on persona restriction and clears the now-unavailable category', async () => {
      currentPersona.set('contributor');
      useRoute({}, { category: 'Board' });
      const fixture = await createComponent();
      const component = fixture.componentInstance;
      expect(component.form.get('category')?.value).toBe('Board');
      component.form.get('name')?.setValue('Example Board');

      currentPersona.set('maintainer');
      component.onSubmit();
      expect(createCommittee).not.toHaveBeenCalled();
      expect(component.canProceed()).toBe(false);

      await TestBed.inject(ApplicationRef).whenStable();
      expect(component.form.get('category')?.value).toBe('');
    });

    it('preserves a valid category chosen while persona detection is pending', async () => {
      personaLoaded.set(false);
      useRoute({}, { category: 'Newsletter' });
      const fixture = await createComponent();
      fixture.componentInstance.form.get('category')?.setValue('Working Group');

      personaLoaded.set(true);
      await TestBed.inject(ApplicationRef).whenStable();
      expect(fixture.componentInstance.form.get('category')?.value).toBe('Working Group');
    });
  });

  describe('display name on rename', () => {
    let updateCommittee: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      updateCommittee = vi.fn().mockReturnValue(of(enrichedCommittee()));
      TestBed.overrideProvider(CommitteeService, {
        useValue: { getCommittee, updateCommittee },
      });
      TestBed.overrideComponent(CommitteeManageComponent, { set: { template: '' } });
    });

    describe.each(['onSubmit', 'onSubmitAll'] as const)('%s', (submit) => {
      it.each([
        { label: 'publishing and renaming', public: false, displayName: 'Original Group', want: 'Renamed Group' },
        { label: 'renaming an already public group', public: true, displayName: 'Original Group', want: 'Renamed Group' },
        { label: 'preserving a distinct alias', public: false, displayName: 'Public Alias', want: 'Public Alias' },
        { label: 'preserving an edited display name', public: false, displayName: 'Original Group', editedDisplayName: 'Edited Alias', want: 'Edited Alias' },
        {
          label: 'replacing a distinct alias explicitly',
          public: true,
          displayName: 'Public Alias',
          editedDisplayName: 'Original Group',
          want: 'Original Group',
        },
        { label: 'falling back from an empty display name', public: false, displayName: '', want: 'Renamed Group' },
        { label: 'falling back from an omitted display name', public: false, displayName: undefined, want: 'Renamed Group' },
      ])('$label', async ({ public: isPublic, displayName, editedDisplayName, want }) => {
        getCommittee.mockReturnValue(of({ ...enrichedCommittee(), name: 'Original Group', display_name: displayName, public: isPublic }));
        const fixture = await createComponent();
        const component = fixture.componentInstance;
        vi.spyOn(component, 'memberSaveDisabled').mockReturnValue(false);
        component.form.patchValue({ name: 'Renamed Group', public: true });
        if (editedDisplayName !== undefined) {
          component.form.get('display_name')?.setValue(editedDisplayName);
        }

        component[submit]();

        expect(updateCommittee).toHaveBeenCalledExactlyOnceWith(
          COMMITTEE_UID,
          expect.objectContaining({ name: 'Renamed Group', display_name: want, public: true, calendar: { public: true } })
        );
      });
    });
  });

  describe('deferred CSV member save', () => {
    let updateCommittee: ReturnType<typeof vi.fn>;
    let createCommitteeMember: ReturnType<typeof vi.fn>;
    let revokeCommitteeInvite: ReturnType<typeof vi.fn>;
    let getCommitteeMembers: ReturnType<typeof vi.fn>;
    const createdMember = { uid: 'added-1', email: 'ada@example.com', first_name: 'Ada', last_name: 'Example' } as CommitteeMember;

    beforeEach(() => {
      getCommittee.mockReturnValue(of(enrichedCommittee()));
      updateCommittee = vi.fn().mockReturnValue(of(enrichedCommittee()));
      createCommitteeMember = vi.fn().mockReturnValue(of(createdMember));
      revokeCommitteeInvite = vi.fn().mockReturnValue(of(undefined));
      getCommitteeMembers = vi.fn().mockReturnValue(of([]));
      TestBed.overrideProvider(CommitteeService, {
        useValue: {
          getCommittee,
          createCommittee,
          updateCommittee,
          createCommitteeMember,
          revokeCommitteeInvite,
          getCommitteeMembers,
          getCommitteeInvites: vi.fn().mockReturnValue(of([])),
        },
      });
      // Render the real staging child so partial-save pruning and retry exercise the parent/child contract.
      TestBed.overrideComponent(CommitteeManageComponent, {
        set: {
          template: `@if (committeeId()) {
            <lfx-committee-members-manager [committeeId]="committeeId()" [memberUpdates]="memberUpdates()"
              [organizationRequirements]="organizationRequirements()" [isEditMode]="isEditMode()"
              [submitting]="submitting()" (memberUpdatesChange)="onMemberUpdatesChange($event)" />
          }`,
        },
      });
    });

    const stagedRow = (email: string, patch: Partial<MemberImportRow> = {}): MemberImportRow => ({
      rowNumber: 1,
      email,
      normalizedEmail: email.trim().toLowerCase(),
      cells: {},
      status: 'added',
      issues: [],
      payload: { email },
      ...patch,
    });

    /** Answers each bulk run with one settled row per member; every row is added with its created record unless `outcome` says otherwise. */
    function answerRuns(outcome: (email: string) => Partial<MemberImportRow> = () => ({})): void {
      runStaged.mockImplementation(
        (input: MemberImportStagedRunInput): Observable<MemberImportRow[]> =>
          of(
            input.members.map(({ payload }) =>
              stagedRow(payload.email, { member: { ...createdMember, uid: `uid-${payload.email}`, email: payload.email }, ...outcome(payload.email) })
            )
          )
      );
    }

    async function setupPending(
      toAdd: StagedCommitteeMemberRequest[],
      changes: Partial<MemberPendingChanges> = {},
      stateOnly = false
    ): Promise<CommitteeManageComponent> {
      const fixture = TestBed.createComponent(stateOnly ? StateOnlyCommitteeManageComponent : CommitteeManageComponent);
      const component = fixture.componentInstance;
      if (stateOnly) vi.spyOn(component, 'memberSaveDisabled').mockReturnValue(false);
      component.memberUpdates.set({ toAdd, toUpdate: [], toDelete: [], toInvite: [], ...changes });
      component.form.patchValue({ name: 'Example Group', category: 'Technical Steering Committee' });
      await fixture.whenStable();
      return component;
    }

    async function setupNewGroup(requirements: Pick<Committee, 'enable_voting' | 'business_email_required'>) {
      const group = { ...enrichedCommittee(), uid: 'new-group-uid', ...requirements };
      createCommittee.mockReturnValue(of(group));
      getCommittee.mockReturnValue(of(group));
      TestBed.overrideProvider(ActivatedRoute, {
        useValue: {
          paramMap: of(convertToParamMap({})),
          queryParamMap: queryParamMap$.asObservable(),
          snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) },
        },
      });
      TestBed.overrideProvider(UserService, { useValue: { user: signal({ email: 'self@example.com', given_name: 'Self', family_name: 'User' }) } });
      const dialogClose = new Subject();
      const dialogService = { open: vi.fn(() => ({ onClose: dialogClose })) };
      TestBed.overrideComponent(CommitteeMembersManagerComponent, {
        set: { providers: [ConfirmationService, { provide: DialogService, useValue: dialogService }] },
      });
      const fixture = TestBed.createComponent(CommitteeManageComponent);
      const component = fixture.componentInstance;
      await fixture.whenStable();
      expect(component.isEditMode()).toBe(false);
      expect(component.committee()).toBeNull();
      component.form.patchValue({ name: 'Example Group', category: 'Technical Steering Committee', ...requirements });
      component.onSubmit();
      await fixture.whenStable();
      expect(createCommittee).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(requirements));
      expect(component.committeeId()).toBe(group.uid);
      expect(component.committee()).toBeNull();
      const manager: CommitteeMembersManagerComponent = fixture.debugElement.query(By.directive(CommitteeMembersManagerComponent)).componentInstance;
      return { component, fixture, manager, dialogService, group };
    }

    it.each(['onDone', 'onSubmitAll'] as const)('blocks %s during roster loading and failure without losing any pending operation', async (submit) => {
      const response = new Subject<CommitteeMember[]>();
      getCommitteeMembers.mockReturnValue(response);
      const pending: MemberPendingChanges = {
        toAdd: [{ email: 'added@example.com', createOptions: { skipNotification: true } }],
        toUpdate: [{ uid: 'member-update', changes: { email: 'edited@example.com', first_name: 'Edited' } }],
        toDelete: ['member-delete'],
        toInvite: [{ invitee_email: 'invited@example.com' }],
      };
      const component = await setupPending(pending.toAdd, pending);
      if (submit === 'onDone') component.mode.set('create');
      expect(component.memberSaveDisabled()).toBe(true);
      component[submit]();
      expect(updateCommittee).not.toHaveBeenCalled();
      expect(createCommitteeMember).not.toHaveBeenCalled();
      expect(component.memberUpdates()).toEqual(pending);
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        response.error(new HttpErrorResponse({ status: 503 }));
        await TestBed.inject(ApplicationRef).whenStable();
        expect(component.memberSaveDisabled()).toBe(true);
        component[submit]();
        expect(updateCommittee).not.toHaveBeenCalled();
        expect(createCommitteeMember).not.toHaveBeenCalled();
        expect(revokeCommitteeInvite).not.toHaveBeenCalled();
        expect(component.memberUpdates()).toEqual(pending);
        expect(component.failedDeleteUids()).toEqual([]);
        expect(component.submitting()).toBe(false);
        expect(navigate).not.toHaveBeenCalledWith(['/groups']);
      } finally {
        errorLog.mockRestore();
      }
    });

    it('preserves edits and removals through a failed load, successful step reload, partial save and retry', async () => {
      const response = new Subject<CommitteeMember[]>();
      getCommitteeMembers.mockReturnValue(response);
      const updateMember = vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      const deleteMember = vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      const inviteMember = vi.fn().mockReturnValue(of({ uid: 'sent-invite' }));
      const pending: MemberPendingChanges = {
        toAdd: [{ email: createdMember.email, createOptions: { skipNotification: true } }],
        toUpdate: [{ uid: 'member-update', changes: { email: 'edited@example.com', first_name: 'Edited' } }],
        toDelete: ['member-delete'],
        toInvite: [{ invitee_email: 'invited@example.com' }],
      };
      queryParamMap$.next(convertToParamMap({ step: '4' }));
      TestBed.overrideComponent(CommitteeManageComponent, {
        set: {
          template: `@if (isLastStep()) {
            <lfx-committee-members-manager [committeeId]="committeeId()" [memberUpdates]="memberUpdates()"
              [failedDeleteUids]="failedDeleteUids()" [isEditMode]="isEditMode()" [submitting]="submitting()"
              (memberUpdatesChange)="onMemberUpdatesChange($event)" />
          }`,
        },
      });
      const fixture = TestBed.createComponent(CommitteeManageComponent);
      const component = fixture.componentInstance;
      component.memberUpdates.set(pending);
      component.form.patchValue({ name: 'Example Group', category: 'Technical Steering Committee' });
      Object.assign(TestBed.inject(CommitteeService), {
        updateCommitteeMember: updateMember,
        deleteCommitteeMember: deleteMember,
        createCommitteeInvite: inviteMember,
      });
      await fixture.whenStable();
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        response.error(new HttpErrorResponse({ status: 503 }));
        await fixture.whenStable();
        component.onSubmitAll();
        expect(updateCommittee).not.toHaveBeenCalled();
        expect(component.memberUpdates()).toEqual(pending);

        queryParamMap$.next(convertToParamMap({ step: '3' }));
        await fixture.whenStable();
        expect(component.memberSaveDisabled()).toBe(true);
        getCommitteeMembers.mockReturnValue(
          of([
            { uid: 'member-update', email: 'edited@example.com', first_name: 'Original' } as CommitteeMember,
            { uid: 'member-delete', email: 'removed@example.com' } as CommitteeMember,
          ])
        );
        queryParamMap$.next(convertToParamMap({ step: '4' }));
        await fixture.whenStable();
        expect(component.memberSaveDisabled()).toBe(false);
        component.onSubmitAll();
        expect(component.memberUpdates().toAdd).toEqual([]);
        expect(component.memberUpdates().toInvite).toEqual([]);
        expect(component.memberUpdates().toUpdate).toEqual([
          expect.objectContaining({ uid: 'member-update', changes: expect.objectContaining({ email: 'edited@example.com', first_name: 'Edited' }) }),
        ]);
        expect(component.memberUpdates().toDelete).toEqual(['member-delete']);
        expect(component.failedDeleteUids()).toEqual(['member-delete']);
        expect(navigate).not.toHaveBeenCalledWith(['/groups']);

        updateMember.mockReturnValue(of({ uid: 'member-update' }));
        deleteMember.mockReturnValue(of(undefined));
        await fixture.whenStable();
        component.onSubmitAll();
        expect(updateMember).toHaveBeenCalledTimes(2);
        expect(deleteMember).toHaveBeenCalledTimes(2);
        expect(createCommitteeMember).toHaveBeenCalledTimes(1);
        expect(inviteMember).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith(['/groups']);
      } finally {
        errorLog.mockRestore();
      }
    });

    it.each(['example-group', 'EXAMPLE-GROUP'])('imports and saves from slug %s using one pinned UUID for every write', async (slug) => {
      const uid = '00000000-0000-4000-8000-000000000001';
      const group = { ...enrichedCommittee(), uid, sso_group_name: 'example-group' };
      const groupResponse = new Subject<Committee>();
      const dialogClose = new Subject<StagedCommitteeMemberRequest[]>();
      const dialogService = { open: vi.fn(() => ({ onClose: dialogClose })) };
      const updateCommitteeMember = vi.fn().mockReturnValue(of(createdMember));
      const deleteCommitteeMember = vi.fn().mockReturnValue(of(undefined));
      const createCommitteeInvite = vi.fn().mockReturnValue(of({ uid: 'new-invite' }));
      const getCommitteeInvites = vi.fn().mockReturnValue(of([{ uid: 'pending-invite', invitee_email: 'new@example.com', status: 'pending' }]));
      getCommittee.mockReturnValue(of(group));
      updateCommittee.mockReturnValue(groupResponse);
      TestBed.overrideProvider(ActivatedRoute, {
        useValue: {
          paramMap: of(convertToParamMap({ id: slug })),
          queryParamMap: queryParamMap$.asObservable(),
          snapshot: { paramMap: convertToParamMap({ id: slug }), queryParamMap: convertToParamMap({}) },
        },
      });
      TestBed.overrideProvider(CommitteeService, {
        useValue: {
          getCommittee,
          updateCommittee,
          createCommitteeMember,
          updateCommitteeMember,
          deleteCommitteeMember,
          createCommitteeInvite,
          revokeCommitteeInvite,
          getCommitteeInvites,
          getCommitteeMembers: vi.fn().mockReturnValue(of([])),
        },
      });
      TestBed.overrideComponent(CommitteeMembersManagerComponent, {
        set: { providers: [ConfirmationService, { provide: DialogService, useValue: dialogService }] },
      });
      const fixture = TestBed.createComponent(CommitteeManageComponent);
      const component = fixture.componentInstance;
      await fixture.whenStable();
      const manager: CommitteeMembersManagerComponent = fixture.debugElement.query(By.directive(CommitteeMembersManagerComponent)).componentInstance;
      manager.openImportMembersDialog();
      expect(dialogService.open).toHaveBeenCalledTimes(1);
      expect(getCommitteeInvites.mock.calls[0][0]).toBe(uid);
      dialogClose.next([{ email: 'new@example.com', createOptions: { skipNotification: true }, importSource: 'csv' }]);
      expect(component.memberUpdates().toAdd).toEqual([expect.objectContaining({ email: 'new@example.com', pendingInviteUids: ['pending-invite'] })]);
      answerRuns();
      expect(createCommitteeMember).not.toHaveBeenCalled();
      component.memberUpdates.update((pending) => ({
        ...pending,
        toUpdate: [{ uid: 'changed-member', changes: { email: 'changed@example.com', first_name: 'Changed' } }],
        toDelete: ['deleted-member'],
        toInvite: [{ invitee_email: 'invited@example.com' }],
      }));
      component.onSubmitAll();
      expect(updateCommittee).toHaveBeenCalledExactlyOnceWith(uid, expect.any(Object));
      expect(createCommitteeMember).not.toHaveBeenCalled();
      // Route changes during the group update must not retarget its member or cleanup writes.
      component.committeeId.set('another-group');
      groupResponse.next(group);
      groupResponse.complete();
      expect(runStaged).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          committeeUid: uid,
          skipNotification: true,
          members: [{ payload: expect.objectContaining({ email: 'new@example.com' }), pendingInviteUids: ['pending-invite'] }],
        })
      );
      expect(createCommitteeMember).not.toHaveBeenCalled();
      expect(updateCommitteeMember).toHaveBeenCalledExactlyOnceWith(uid, 'changed-member', { email: 'changed@example.com', first_name: 'Changed' });
      expect(deleteCommitteeMember).toHaveBeenCalledExactlyOnceWith(uid, 'deleted-member');
      expect(createCommitteeInvite).toHaveBeenCalledExactlyOnceWith(uid, { invitee_email: 'invited@example.com' });
      expect(navigate).toHaveBeenCalledWith(['/groups']);
    });

    it('uses the resolved UUID for the earlier edit-step submit too', async () => {
      getCommittee.mockReturnValue(of({ ...enrichedCommittee(), sso_group_name: 'example-group' }));
      const component = await setupPending([]);
      component.committeeId.set('EXAMPLE-GROUP');
      component.onSubmit();
      expect(updateCommittee).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, expect.any(Object));
      expect(createCommittee).not.toHaveBeenCalled();
    });

    it.each(['onSubmit', 'onSubmitAll'] as const)('blocks %s while the loaded group does not match the route', async (submit) => {
      const component = await setupPending([{ email: 'new@example.com' }]);
      component.committeeId.set('another-group');
      component[submit]();
      expect(updateCommittee).not.toHaveBeenCalled();
      expect(createCommitteeMember).not.toHaveBeenCalled();
      expect(createCommittee).not.toHaveBeenCalled();
      expect(component.memberUpdates().toAdd).toHaveLength(1);
      expect(component.submitting()).toBe(false);
    });

    it('keeps the new-group UUID when finishing the create wizard', async () => {
      const component = await setupPending([{ email: createdMember.email }]);
      component.mode.set('create');
      component.committeeId.set('new-group-uid');
      component.onDone();
      expect(createCommitteeMember).toHaveBeenCalledExactlyOnceWith('new-group-uid', { email: createdMember.email }, undefined);
      expect(updateCommittee).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/groups']);
    });

    it('imports CSV members into a newly created group and saves them only on Done', async () => {
      const newGroup = { ...enrichedCommittee(), uid: 'new-group-uid' };
      const dialogClose = new Subject<StagedCommitteeMemberRequest[]>();
      const dialogService = { open: vi.fn(() => ({ onClose: dialogClose })) };
      const getCommitteeInvites = vi.fn().mockReturnValue(of([]));
      createCommittee.mockReturnValue(of(newGroup));
      getCommittee.mockReturnValue(of(newGroup));
      TestBed.overrideProvider(ActivatedRoute, {
        useValue: {
          paramMap: of(convertToParamMap({})),
          queryParamMap: queryParamMap$.asObservable(),
          snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) },
        },
      });
      TestBed.overrideProvider(CommitteeService, {
        useValue: {
          getCommittee,
          createCommittee,
          updateCommittee,
          createCommitteeMember,
          revokeCommitteeInvite,
          getCommitteeInvites,
          getCommitteeMembers,
          getCommitteesByProject: vi.fn().mockReturnValue(of([])),
        },
      });
      TestBed.overrideComponent(CommitteeManageComponent, {
        set: {
          template: `@if (committeeId()) {
            <lfx-committee-members-manager [committeeId]="committeeId()" [memberUpdates]="memberUpdates()"
              [isEditMode]="isEditMode()" [submitting]="submitting()" (memberUpdatesChange)="onMemberUpdatesChange($event)" />
          }`,
        },
      });
      TestBed.overrideComponent(CommitteeMembersManagerComponent, {
        set: { providers: [ConfirmationService, { provide: DialogService, useValue: dialogService }] },
      });
      const fixture = TestBed.createComponent(CommitteeManageComponent);
      const component = fixture.componentInstance;
      await fixture.whenStable();
      expect(component.isEditMode()).toBe(false);

      component.form.patchValue({ name: 'Example Group', category: 'Technical Steering Committee' });
      component.onSubmit();
      await fixture.whenStable();
      expect(createCommittee).toHaveBeenCalledTimes(1);
      expect(component.committeeId()).toBe('new-group-uid');

      const manager: CommitteeMembersManagerComponent = fixture.debugElement.query(By.directive(CommitteeMembersManagerComponent)).componentInstance;
      manager.openImportMembersDialog();
      expect(getCommitteeInvites.mock.calls[0][0]).toBe('new-group-uid');
      expect(dialogService.open).toHaveBeenCalledTimes(1);
      dialogClose.next([{ email: createdMember.email, first_name: 'Ada', createOptions: { skipNotification: false }, importSource: 'csv' }]);
      expect(component.memberUpdates().toAdd).toEqual([expect.objectContaining({ email: createdMember.email, importSource: 'csv' })]);
      expect(createCommitteeMember).not.toHaveBeenCalled();
      expect(runStaged).not.toHaveBeenCalled();

      answerRuns();
      component.onDone();
      expect(runStaged).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          committeeUid: 'new-group-uid',
          skipNotification: false,
          members: [{ payload: expect.objectContaining({ email: createdMember.email, first_name: 'Ada' }), pendingInviteUids: [] }],
        })
      );
      expect(runStaged.mock.calls[0][0].members[0].payload).not.toHaveProperty('importSource');
      expect(createCommitteeMember).not.toHaveBeenCalled();
      expect(updateCommittee).not.toHaveBeenCalled();
      expect(revokeCommitteeInvite).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/groups']);
    });

    it.each([true, false])('passes notification suppression %s separately from the native member body', async (skipNotification) => {
      const component = await setupPending([{ email: createdMember.email, createOptions: { skipNotification }, pendingInviteUids: ['invite-1'] }]);
      component.onSubmitAll();
      expect(createCommitteeMember).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, { email: createdMember.email }, { skipNotification });
      expect(revokeCommitteeInvite).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, 'invite-1');
      expect(navigate).toHaveBeenCalledWith(['/groups']);
    });

    it('strips the self-add origin from the native member body while preserving its create options', async () => {
      const component = await setupPending([
        { email: createdMember.email, isSelfAddition: true, createOptions: { skipNotification: true }, pendingInviteUids: ['invite-1'] },
      ]);
      component.onSubmitAll();
      expect(createCommitteeMember).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, { email: createdMember.email }, { skipNotification: true });
      expect(revokeCommitteeInvite).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, 'invite-1');
    });

    it.each(['business_email_required', 'enable_voting'])('checks staged self-add details before saving newly enabled %s', async (field) => {
      const self = {
        email: 'self@example.com',
        first_name: 'Self',
        last_name: 'User',
        isSelfAddition: true,
        createOptions: { skipNotification: true },
        pendingInviteUids: ['self-invite'],
      };
      const component = await setupPending([self]);
      const pending = component.memberUpdates();
      component.form.get(field)!.setValue(true);

      component.onSubmitAll();

      expect(updateCommittee).not.toHaveBeenCalled();
      expect(createCommitteeMember).not.toHaveBeenCalled();
      expect(revokeCommitteeInvite).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalledWith(['/groups']);
      expect(component.memberUpdates()).toEqual(pending);
      expect(component.submitting()).toBe(false);
      expect(TestBed.inject(MessageService).add).toHaveBeenCalledWith(
        expect.objectContaining({ summary: 'Member Details Required', detail: expect.stringContaining('Edit self@example.com on Add Members') })
      );

      const details = {
        organization: { name: 'Example Company', website: 'https://company.example' },
        role: { name: CommitteeMemberRole.CHAIR },
        voting: { status: CommitteeMemberVotingStatus.OBSERVER },
      };
      component.onMemberUpdatesChange({ ...pending, toAdd: [{ ...self, ...details }] });
      component.onSubmitAll();

      expect(updateCommittee).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, expect.objectContaining({ [field]: true }));
      expect(createCommitteeMember).toHaveBeenCalledExactlyOnceWith(
        COMMITTEE_UID,
        { email: self.email, first_name: self.first_name, last_name: self.last_name, ...details },
        { skipNotification: true }
      );
      expect(revokeCommitteeInvite).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, 'self-invite');
      expect(navigate).toHaveBeenCalledWith(['/groups']);
    });

    it('permits the staged self-add after newly enabled requirements are turned off again', async () => {
      const self = { email: 'self@example.com', first_name: 'Self', last_name: 'User', isSelfAddition: true };
      const component = await setupPending([self]);
      component.form.patchValue({ enable_voting: true, business_email_required: true });
      component.form.patchValue({ enable_voting: false, business_email_required: false });
      component.onSubmitAll();
      expect(updateCommittee).toHaveBeenCalledTimes(1);
      expect(createCommitteeMember).toHaveBeenCalledExactlyOnceWith(
        COMMITTEE_UID,
        { email: self.email, first_name: self.first_name, last_name: self.last_name },
        undefined
      );
    });

    it('does not bypass final member requirements through the earlier edit-step submit', async () => {
      const component = await setupPending([{ email: 'self@example.com' }]);
      component.form.get('enable_voting')!.setValue(true);
      component.onSubmit();
      expect(updateCommittee).not.toHaveBeenCalled();
      expect(component.memberUpdates().toAdd).toHaveLength(1);
    });

    it.each(['enable_voting', 'business_email_required'])('retains saved %s after creating without a route ID', async (field) => {
      const requirements = { enable_voting: field === 'enable_voting', business_email_required: field === 'business_email_required' };
      const { component, fixture, manager, dialogService } = await setupNewGroup(requirements);
      component.form.patchValue({ enable_voting: false, business_email_required: false });
      await fixture.whenStable();

      expect(component.organizationRequirements()).toEqual(requirements);
      manager.addMyself();
      expect(dialogService.open).toHaveBeenCalledWith(
        MemberFormComponent,
        expect.objectContaining({ data: expect.objectContaining({ committee: expect.objectContaining(requirements) }) })
      );
      expect(component.memberUpdates().toAdd).toEqual([]);

      component.onMemberUpdatesChange({
        toAdd: [{ email: 'self@example.com', first_name: 'Self', last_name: 'User' }],
        toUpdate: [],
        toDelete: [],
        toInvite: [],
      });
      component.onDone();
      expect(createCommitteeMember).not.toHaveBeenCalled();
      expect(revokeCommitteeInvite).not.toHaveBeenCalled();
      expect(component.memberUpdates().toAdd).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalledWith(['/groups']);
      expect(TestBed.inject(MessageService).add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Member Details Required' }));
    });

    it('does not impose unsaved draft requirements on a newly created open group', async () => {
      const requirements = { enable_voting: false, business_email_required: false };
      const { component, fixture, manager, dialogService, group } = await setupNewGroup(requirements);
      manager.addMyself();
      expect(component.memberUpdates().toAdd).toHaveLength(1);
      component.form.patchValue({ enable_voting: true, business_email_required: true });
      await fixture.whenStable();

      expect(component.organizationRequirements()).toEqual(requirements);
      expect(dialogService.open).not.toHaveBeenCalled();
      component.onDone();
      expect(updateCommittee).not.toHaveBeenCalled();
      expect(createCommitteeMember).toHaveBeenCalledExactlyOnceWith(
        group.uid,
        expect.objectContaining({ email: 'self@example.com', first_name: 'Self', last_name: 'User' }),
        { skipNotification: true }
      );
    });

    it('waits for the group update and successful member creation before revoking invitations', async () => {
      const groupResponse = new Subject<Committee>();
      const memberResponse = new Subject<CommitteeMember>();
      updateCommittee.mockReturnValue(groupResponse);
      createCommitteeMember.mockReturnValue(memberResponse);
      const component = await setupPending([
        { email: createdMember.email, createOptions: { skipNotification: true }, pendingInviteUids: ['invite-1', 'invite-2'] },
      ]);
      expect(createCommitteeMember).not.toHaveBeenCalled();
      expect(revokeCommitteeInvite).not.toHaveBeenCalled();
      component.onSubmitAll();
      expect(createCommitteeMember).not.toHaveBeenCalled();
      groupResponse.next(enrichedCommittee());
      groupResponse.complete();
      expect(revokeCommitteeInvite).not.toHaveBeenCalled();
      memberResponse.next(createdMember);
      memberResponse.complete();
      expect(revokeCommitteeInvite.mock.calls).toEqual([
        [COMMITTEE_UID, 'invite-1'],
        [COMMITTEE_UID, 'invite-2'],
      ]);
    });

    it('does not create members or revoke invitations if the group update fails', async () => {
      updateCommittee.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      const component = await setupPending([{ email: createdMember.email, createOptions: { skipNotification: true }, pendingInviteUids: ['invite-1'] }]);
      component.onSubmitAll();
      expect(createCommitteeMember).not.toHaveBeenCalled();
      expect(revokeCommitteeInvite).not.toHaveBeenCalled();
      expect(component.memberUpdates().toAdd).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalledWith(['/groups']);
    });

    it('never retries an added member after cleanup failure, while retaining failed-row options for retry', async () => {
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        createCommitteeMember.mockReturnValueOnce(of(createdMember)).mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
        revokeCommitteeInvite.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'private@example.com' } })));
        const component = await setupPending([
          { email: createdMember.email, createOptions: { skipNotification: true }, pendingInviteUids: ['invite-1'] },
          { email: 'retry@example.com', createOptions: { skipNotification: false }, pendingInviteUids: ['invite-2'] },
        ]);
        component.onSubmitAll();
        expect(component.memberUpdates().toAdd).toEqual([
          expect.objectContaining({ email: 'retry@example.com', createOptions: { skipNotification: false }, pendingInviteUids: ['invite-2'] }),
        ]);
        expect(revokeCommitteeInvite.mock.calls).toEqual([[COMMITTEE_UID, 'invite-1']]);
        expect(errorLog).toHaveBeenCalledExactlyOnceWith('Staged member invitation cleanup failed', { status: 403 });
        expect(TestBed.inject(MessageService).add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Pending Invitation Cleanup' }));
        createCommitteeMember.mockReturnValue(of({ ...createdMember, uid: 'added-2', email: 'retry@example.com' }));
        component.onSubmitAll();
        expect(createCommitteeMember).toHaveBeenCalledTimes(3);
        expect(createCommitteeMember.mock.calls[2]).toEqual([
          COMMITTEE_UID,
          expect.objectContaining({ email: 'retry@example.com' }),
          { skipNotification: false },
        ]);
        expect(revokeCommitteeInvite.mock.calls).toEqual([
          [COMMITTEE_UID, 'invite-1'],
          [COMMITTEE_UID, 'invite-2'],
        ]);
      } finally {
        errorLog.mockRestore();
      }
    });

    describe('bulk CSV save (#5529)', () => {
      const csv = (email: string, patch: Partial<StagedCommitteeMemberRequest> = {}): StagedCommitteeMemberRequest => ({
        email,
        createOptions: { skipNotification: true },
        importSource: 'csv',
        ...patch,
      });

      it('saves CSV rows in bulk and keeps manual and self additions on single creates', async () => {
        answerRuns();
        const component = await setupPending(
          [
            csv('csv@example.com', { pendingInviteUids: ['invite-1'] }),
            { email: 'manual@example.com' },
            { email: 'self@example.com', isSelfAddition: true, createOptions: { skipNotification: true } },
          ],
          {},
          true
        );
        component.onSubmitAll();

        expect(runStaged).toHaveBeenCalledExactlyOnceWith({
          committeeUid: COMMITTEE_UID,
          committeeName: 'TSC',
          skipNotification: true,
          members: [{ payload: { email: 'csv@example.com' }, pendingInviteUids: ['invite-1'] }],
        });
        expect(createCommitteeMember.mock.calls).toEqual([
          [COMMITTEE_UID, { email: 'manual@example.com' }, undefined],
          [COMMITTEE_UID, { email: 'self@example.com' }, { skipNotification: true }],
        ]);
        // The import service revokes a CSV row's invitations itself.
        expect(revokeCommitteeInvite).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith(['/groups']);
      });

      it("groups CSV rows by their own import's notification choice, in staged order", async () => {
        answerRuns();
        const component = await setupPending(
          [
            csv('a@example.com'),
            csv('b@example.com', { createOptions: { skipNotification: false } }),
            csv('c@example.com'),
            csv('d@example.com', { createOptions: undefined }),
          ],
          {},
          true
        );
        component.onSubmitAll();

        expect(
          runStaged.mock.calls.map(([input]) => [input.skipNotification, input.members.map((m: { payload: { email: string } }) => m.payload.email)])
        ).toEqual([
          [true, ['a@example.com', 'c@example.com']],
          [false, ['b@example.com', 'd@example.com']],
        ]);
        expect(createCommitteeMember).not.toHaveBeenCalled();
      });

      it('runs deletes, updates, manual adds, CSV imports and then invitations in order', async () => {
        const calls: string[] = [];
        const logged = <T>(name: string, value: T) => vi.fn(() => defer(() => (calls.push(name), of(value))));
        runStaged.mockImplementation((input: MemberImportStagedRunInput) =>
          defer(() => (calls.push('csv'), of(input.members.map(({ payload }) => stagedRow(payload.email)))))
        );
        const component = await setupPending(
          [csv('csv@example.com'), { email: 'manual@example.com' }],
          {
            toUpdate: [{ uid: 'member-update', changes: { email: 'edited@example.com' } }],
            toDelete: ['member-delete'],
            toInvite: [{ invitee_email: 'invited@example.com' }],
          },
          true
        );
        Object.assign(TestBed.inject(CommitteeService), {
          createCommitteeMember: logged('add', createdMember),
          updateCommitteeMember: logged('update', createdMember),
          deleteCommitteeMember: logged('delete', undefined),
          createCommitteeInvite: logged('invite', { uid: 'invite' }),
        });
        component.onSubmitAll();
        expect(calls).toEqual(['delete', 'update', 'add', 'csv', 'invite']);
      });

      it.each([
        ['onDone', null],
        ['onDone', 'synthetic-replacement'],
        ['onSubmitAll', null],
        ['onSubmitAll', 'synthetic-replacement'],
      ] as const)('does not send later CSV groups or invitations after ownership loss on %s (%s)', async (submit, replacement) => {
        const rows = new Subject<MemberImportRow[]>();
        runStaged.mockReturnValue(rows);
        const createCommitteeInvite = vi.fn(() => of({ uid: 'invite' }));
        Object.assign(TestBed.inject(CommitteeService), { createCommitteeInvite });
        const component = await setupPending(
          [csv('first@example.com'), csv('second@example.com', { createOptions: { skipNotification: false } })],
          { toInvite: [{ invitee_email: 'invited@example.com' }] },
          true
        );
        if (submit === 'onDone') component.mode.set('create');
        component[submit]();
        expect(runStaged).toHaveBeenCalledTimes(1);
        importOwner.set(replacement);
        rows.complete();
        expect(runStaged).toHaveBeenCalledTimes(1);
        expect(createCommitteeInvite).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalledWith(['/groups']);
        expect(component.submitting()).toBe(false);
      });

      it('pins the subject before the group update completes', async () => {
        const updated = new Subject<Committee>();
        updateCommittee.mockReturnValue(updated);
        const component = await setupPending([csv('csv@example.com')], {}, true);
        component.onSubmitAll();
        importOwner.set('synthetic-replacement');
        updated.next(enrichedCommittee());
        updated.complete();
        expect(runStaged).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalledWith(['/groups']);
      });

      it('guards queued manual additions and their cleanup before continuing to CSV rows', async () => {
        const revoked = new Subject<void>();
        revokeCommitteeInvite.mockReturnValue(revoked);
        const component = await setupPending(
          [{ email: 'manual@example.com', pendingInviteUids: ['invite-1', 'invite-2'] }, { email: 'later@example.com' }, csv('csv@example.com')],
          {},
          true
        );
        component.onSubmitAll();
        expect(createCommitteeMember).toHaveBeenCalledTimes(1);
        expect(revokeCommitteeInvite).toHaveBeenCalledTimes(1);
        importOwner.set(null);
        revoked.next();
        revoked.complete();
        expect(revokeCommitteeInvite).toHaveBeenCalledTimes(1);
        expect(createCommitteeMember).toHaveBeenCalledTimes(1);
        expect(runStaged).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalledWith(['/groups']);
      });

      it.each([true, false])('looks up an added member without a body, preserving success when lookup succeeds: %s', async (lookupSucceeds) => {
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const member = { ...createdMember, uid: 'added-uid' };
        const getCommitteeMember = vi.fn(() => (lookupSucceeds ? of(member) : throwError(() => new HttpErrorResponse({ status: 503 }))));
        Object.assign(TestBed.inject(CommitteeService), { getCommitteeMember });
        answerRuns((email) =>
          email === 'failed@example.com' ? { status: 'failed', member: undefined } : { status: 'added', member: undefined, memberUid: 'added-uid' }
        );
        const component = await setupPending([csv('ada@example.com'), csv('failed@example.com')]);
        component.onSubmitAll();
        expect(getCommitteeMember).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, 'added-uid');
        expect(component.memberUpdates().toAdd.map((entry) => entry.email)).toEqual(
          lookupSucceeds ? ['failed@example.com'] : ['ada@example.com', 'failed@example.com']
        );
        expect(TestBed.inject(MessageService).add).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Already Members' }));
        errorLog.mockRestore();
      });

      it('counts only added and skipped rows as saved, promotes them, and keeps the rest staged', async () => {
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const existing = { ...createdMember, uid: 'existing-1', email: 'existing@example.com' };
        const getCommitteeMember = vi.fn((_uid: string, memberUid: string) =>
          memberUid === 'existing-1' ? of(existing) : throwError(() => new HttpErrorResponse({ status: 503 }))
        );
        Object.assign(TestBed.inject(CommitteeService), { getCommitteeMember });
        const outcomes: Record<string, Partial<MemberImportRow>> = {
          'existing@example.com': { status: 'skipped', conflict: true, memberUid: 'existing-1', member: undefined },
          'unreadable@example.com': { status: 'skipped', conflict: true, memberUid: 'existing-2', member: undefined },
          'duplicate@example.com': { status: 'skipped', member: undefined },
          'failed@example.com': { status: 'failed', member: undefined },
          'unknown@example.com': { status: 'unknown', uncertain: true, member: undefined },
          'unsent@example.com': { status: 'not_submitted', member: undefined },
        };
        answerRuns((email) => outcomes[email] ?? {});
        const component = await setupPending(
          ['added', 'existing', 'unreadable', 'duplicate', 'failed', 'unknown', 'unsent'].map((name) => csv(`${name}@example.com`))
        );
        const prune = vi.spyOn(component['membersManager']()!, 'pruneSucceeded');
        component.onSubmitAll();

        expect(getCommitteeMember.mock.calls).toEqual([
          [COMMITTEE_UID, 'existing-1'],
          [COMMITTEE_UID, 'existing-2'],
        ]);
        expect(errorLog).toHaveBeenCalledExactlyOnceWith('Existing member lookup failed', { status: 503 });
        expect([...prune.mock.calls[0][0].addedMembers.keys()]).toEqual(['added@example.com', 'existing@example.com']);
        expect(prune.mock.calls[0][0].addedMembers.get('existing@example.com')).toEqual(existing);
        expect(component.memberUpdates().toAdd.map((member) => member.email)).toEqual([
          'unreadable@example.com',
          'duplicate@example.com',
          'failed@example.com',
          'unknown@example.com',
          'unsent@example.com',
        ]);
        expect(navigate).not.toHaveBeenCalledWith(['/groups']);
        const toast = TestBed.inject(MessageService).add;
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ severity: 'warn', summary: 'Partial Success', detail: '4 member(s) updated successfully, 3 failed' })
        );
        expect(toast).toHaveBeenCalledWith({
          severity: 'info',
          summary: 'Already Members',
          detail: '2 imported member(s) were already in the group; their CSV details were not applied.',
        });
        expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Unconfirmed Additions' }));

        // A retry resubmits only the rows that are still staged; already-member rows skip harmlessly again.
        runStaged.mockClear();
        answerRuns();
        component.onSubmitAll();
        expect(runStaged).toHaveBeenCalledTimes(1);
        expect(runStaged.mock.calls[0][0].members.map((m: { payload: { email: string } }) => m.payload.email)).toEqual([
          'unreadable@example.com',
          'duplicate@example.com',
          'failed@example.com',
          'unknown@example.com',
          'unsent@example.com',
        ]);
        expect(navigate).toHaveBeenCalledWith(['/groups']);
        errorLog.mockRestore();
      });

      it.each(['onDone', 'onSubmitAll'] as const)('reports every row of a run that never starts as failed on %s', async (submit) => {
        runStaged.mockReturnValue(EMPTY);
        const component = await setupPending([csv('a@example.com'), csv('b@example.com')], {}, true);
        if (submit === 'onDone') component.mode.set('create');
        component[submit]();
        expect(component.memberUpdates().toAdd.map((member) => member.email)).toEqual(['a@example.com', 'b@example.com']);
        expect(TestBed.inject(MessageService).add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Operation Failed' }));
        expect(navigate).not.toHaveBeenCalledWith(['/groups']);
      });

      it('reports a row found in the group after an unconfirmed attempt as saved, with review-invitations guidance instead of the already-member notice', async () => {
        const existing = { ...createdMember, uid: 'existing-1', email: 'csv@example.com' };
        const getCommitteeMember = vi.fn(() => of(existing));
        Object.assign(TestBed.inject(CommitteeService), { getCommitteeMember });
        answerRuns(() => ({ status: 'skipped', conflict: true, unconfirmedAddition: true, memberUid: 'existing-1', member: undefined }));
        const component = await setupPending([csv('csv@example.com', { pendingInviteUids: ['invite-1'] })], {}, true);
        component.onSubmitAll();

        const toast = TestBed.inject(MessageService).add;
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: 'Group and 1 member(s) updated successfully' }));
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'warn',
            summary: 'Unconfirmed Additions',
            detail:
              '1 imported member(s) are in the group, but an earlier attempt could not be confirmed, so their CSV details may not have been applied. Review their pending invitations from the Pending tab.',
          })
        );
        expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Already Members' }));
        // As on the Members tab, an unconfirmed outcome leaves invitation review to the user.
        expect(revokeCommitteeInvite).not.toHaveBeenCalled();
        expect(getCommitteeMember).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, 'existing-1');
        expect(navigate).toHaveBeenCalledWith(['/groups']);
      });

      it.each(['onDone', 'onSubmitAll'] as const)('retains uncertainty across a manual retry on %s', async (submit) => {
        const getCommitteeMember = vi.fn(() => of({ ...createdMember, uid: 'existing-1' }));
        Object.assign(TestBed.inject(CommitteeService), { getCommitteeMember });
        let attempt = 0;
        runStaged.mockImplementation((input: MemberImportStagedRunInput) => {
          const firstAttempt = attempt++ === 0;
          return of(
            input.members.map(({ payload, uncertain }) => {
              const row = stagedRow(payload.email, { uncertain });
              return firstAttempt
                ? { ...row, status: 'unknown', uncertain: true }
                : {
                    ...row,
                    ...classifyMemberImportBulkResult(
                      {
                        index: 0,
                        email: payload.email,
                        status: 'skipped',
                        reason: 'already_member',
                        retryable: false,
                        member_uid: 'existing-1',
                      },
                      row
                    ),
                  };
            })
          );
        });
        const component = await setupPending([csv('ada@example.com', { pendingInviteUids: ['invite-1'] })], {}, true);
        if (submit === 'onDone') component.mode.set('create');
        const toast = TestBed.inject(MessageService).add;
        component[submit]();
        expect(navigate).not.toHaveBeenCalledWith(['/groups']);
        vi.mocked(toast).mockClear();
        component[submit]();
        expect(runStaged.mock.calls[1][0].members[0].uncertain).toBe(true);
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Unconfirmed Additions' }));
        expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Already Members' }));
        expect(revokeCommitteeInvite).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith(['/groups']);
        // A settled row no longer carries uncertainty into any later save.
        component[submit]();
        expect(runStaged.mock.calls[2][0].members[0].uncertain).toBeUndefined();
      });

      it.each(['missing-uid', 'failed-lookup'] as const)('keeps unconfirmed additions uncertain while staged (%s)', async (lookup) => {
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const getCommitteeMember = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 503 })));
        Object.assign(TestBed.inject(CommitteeService), { getCommitteeMember });
        let attempt = 0;
        runStaged.mockImplementation((input: MemberImportStagedRunInput) => {
          const firstAttempt = attempt++ === 0;
          return of(
            input.members.map(({ payload, uncertain }) => {
              if (payload.email === 'failed@example.com') return stagedRow(payload.email, { status: 'failed' });
              const row = stagedRow(payload.email, { uncertain: firstAttempt || uncertain });
              return {
                ...row,
                ...classifyMemberImportBulkResult(
                  {
                    index: 0,
                    email: payload.email,
                    status: 'skipped',
                    reason: 'already_member',
                    retryable: false,
                    ...(lookup === 'failed-lookup' ? { member_uid: 'existing-uid' } : {}),
                  },
                  row
                ),
              };
            })
          );
        });
        const component = await setupPending([csv('ada@example.com'), csv('failed@example.com')]);
        const toast = TestBed.inject(MessageService).add;
        component.onSubmitAll();
        expect(component.memberUpdates().toAdd).toHaveLength(2);
        vi.mocked(toast).mockClear();
        component.onSubmitAll();
        expect(runStaged.mock.calls[1][0].members[0].uncertain).toBe(true);
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Unconfirmed Additions' }));
        expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Already Members' }));
        component.onMemberUpdatesChange({ ...component.memberUpdates(), toAdd: [csv('failed@example.com')] });
        expect(component['uncertainCsvMembers'].size).toBe(0);
        errorLog.mockRestore();
      });

      it.each(['onDone', 'onSubmitAll'] as const)('reports the outcome but neither prunes nor navigates once the wizard is gone (%s)', async (submit) => {
        const rows = new Subject<MemberImportRow[]>();
        runStaged.mockReturnValue(rows);
        const fixture = TestBed.createComponent(CommitteeManageComponent);
        const component = fixture.componentInstance;
        component.memberUpdates.set({ toAdd: [csv('a@example.com'), csv('b@example.com')], toUpdate: [], toDelete: [], toInvite: [] });
        component.form.patchValue({ name: 'Example Group', category: 'Technical Steering Committee' });
        await fixture.whenStable();
        if (submit === 'onDone') component.mode.set('create');
        const prune = vi.spyOn(component['membersManager']()!, 'pruneSucceeded');
        component[submit]();
        fixture.destroy();

        rows.next([stagedRow('a@example.com', { member: { ...createdMember, email: 'a@example.com' } }), stagedRow('b@example.com', { status: 'failed' })]);
        rows.complete();

        expect(TestBed.inject(MessageService).add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Partial Success' }));
        expect(prune).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalledWith(['/groups']);
      });

      it('keeps an added row with a cleanup warning saved and warns about the invitation', async () => {
        answerRuns(() => ({ cleanupWarning: 'Added, but their pending invitation could not be revoked.' }));
        const component = await setupPending([csv('csv@example.com', { pendingInviteUids: ['invite-1'] })], {}, true);
        component.onSubmitAll();
        const toast = TestBed.inject(MessageService).add;
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: 'Group and 1 member(s) updated successfully' }));
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Pending Invitation Cleanup' }));
        expect(navigate).toHaveBeenCalledWith(['/groups']);
      });
    });

    it('keeps non-CSV additions on their existing notification path with no cleanup', async () => {
      const component = await setupPending([{ email: createdMember.email }]);
      component.onSubmitAll();
      expect(createCommitteeMember).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, { email: createdMember.email }, undefined);
      expect(revokeCommitteeInvite).not.toHaveBeenCalled();
    });
  });

  describe('save controls with the real PrimeNG stepper template', () => {
    let membersResponse: Subject<CommitteeMember[]>;
    let groupResponse: Subject<Committee>;
    let updateCommittee: ReturnType<typeof vi.fn>;
    let createCommitteeMember: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      membersResponse = new Subject<CommitteeMember[]>();
      groupResponse = new Subject<Committee>();
      // Parent details resolve immediately; the child has independent, controlled load states.
      getCommittee.mockReturnValueOnce(of(enrichedCommittee())).mockReturnValue(groupResponse);
      updateCommittee = vi.fn().mockReturnValue(of(enrichedCommittee()));
      createCommitteeMember = vi.fn().mockReturnValue(of({ uid: 'new-member', email: 'imported@example.com' }));
      TestBed.overrideProvider(CommitteeService, {
        useValue: {
          getCommittee,
          updateCommittee,
          createCommitteeMember,
          getCommitteeMembers: vi.fn().mockReturnValue(membersResponse),
          getCommitteeInvites: vi.fn().mockReturnValue(of([])),
        },
      });
      queryParamMap$.next(convertToParamMap({ step: '4' }));
      // Deliberately do not override CommitteeManageComponent's template, StepperModule, or its child.
    });

    async function renderRealStepper(mode: 'edit' | 'create' = 'edit') {
      const fixture = TestBed.createComponent(CommitteeManageComponent);
      const component = fixture.componentInstance;
      component.mode.set(mode);
      component.form.patchValue({ name: 'Example Group', category: 'Technical Steering Committee' });
      component.memberUpdates.set({
        toAdd: [{ email: 'imported@example.com', first_name: 'First', last_name: 'Last', createOptions: { skipNotification: true } }],
        toUpdate: [],
        toDelete: [],
        toInvite: [],
      });
      fixture.detectChanges();
      await fixture.whenStable();
      return fixture;
    }

    it.each(['edit', 'create'] as const)('finds the projected member manager and enables the real %s save button once loaded', async (mode) => {
      const fixture = await renderRealStepper(mode);
      const component = fixture.componentInstance;
      const testId = mode === 'edit' ? 'committee-manage-update-btn' : 'committee-manage-done-btn';
      const button: HTMLButtonElement = fixture.nativeElement.querySelector(`[data-testid="${testId}"] button`);
      expect(fixture.debugElement.query(By.directive(CommitteeMembersManagerComponent))).not.toBeNull();
      expect(button).not.toBeNull();
      expect(button.disabled).toBe(true);
      expect(component.memberSaveDisabled()).toBe(true);
      button.click();
      expect(createCommitteeMember).not.toHaveBeenCalled();
      expect(updateCommittee).not.toHaveBeenCalled();

      groupResponse.next(enrichedCommittee());
      groupResponse.complete();
      await fixture.whenStable();
      expect(button.disabled).toBe(true);
      membersResponse.next([]);
      membersResponse.complete();
      await fixture.whenStable();

      expect(component.memberSaveDisabled()).toBe(false);
      expect(button.disabled).toBe(false);
      button.click();
      await fixture.whenStable();
      expect(createCommitteeMember).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, expect.objectContaining({ email: 'imported@example.com' }), {
        skipNotification: true,
      });
      expect(updateCommittee).toHaveBeenCalledTimes(mode === 'edit' ? 1 : 0);
      expect(navigate).toHaveBeenCalledWith(['/groups']);
    });

    it.each(['members', 'committee'] as const)('keeps the real Update Group button disabled after a %s load failure', async (failedLoad) => {
      const fixture = await renderRealStepper();
      const component = fixture.componentInstance;
      const pending = component.memberUpdates();
      const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="committee-manage-update-btn"] button');
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        if (failedLoad === 'members') {
          groupResponse.next(enrichedCommittee());
          groupResponse.complete();
          membersResponse.error(new HttpErrorResponse({ status: 503 }));
        } else {
          membersResponse.next([]);
          membersResponse.complete();
          groupResponse.error(new HttpErrorResponse({ status: 503 }));
        }
        await fixture.whenStable();
        expect(component.memberSaveDisabled()).toBe(true);
        expect(button.disabled).toBe(true);
        button.click();
        component.onSubmitAll();
        expect(updateCommittee).not.toHaveBeenCalled();
        expect(createCommitteeMember).not.toHaveBeenCalled();
        expect(component.memberUpdates()).toEqual(pending);
      } finally {
        errorLog.mockRestore();
      }
    });
  });

  describe('Members Can View Social Listening save rule', () => {
    async function clean(category: string): Promise<Record<string, unknown>> {
      getCommittee.mockReturnValue(of(enrichedCommittee()));
      const fixture = await createComponent();
      const instance = fixture.componentInstance as unknown as { cleanFormData: (data: Record<string, unknown>) => Record<string, unknown> };
      return instance.cleanFormData({ category, members_can_view_social_listening: true });
    }

    it('keeps the setting on for a Board group', async () => {
      expect((await clean('Board'))['members_can_view_social_listening']).toBe(true);
    });

    it('saves the setting as off for any other group', async () => {
      expect((await clean('Working Group'))['members_can_view_social_listening']).toBe(false);
    });
  });
});
