// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Project, ProjectContext } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieRegistryService } from './cookie-registry.service';
import { FeatureFlagService } from './feature-flag.service';
import { LensService } from './lens.service';
import { PersonaService } from './persona.service';
import { ProjectContextService } from './project-context.service';
import { ProjectService } from './project.service';
import { UserService } from './user.service';

const CONTEXT: ProjectContext = { uid: 'proj-1', name: 'Project One', slug: 'project-one' };

/** Minimal fixture; only `stage` matters for the assertions below. */
function project(stage: string): Project {
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
  } as Project;
}

describe('ProjectContextService — Formation signals (GH-1955)', () => {
  let getProject: ReturnType<typeof vi.fn>;
  let userService: UserService;
  let service: ProjectContextService;

  beforeEach(() => {
    getProject = vi.fn().mockReturnValue(of(project('Active')));

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectService, useValue: { getProject, getProjectSfid: vi.fn().mockReturnValue(of(null)) } },
        { provide: SsrCookieService, useValue: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } },
        { provide: CookieRegistryService, useValue: { registerCookie: vi.fn(), unregisterCookie: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: PersonaService,
          useValue: { isMarketingAuditor: signal(false), isCampaignManager: signal(false), marketingGrantSlug: signal(null), currentPersona: signal(null) },
        },
        { provide: Router, useValue: { getCurrentNavigation: () => null, parseUrl: vi.fn(), serializeUrl: vi.fn(), url: '/' } },
        { provide: Location, useValue: { replaceState: vi.fn() } },
        { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of({})), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });

    userService = TestBed.inject(UserService);
    userService.authenticated.set(true);
    service = TestBed.inject(ProjectContextService);
    service.setRouteLensKind('project');
    // `syncUrl: false` — this suite only cares about the Formation signals, not URL sync.
    service.setProject(CONTEXT, false);
    TestBed.inject(ApplicationRef).tick();
  });

  it.each([
    ['Formation - Exploratory', 'Exploratory'],
    ['Formation - Engaged', 'Engaged'],
    ['Formation - On Hold', 'On Hold'],
    ['Formation - Disengaged', 'Disengaged'],
    ['Formation - Confidential', 'Confidential'],
    ['Draft', 'Draft'],
  ])('reports isActiveProjectInFormation=true and the %s sub-stage label for stage %s', (stage, expectedLabel) => {
    getProject.mockReturnValue(of(project(stage)));
    service.setProject({ ...CONTEXT, uid: `${CONTEXT.uid}-${stage}` }, false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.activeProjectFormationSubStage()).toBe(expectedLabel);
    expect(service.isActiveProjectInFormation()).toBe(true);
  });

  it.each(['Active', 'Archived', 'Prospect'])('reports isActiveProjectInFormation=false for stage %s', (stage) => {
    getProject.mockReturnValue(of(project(stage)));
    service.setProject({ ...CONTEXT, uid: `${CONTEXT.uid}-${stage}` }, false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.activeProjectFormationSubStage()).toBeNull();
    expect(service.isActiveProjectInFormation()).toBe(false);
  });

  it('stays false with no active project fetched when unauthenticated (LFXV2-3266 auth gate)', () => {
    userService.authenticated.set(false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.isActiveProjectInFormation()).toBe(false);
    expect(service.canWrite()).toBe(false);
  });

  it('derives canWrite from the same shared fetch as the Formation signals', () => {
    getProject.mockReturnValue(of({ ...project('Active'), writer: true }));
    service.setProject({ ...CONTEXT, uid: 'writer-project' }, false);
    TestBed.inject(ApplicationRef).tick();

    expect(service.canWrite()).toBe(true);
  });
});
