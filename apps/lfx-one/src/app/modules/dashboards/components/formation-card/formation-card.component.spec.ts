// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Formation, Project, ProjectSettings } from '@lfx-one/shared/interfaces';
import { getFormationSubStageLabel } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { catchError, map, Observable, of, tap, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FormationCardComponent } from './formation-card.component';

function project(stage: string, overrides: Partial<Project> = {}): Project {
  return {
    uid: 'proj-1',
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
    ...overrides,
  } as Project;
}

function settings(): ProjectSettings {
  return {
    uid: 'proj-1',
    announcement_date: '2026-09-01',
    writers: [],
    auditors: [],
    executive_director: { name: 'Ada Lovelace', email: 'ada@example.com' },
    program_manager: null,
    opportunity_owner: null,
    created_at: '',
    updated_at: '',
  };
}

describe('FormationCardComponent', () => {
  let fixture: ComponentFixture<FormationCardComponent>;
  let getProjectSpy: ReturnType<typeof vi.fn>;

  async function render(
    stage: string,
    auditor: boolean,
    options: {
      sfid?: string | null;
      settingsResult?: Observable<ProjectSettings>;
      projectOverrides?: Partial<Project>;
      getProjectResult?: Partial<Project>;
    } = {}
  ): Promise<void> {
    const { sfid = 'sfid-1', settingsResult = of(settings()), projectOverrides = {}, getProjectResult } = options;
    TestBed.resetTestingModule();
    getProjectSpy = vi.fn(() => of(project(stage, { ...projectOverrides, auditor, ...getProjectResult })));

    // Mirrors ProjectContextService's own tri-state pipeline so the mock behaves like the real
    // shared signals (loading flips false, hasError flips true) rather than hardcoding both false.
    const announcementDateLoading = signal(true);
    const announcementDateHasError = signal(false);
    const announcementDate = signal<string | null>(null);
    settingsResult
      .pipe(
        map((s) => s.announcement_date || null),
        tap((date) => {
          announcementDate.set(date);
          announcementDateLoading.set(false);
        }),
        catchError(() => {
          announcementDateLoading.set(false);
          announcementDateHasError.set(true);
          return of(null);
        })
      )
      .subscribe();

    await TestBed.configureTestingModule({
      imports: [FormationCardComponent],
      providers: [
        {
          provide: ProjectService,
          useValue: {
            getProjectSfid: () => of(sfid),
            getProject: getProjectSpy,
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            activeProject: signal(project(stage, projectOverrides)),
            activeProjectFormationSubStage: signal(getFormationSubStageLabel(stage)),
            activeProjectAnnouncementDate: announcementDate,
            activeProjectAnnouncementDateLoading: announcementDateLoading,
            activeProjectAnnouncementDateHasError: announcementDateHasError,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationCardComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it.each([
    ['Formation - Exploratory', 'Exploratory'],
    ['Formation - Engaged', 'Engaged'],
    ['Formation - On Hold', 'On Hold'],
    ['Formation - Disengaged', 'Disengaged'],
    ['Formation - Confidential', 'Confidential'],
  ])('renders the %s sub-stage as %s', async (stage, label) => {
    await render(stage, false);

    expect(text()).toContain(label);
  });

  it('never renders the literal string "PCC", staff or not', async () => {
    await render('Formation - Engaged', false);
    expect(text()).not.toContain('PCC');

    await render('Formation - Engaged', true);
    expect(text()).not.toContain('PCC');
  });

  it('hides the admin-tool links and "Admin only" chip for a non-auditor, non-writer user', async () => {
    await render('Formation - Engaged', false);

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).toBeNull();
  });

  it('shows the admin-tool link and "Admin only" chip for an auditor with a resolved SFID', async () => {
    await render('Formation - Engaged', true, { sfid: 'sfid-1' });

    const links = fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]');
    expect(links).not.toBeNull();
    expect(text()).toContain('Admin only');
    expect(text()).toContain('Open in admin tool');
    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-tool-link"]').getAttribute('href')).toBe(
      'https://pcc.dev.platform.linuxfoundation.org/project/sfid-1'
    );
    expect(getProjectSpy).toHaveBeenCalledWith('proj-1', false, { auditor: true });
  });

  it('shows the admin-tool link for a project writer even though the server omits `auditor` for writers', async () => {
    // Mirrors the server: getProjectById returns early for writers, so `auditor` comes back
    // undefined rather than true. `isAuditor`'s `writer === true` OR-branch must still admit them.
    await render('Formation - Engaged', false, { sfid: 'sfid-1', getProjectResult: { writer: true, auditor: undefined } });

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).not.toBeNull();
  });

  it('hides the admin-tool links for an auditor with no v1 mapping (null SFID)', async () => {
    await render('Formation - Engaged', true, { sfid: null });

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).toBeNull();
  });

  it('formats the announcement date via the shared ISO-date label, and falls back to "Not set"', async () => {
    await render('Formation - Engaged', false);
    expect(text()).toContain('Sep 1, 2026');

    await render('Formation - Engaged', false, { settingsResult: of({ ...settings(), announcement_date: '' }) });
    expect(text()).toContain('Not set');
  });

  // #2719: both checklist hosts pass the response their section just fetched, so the card costs no
  // extra request and is visible to whoever could read the checklist. On the foundation drill-down
  // ProjectContextService describes the PARENT FOUNDATION, so reading it here at all would pair the
  // foundation's slug with a child project's checklist — the throwing provider below is what keeps
  // that regression from reappearing.
  describe('formation input (#2719)', () => {
    /**
     * Every member the card reads in context mode, each of which throws. A Proxy would be terser
     * but Angular's injector profiler touches `constructor` on a provided value, so it would trip
     * on wiring rather than on a real read.
     */
    function throwingProjectContext(): Record<string, never> {
      const members = [
        'activeProject',
        'activeProjectFormationSubStage',
        'activeProjectAnnouncementDate',
        'activeProjectAnnouncementDateLoading',
        'activeProjectAnnouncementDateHasError',
      ];
      const stub = {};
      for (const member of members) {
        Object.defineProperty(stub, member, {
          get: () => {
            throw new Error(`FormationCardComponent read ProjectContextService.${member} while its formation input was set`);
          },
        });
      }
      return stub as Record<string, never>;
    }

    function formation(overrides: Partial<Formation> = {}): Formation {
      return {
        parent_project_uid: 'child-uid',
        parent_project_slug: 'child-project',
        parent_project_name: 'Child Project',
        is_foundation: false,
        parent_uid: null,
        template_uid: 'template:test',
        template_version: 1,
        sub_stage: null,
        sub_stage_raw: 'Formation - Engaged',
        lifecycle: null,
        lifecycle_raw: '',
        announcement_date: '2026-10-25',
        is_activating: false,
        gating_items_open: 0,
        gating_items_total: 0,
        blocking_item_title: null,
        subtitle: null,
        ...overrides,
      };
    }

    async function renderWithInput(value: Formation): Promise<void> {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [FormationCardComponent],
        providers: [
          { provide: ProjectService, useValue: { getProjectSfid: () => of(null), getProject: () => of(project('Formation - Engaged')) } },
          { provide: ProjectContextService, useValue: throwingProjectContext() },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(FormationCardComponent);
      fixture.componentRef.setInput('formation', value);
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('renders the sub-stage, announcement date and slug from the response, never from the project context', async () => {
      await renderWithInput(formation());

      expect(text()).toContain('Engaged');
      expect(text()).toContain('Oct 25, 2026');
      expect(text()).toContain('child-project');
      expect(text()).not.toContain('project-one');
    });

    it('falls back to "Not set" when the response carries no announcement date, without the loading or error states', async () => {
      // The BFF degrades a failed (auditor-gated) settings read to null rather than failing the
      // checklist, so a null date here is an expected value, not an error — and nothing is still
      // in flight, because the date arrived with the response.
      await renderWithInput(formation({ announcement_date: null }));

      expect(text()).toContain('Not set');
      expect(fixture.nativeElement.querySelector('[data-testid="formation-card-error"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('p-skeleton')).toBeNull();
    });

    it('omits the sub-stage pill when the raw stage is not a Formation sub-stage', async () => {
      await renderWithInput(formation({ sub_stage_raw: 'Active' }));

      expect(fixture.nativeElement.querySelector('[data-testid="formation-card"]')).not.toBeNull();
      expect(text()).not.toContain('Engaged');
    });
  });

  it('shows the error state when the settings fetch fails, without hiding data that already loaded (the sub-stage pill, slug, and admin links)', async () => {
    await render('Formation - Engaged', true, { settingsResult: throwError(() => new Error('network error')) });

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-error"]')).not.toBeNull();
    expect(text()).toContain('Engaged');
    expect(text()).toContain('project-one');
    // Admin links depend on isAuditor/sfid, not on the failed settings fetch — they must still show.
    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).not.toBeNull();
  });
});
