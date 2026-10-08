// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Project, ProjectContext } from '@lfx-one/shared/interfaces';
import { DocumentService } from '@services/document.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentsDashboardComponent } from './documents-dashboard.component';

describe('DocumentsDashboardComponent', () => {
  let fixture: ComponentFixture<DocumentsDashboardComponent>;
  let activeContext: WritableSignal<ProjectContext | null>;
  let canWrite: WritableSignal<boolean>;
  /**
   * The context's resolved project. `canUpload` requires its uid to match `activeContext`'s uid,
   * so the default agrees with the rendered project and only the staleness test drives them apart
   * (mirrors the gate in project-staff-card.component.spec.ts).
   */
  let activeProject: WritableSignal<Project | null>;

  function buildContext(uid: string): ProjectContext {
    return { uid, slug: uid, name: 'Project One' } as ProjectContext;
  }

  beforeEach(() => {
    activeContext = signal<ProjectContext | null>(buildContext('project-1'));
    canWrite = signal(true);
    activeProject = signal<Project | null>({ uid: 'project-1', writer: true } as Project);
  });

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [DocumentsDashboardComponent],
      providers: [
        { provide: DocumentService, useValue: { getMyDocuments: vi.fn(() => of([])) } },
        { provide: ProjectService, useValue: { getProjectDocuments: vi.fn(() => of([])) } },
        {
          provide: ProjectContextService,
          useValue: { activeContext, canWrite, activeProject, activeRouteLensKind: signal('project') },
        },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        { provide: PersonaService, useValue: { personaLoaded: signal(true) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentsDashboardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function toolbar(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="documents-dashboard-toolbar"]');
  }

  it('shows the upload toolbar when project-scoped with write access', async () => {
    await render();
    expect(toolbar()).toBeTruthy();
  });

  it('hides the upload toolbar when the active project is read-only', async () => {
    canWrite.set(false);
    activeProject.set({ uid: 'project-1', writer: false } as Project);
    await render();
    expect(toolbar()).toBeFalsy();
  });

  it('hides the upload toolbar while canWrite still reflects the previous project (GH-305)', async () => {
    // Simulates the mid-switch window described in project-context.service.ts's
    // initActiveProjectDetails(): activeContext has already moved to the new (read-only) project,
    // but activeProject()/canWrite() still describe the previous (writable) one.
    activeContext.set(buildContext('project-2'));
    await render();
    expect(toolbar()).toBeFalsy();
  });
});
