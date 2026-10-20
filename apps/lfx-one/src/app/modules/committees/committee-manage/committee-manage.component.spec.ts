// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, NavigationEnd, Router } from '@angular/router';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { Committee, CommitteeMember, PersonaType, Project, StagedCommitteeMemberRequest } from '@lfx-one/shared/interfaces';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeManageComponent } from './committee-manage.component';

// Regression coverage for the committee edit context-correction flow (GH-1566): an edit payload
// must select the COMMITTEE's project/tier (not the cookie-restored last-visited project), the
// by-uid fallback must apply when enrichment withholds project_slug, the write-access leg must
// stay provisionally true while pending so it cannot evict a guard-admitted user mid-edit, and
// step navigation must merge query params so ?project= survives. Mirrors the meeting-manage
// harness (constructor context-sync streams only — no detectChanges, no template rendering).
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
        { provide: MessageService, useValue: { add: vi.fn() } },
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

  describe('deferred CSV member save', () => {
    let updateCommittee: ReturnType<typeof vi.fn>;
    let createCommitteeMember: ReturnType<typeof vi.fn>;
    let revokeCommitteeInvite: ReturnType<typeof vi.fn>;
    const createdMember = { uid: 'added-1', email: 'ada@example.com', first_name: 'Ada', last_name: 'Example' } as CommitteeMember;

    beforeEach(() => {
      getCommittee.mockReturnValue(of(enrichedCommittee()));
      updateCommittee = vi.fn().mockReturnValue(of(enrichedCommittee()));
      createCommitteeMember = vi.fn().mockReturnValue(of(createdMember));
      revokeCommitteeInvite = vi.fn().mockReturnValue(of(undefined));
      TestBed.overrideProvider(CommitteeService, {
        useValue: { getCommittee, updateCommittee, createCommitteeMember, revokeCommitteeInvite, getCommitteeMembers: vi.fn().mockReturnValue(of([])) },
      });
      // Render the real staging child so partial-save pruning and retry exercise the parent/child contract.
      TestBed.overrideComponent(CommitteeManageComponent, {
        set: {
          template: `<lfx-committee-members-manager [committeeId]="committeeId()" [memberUpdates]="memberUpdates()"
            [submitting]="submitting()" (memberUpdatesChange)="onMemberUpdatesChange($event)" />`,
        },
      });
    });

    async function setupPending(toAdd: StagedCommitteeMemberRequest[]): Promise<CommitteeManageComponent> {
      const fixture = TestBed.createComponent(CommitteeManageComponent);
      const component = fixture.componentInstance;
      component.memberUpdates.set({ toAdd, toUpdate: [], toDelete: [], toInvite: [] });
      component.form.patchValue({ name: 'Example Group', category: 'Technical Steering Committee' });
      await fixture.whenStable();
      return component;
    }

    it.each([true, false])('passes notification suppression %s separately from the native member body', async (skipNotification) => {
      const component = await setupPending([{ email: createdMember.email, createOptions: { skipNotification }, pendingInviteUids: ['invite-1'] }]);
      component.onSubmitAll();
      expect(createCommitteeMember).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, { email: createdMember.email }, { skipNotification });
      expect(revokeCommitteeInvite).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, 'invite-1');
      expect(navigate).toHaveBeenCalledWith(['/groups']);
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
        expect(errorLog).toHaveBeenCalledExactlyOnceWith('CSV member import invitation cleanup failed', { status: 403 });
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

    it('keeps non-CSV additions on their existing notification path with no cleanup', async () => {
      const component = await setupPending([{ email: createdMember.email }]);
      component.onSubmitAll();
      expect(createCommitteeMember).toHaveBeenCalledExactlyOnceWith(COMMITTEE_UID, { email: createdMember.email }, undefined);
      expect(revokeCommitteeInvite).not.toHaveBeenCalled();
    });
  });
});
