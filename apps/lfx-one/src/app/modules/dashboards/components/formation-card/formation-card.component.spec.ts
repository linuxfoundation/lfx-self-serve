// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Project, ProjectSettings } from '@lfx-one/shared/interfaces';
import { getFormationSubStageLabel } from '@lfx-one/shared/utils';
import { PermissionsService } from '@services/permissions.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { Observable, of, throwError } from 'rxjs';
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
        { provide: PermissionsService, useValue: { getProjectSettings: () => settingsResult } },
        {
          provide: ProjectContextService,
          useValue: {
            activeProject: signal(project(stage, projectOverrides)),
            activeProjectFormationSubStage: signal(getFormationSubStageLabel(stage)),
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

  it('shows the error state when the settings fetch fails, without hiding data that already loaded (the sub-stage pill, slug, and admin links)', async () => {
    await render('Formation - Engaged', true, { settingsResult: throwError(() => new Error('network error')) });

    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-error"]')).not.toBeNull();
    expect(text()).toContain('Engaged');
    expect(text()).toContain('project-one');
    // Admin links depend on isAuditor/sfid, not on the failed settings fetch — they must still show.
    expect(fixture.nativeElement.querySelector('[data-testid="formation-card-admin-links"]')).not.toBeNull();
  });
});
