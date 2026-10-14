// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, DefaultUrlSerializer, NavigationEnd, Router, UrlTree } from '@angular/router';
import { Committee, Project, ProjectContext, Survey } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SurveyService } from '@services/survey.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyManageComponent } from './survey-manage.component';

describe('SurveyManageComponent write-access eviction', () => {
  const SURVEY_UID = 'survey-uid';
  const PROJECT_UID = 'survey-project-uid';
  const PROJECT_SLUG = 'survey-project';
  const PRIMARY_UID = 'primary-committee';
  const SECONDARY_UID = 'secondary-committee';
  const serializer = new DefaultUrlSerializer();

  let fixture: ComponentFixture<SurveyManageComponent>;
  let surveyResponse$: Subject<Survey>;
  let projectResponse$: Subject<Project | null>;
  let primaryResponse$: Subject<Committee | null>;
  let secondaryResponse$: Subject<Committee | null>;
  let activeContext: ReturnType<typeof signal<ProjectContext | null>>;
  let activeLens: ReturnType<typeof signal<'project' | 'foundation'>>;
  let getSurvey: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let fetchCommittee: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;

  const survey = (isFoundation = false): Survey => ({
    uid: SURVEY_UID,
    survey_title: 'Test survey',
    survey_status: 'draft',
    survey_cutoff_date: null,
    is_nps_survey: false,
    is_project_survey: false,
    project_uid: PROJECT_UID,
    project_slug: PROJECT_SLUG,
    project_name: 'Survey Project',
    is_foundation: isFoundation,
    committees: [PRIMARY_UID, SECONDARY_UID].map((uid) => ({
      committee_id: uid,
      committee_uid: uid,
      committee_name: uid,
      project_id: PROJECT_UID,
      project_uid: PROJECT_UID,
      project_name: 'Survey Project',
      total_recipients: 0,
      total_responses: 0,
      nps_value: 0,
      num_detractors: 0,
      num_passives: 0,
      num_promoters: 0,
    })),
    committee_category: 'Technical',
    total_responses: 0,
    total_recipients: 0,
    created_at: '2026-01-01T00:00:00Z',
    last_modified_at: '2026-01-01T00:00:00Z',
    creator_name: 'Test Creator',
  });

  const settleProject = async (writer: boolean): Promise<void> => {
    projectResponse$.next({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: 'Survey Project', writer } as Project);
    projectResponse$.complete();
    await fixture.whenStable();
  };

  const settleCommittee = async (response$: Subject<Committee | null>, uid: string, writer: boolean): Promise<void> => {
    response$.next({ uid, writer } as Committee);
    // The real sequential probe reduces only when the response completes (or a writer grants).
    response$.complete();
    await fixture.whenStable();
  };

  const mountEditor = async (): Promise<void> => {
    fixture = TestBed.createComponent(SurveyManageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.isEditMode()).toBe(true);
    expect(getSurvey).toHaveBeenCalledWith(SURVEY_UID);
  };

  const expectEditorRetained = (): void => {
    expect(fixture.componentRef.hostView.destroyed).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="survey-editor"]')).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  };

  const loadSurvey = async (isFoundation = false): Promise<void> => {
    surveyResponse$.next(survey(isFoundation));
    surveyResponse$.complete();
    await fixture.whenStable();
    expect(activeContext()).toEqual({ uid: PROJECT_UID, name: 'Survey Project', slug: PROJECT_SLUG });
    expect(getProject).toHaveBeenCalledExactlyOnceWith(PROJECT_SLUG, false);
  };

  beforeEach(() => {
    surveyResponse$ = new Subject<Survey>();
    projectResponse$ = new Subject<Project | null>();
    primaryResponse$ = new Subject<Committee | null>();
    secondaryResponse$ = new Subject<Committee | null>();
    activeContext = signal<ProjectContext | null>({ uid: 'stale-project-uid', name: 'Stale Project', slug: 'stale-project' });
    activeLens = signal<'project' | 'foundation'>('project');
    getSurvey = vi.fn().mockReturnValue(surveyResponse$.asObservable());
    getProject = vi.fn().mockReturnValue(projectResponse$.asObservable());
    fetchCommittee = vi.fn((uid: string) => {
      if (uid === PRIMARY_UID) return primaryResponse$.asObservable();
      if (uid === SECONDARY_UID) return secondaryResponse$.asObservable();
      throw new Error(`Unexpected committee authorization request: ${uid}`);
    });
    navigate = vi.fn().mockResolvedValue(true);
    navigateByUrl = vi.fn().mockResolvedValue(true);
    const params = convertToParamMap({ id: SURVEY_UID });
    const queryParams = convertToParamMap({ committee_uid: PRIMARY_UID });

    TestBed.configureTestingModule({
      imports: [SurveyManageComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(params), queryParamMap: of(queryParams), snapshot: { paramMap: params, queryParamMap: queryParams } },
        },
        {
          provide: Router,
          useValue: {
            // Flat edit URL avoids unrelated tier canonicalization while real context sync runs.
            url: `/surveys/${SURVEY_UID}/edit?committee_uid=${PRIMARY_UID}`,
            events: new Subject<NavigationEnd>().asObservable(),
            parseUrl: vi.fn((url: string) => serializer.parse(url)),
            createUrlTree: vi.fn((commands: string[], options: { queryParams: Record<string, string> }) => {
              const tree = serializer.parse(commands.join('/'));
              tree.queryParams = options.queryParams;
              return tree;
            }),
            navigate,
            navigateByUrl,
          },
        },
        { provide: SurveyService, useValue: { getSurvey, createSurvey: vi.fn().mockReturnValue(of(survey())) } },
        { provide: ProjectService, useValue: { getProject } },
        { provide: CommitteeService, useValue: { fetchCommittee, getCommittee: vi.fn().mockReturnValue(of(null)) } },
        {
          provide: ProjectContextService,
          useValue: {
            activeContext,
            canWrite: signal(false),
            setProject: vi.fn((context: ProjectContext) => activeContext.set(context)),
            setFoundation: vi.fn((context: ProjectContext) => activeContext.set(context)),
            setRouteLensKind: vi.fn((kind: 'project' | 'foundation') => activeLens.set(kind)),
          },
        },
        { provide: LensService, useValue: { activeLens } },
        { provide: PersonaService, useValue: { currentPersona: signal('maintainer') } },
        { provide: ConfirmationService, useValue: { confirm: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).overrideComponent(SurveyManageComponent, {
      set: { imports: [], template: '<form data-testid="survey-editor"></form>', styles: [], styleUrls: [] },
    });
  });

  it('retains the editor while the survey and then its owning-project authorization are pending', async () => {
    await mountEditor();
    expectEditorRetained();
    expect(getProject).not.toHaveBeenCalled();
    expect(fetchCommittee).not.toHaveBeenCalled();

    await loadSurvey();
    expectEditorRetained();
    expect(fetchCommittee).not.toHaveBeenCalled();
  });

  it('retains the editor after primary denial while a delayed secondary committee grants write access', async () => {
    await mountEditor();
    await loadSurvey();
    await settleProject(false);
    expect(fetchCommittee).toHaveBeenCalledExactlyOnceWith(PRIMARY_UID);
    expectEditorRetained();

    await settleCommittee(primaryResponse$, PRIMARY_UID, false);
    expect(fetchCommittee.mock.calls).toEqual([[PRIMARY_UID], [SECONDARY_UID]]);
    expectEditorRetained();

    await settleCommittee(secondaryResponse$, SECONDARY_UID, true);
    expectEditorRetained();
    // The active project's own write flag stays false: committee admission must survive it.
    expect(getProject).toHaveBeenCalledTimes(1);
  });

  it.each(['project', 'foundation'] as const)('evicts to the %s safe overview only after every associated committee denies', async (lens) => {
    await mountEditor();
    await loadSurvey(lens === 'foundation');
    await settleProject(false);
    expectEditorRetained();

    await settleCommittee(primaryResponse$, PRIMARY_UID, false);
    expect(fetchCommittee.mock.calls).toEqual([[PRIMARY_UID], [SECONDARY_UID]]);
    expectEditorRetained();

    await settleCommittee(secondaryResponse$, SECONDARY_UID, false);
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    const target = navigateByUrl.mock.calls[0][0] as UrlTree;
    expect(serializer.serialize(target)).toBe(`/${lens}/overview?project=${PROJECT_SLUG}`);
  });

  it('retains a project writer without making any committee authorization request', async () => {
    await mountEditor();
    await loadSurvey();
    await settleProject(true);

    expectEditorRetained();
    expect(fetchCommittee).not.toHaveBeenCalled();
    expect(getProject).toHaveBeenCalledExactlyOnceWith(PROJECT_SLUG, false);
  });
});
