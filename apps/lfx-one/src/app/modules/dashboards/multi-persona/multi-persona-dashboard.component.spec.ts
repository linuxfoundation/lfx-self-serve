// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { EnrichedPersonaProject, Meeting, PastMeeting, PendingActionItem, PersonaType, Survey } from '@lfx-one/shared/interfaces';
import { AnalyticsService } from '@services/analytics.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { FormationService } from '@services/formation.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SurveyService } from '@services/survey.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { MultiPersonaDashboardComponent } from './multi-persona-dashboard.component';

describe('MultiPersonaDashboardComponent — Role Resolution (#5765)', () => {
  let fixture: ComponentFixture<MultiPersonaDashboardComponent>;
  let comp: MultiPersonaDashboardComponent;

  function makeProject(overrides: Partial<EnrichedPersonaProject>): EnrichedPersonaProject {
    return {
      projectUid: 'test-uid',
      projectName: 'Test Project',
      projectSlug: 'test-slug',
      parentProjectUid: null,
      isFoundation: false,
      tierResolved: true,
      logoUrl: null,
      description: null,
      personas: [],
      detections: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [MultiPersonaDashboardComponent],
      providers: [
        {
          provide: PersonaService,
          useValue: {
            detectedProjects: signal<EnrichedPersonaProject[]>([]),
            allPersonas: signal<PersonaType[]>([]),
            activePersona: signal<PersonaType>('contributor'),
            refreshEnrichedPersonas: () => of([]),
            getDetections: () => of([]),
          },
        },
        {
          provide: AnalyticsService,
          useValue: {
            getMultiFoundationSummary: () => of(null),
          },
        },
        {
          provide: SurveyService,
          useValue: {
            getMySurveys: () => of([] as Survey[]),
          },
        },
        {
          provide: UserService,
          useValue: {
            user: signal(null),
            impersonating: signal(false),
            getUserMeetings: () => of([] as Meeting[]),
            getUserPastMeetings: () => of([] as PastMeeting[]),
          },
        },
        {
          provide: ProjectService,
          useValue: {
            getPendingActions: () => of([] as PendingActionItem[]),
          },
        },
        {
          provide: FormationService,
          useValue: {
            getMyFormationWork: () => of(null),
          },
        },
        {
          provide: FeatureFlagService,
          useValue: {
            getBooleanFlag: () => signal(false),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            activeProjectContext: signal(null),
            selectProject: () => {},
            setFoundation: () => {},
            setProject: () => {},
          },
        },
        {
          provide: LensService,
          useValue: {
            setLens: () => {},
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: () => Promise.resolve(true),
          },
        },
      ],
    });

    TestBed.overrideComponent(MultiPersonaDashboardComponent, {
      set: { template: '', imports: [] },
    });

    await TestBed.compileComponents();

    fixture = TestBed.createComponent(MultiPersonaDashboardComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function getRowRole(project: EnrichedPersonaProject): string {
    return (comp as unknown as { getRowRole: (p: EnrichedPersonaProject) => string }).getRowRole(project);
  }

  function normalizeRole(role: string): string {
    return (comp as unknown as { normalizeRole: (r: string) => string }).normalizeRole(role);
  }

  it('normalizes None and Member to Group Member', () => {
    expect(normalizeRole('None')).toBe('Group Member');
    expect(normalizeRole('Member')).toBe('Group Member');
    expect(normalizeRole('')).toBe('Group Member');
    expect(normalizeRole('LF Staff')).toBe('LF Staff');
    expect(normalizeRole('Chair')).toBe('Chair');
  });

  it('maps foundation with detection role "None" to "Group Member" instead of literal "None"', () => {
    const foundation = makeProject({
      isFoundation: true,
      detections: [
        {
          source: 'board_member',
          extra: { role: 'None', voting_status: 'None' },
        },
      ],
    });

    expect(getRowRole(foundation)).toBe('Group Member');
  });

  it('maps foundation with detection role "LF Staff" to "LF Staff"', () => {
    const foundation = makeProject({
      isFoundation: true,
      detections: [
        {
          source: 'committee_member',
          extra: { role: 'LF Staff' },
        },
      ],
    });

    expect(getRowRole(foundation)).toBe('LF Staff');
  });

  it('resolves project with committee "LF Staff" detection over persona "maintainer"', () => {
    const project = makeProject({
      isFoundation: false,
      personas: ['maintainer'],
      detections: [
        {
          source: 'committee_member',
          extra: { role: 'LF Staff' },
        },
      ],
    });

    expect(getRowRole(project)).toBe('LF Staff');
  });

  it('resolves project with committee "Chair" detection over persona "maintainer"', () => {
    const project = makeProject({
      isFoundation: false,
      personas: ['maintainer'],
      detections: [
        {
          source: 'committee_member',
          extra: { role: 'Chair' },
        },
      ],
    });

    expect(getRowRole(project)).toBe('Chair');
  });

  it('resolves project with maintainer persona and no committee detection to Maintainer', () => {
    const project = makeProject({
      isFoundation: false,
      personas: ['maintainer'],
      detections: [],
    });

    expect(getRowRole(project)).toBe('Maintainer');
  });

  it('resolves project with contributor persona and no committee detection to Contributor', () => {
    const project = makeProject({
      isFoundation: false,
      personas: ['contributor'],
      detections: [],
    });

    expect(getRowRole(project)).toBe('Contributor');
  });

  it('resolves project with multiple detections picking higher priority role over None', () => {
    const project = makeProject({
      isFoundation: true,
      detections: [
        {
          source: 'board_member',
          extra: { role: 'None', voting_status: 'None' },
        },
        {
          source: 'committee_member',
          extra: { role: 'Treasurer' },
        },
      ],
    });

    expect(getRowRole(project)).toBe('Treasurer');
  });

  it('resolves project with executive-director persona over maintainer persona', () => {
    const project = makeProject({
      isFoundation: false,
      personas: ['executive-director', 'maintainer'],
      detections: [],
    });

    expect(getRowRole(project)).toBe('Executive Director');
  });

  it('resolves project with no personas and no detections to Group Member', () => {
    const project = makeProject({
      isFoundation: false,
      personas: [],
      detections: [],
    });

    expect(getRowRole(project)).toBe('Group Member');
  });
});
