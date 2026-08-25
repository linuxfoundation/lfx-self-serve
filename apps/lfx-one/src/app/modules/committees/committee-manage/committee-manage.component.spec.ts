// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, NavigationEnd, Router } from '@angular/router';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { Committee, Project } from '@lfx-one/shared/interfaces';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BehaviorSubject, of } from 'rxjs';
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
        { provide: CommitteeService, useValue: { getCommittee, getCommitteesByProject: vi.fn().mockReturnValue(of([])) } },
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
        { provide: PersonaService, useValue: { currentPersona: signal('maintainer') } },
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
});
