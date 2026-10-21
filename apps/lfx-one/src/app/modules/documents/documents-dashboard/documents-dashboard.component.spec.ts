// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyDocumentItem, Project, ProjectContext, ProjectDocument } from '@lfx-one/shared/interfaces';
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
  let routeLens: WritableSignal<string | null>;
  let projectDocuments: ProjectDocument[];
  let legacyDocuments: MyDocumentItem[];
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
    routeLens = signal<string | null>('project');
    projectDocuments = [];
    legacyDocuments = [];
  });

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [DocumentsDashboardComponent],
      providers: [
        { provide: DocumentService, useValue: { getMyDocuments: vi.fn(() => of(legacyDocuments)) } },
        { provide: ProjectService, useValue: { getProjectDocuments: vi.fn(() => of(projectDocuments)) } },
        {
          provide: ProjectContextService,
          useValue: { activeContext, canWrite, activeProject, activeRouteLensKind: routeLens },
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

  function document(uid: string, date: string, overrides: Partial<ProjectDocument> = {}): ProjectDocument {
    return { uid, type: 'link', name: uid, created_at: date, ...overrides };
  }

  function legacyDocument(id: string, date: string, overrides: Partial<MyDocumentItem> = {}): MyDocumentItem {
    return { id, name: id, date, source: 'link', foundationName: '', groupOrMeetingName: '', groupOrMeetingUid: '', ...overrides };
  }

  function visibleIds(): string[] {
    return fixture.componentInstance['filteredDocuments']().map((doc) => doc.id);
  }

  it('keeps alphabetical folders first and sorts mixed-source root documents by displayed date without mutating the response', async () => {
    projectDocuments = [
      document('old', '2026-01-01', { name: 'A file', updated_at: '2026-12-01' }),
      document('z-folder', '2026-10-01', { type: 'folder' }),
      document('new', '2026-10-01', { name: 'Z file', document_source: 'meeting' }),
      document('a-folder', '2026-01-01', { type: 'folder' }),
      document('nested', '2026-11-01', { parent_uid: 'a-folder' }),
      document('fallback', '2026-06-01', { created_at: undefined, updated_at: '2026-06-01', document_source: 'committee' }),
    ];
    const original = structuredClone(projectDocuments);
    await render();

    expect(visibleIds()).toEqual(['project_folder:a-folder', 'project_folder:z-folder', 'project_link:new', 'project_link:fallback', 'project_link:old']);
    expect(fixture.componentInstance['filteredDocuments']()[0].childCount).toBe(1);
    expect(projectDocuments).toEqual(original);
  });

  it('sorts folder contents newest-first and retains root ordering on breadcrumb navigation', async () => {
    projectDocuments = [
      document('folder', '', { type: 'folder' }),
      document('old', '2026-01-01', { parent_uid: 'folder' }),
      document('new', '2026-10-01', { parent_uid: 'folder' }),
      document('root', '2026-11-01'),
    ];
    await render();
    fixture.componentInstance['onFolderOpen'](fixture.componentInstance['filteredDocuments']()[0]);
    await fixture.whenStable();
    expect(visibleIds()).toEqual(['project_link:new', 'project_link:old']);

    fixture.componentInstance['onBreadcrumbHome']();
    await fixture.whenStable();
    expect(visibleIds()).toEqual(['project_folder:folder', 'project_link:root']);
  });

  it('preserves newest-first ordering through source filtering, root search across folders, and refresh', async () => {
    projectDocuments = [
      document('folder', '', { type: 'folder' }),
      document('old', '2026-01-01', { name: 'Report old', document_source: 'meeting' }),
      document('new', '2026-10-01', { name: 'Report new', document_source: 'meeting' }),
      document('nested', '2026-11-01', { name: 'Report nested', parent_uid: 'folder', document_source: 'meeting' }),
      document('other', '2026-12-01', { document_source: 'committee' }),
    ];
    await render();
    const component = fixture.componentInstance;
    component['onProjectSourceTabChange']('meeting');
    expect(visibleIds()).toEqual(['project_link:new', 'project_link:old']);

    component['filterForm'].controls.search.setValue('Report');
    await vi.waitFor(() => expect(visibleIds()).toEqual(['project_link:nested', 'project_link:new', 'project_link:old']));

    projectDocuments = [...projectDocuments, document('latest', '2026-12-01', { name: 'Report latest', document_source: 'meeting' })];
    component['refreshTrigger'].update((value) => value + 1);
    await fixture.whenStable();
    expect(visibleIds()).toEqual(['project_link:latest', 'project_link:nested', 'project_link:new', 'project_link:old']);
  });

  it('shows per-source counts on the project pills, follows the search, and filters rows when selected', async () => {
    projectDocuments = [
      document('p1', '2026-01-01', { name: 'Plan one' }),
      document('c1', '2026-01-02', { name: 'Plan two', document_source: 'committee' }),
      document('m1', '2026-01-03', { name: 'Notes', document_source: 'meeting' }),
      document('r1', '2026-01-04', { name: 'Recording', document_source: 'recording' }),
      document('ml1', '2026-01-05', { name: 'List', document_source: 'mailing_list' }),
    ];
    await render();
    const component = fixture.componentInstance;
    const labels = () => component['projectSourceTabOptions']().map((option) => option.label);

    expect(labels()).toEqual(['All (5)', 'Project (1)', 'Groups (1)', 'Meetings (2)', 'Mailing Lists (1)']);
    expect(fixture.nativeElement.querySelector('[data-testid="documents-dashboard-source-filter"]')).toBeNull();

    component['onProjectSourceTabChange']('meeting');
    expect(visibleIds()).toEqual(['project_link:r1', 'project_link:m1']);
    // Counts ignore the selected pill so every pill keeps showing what it would list.
    expect(labels()).toEqual(['All (5)', 'Project (1)', 'Groups (1)', 'Meetings (2)', 'Mailing Lists (1)']);

    component['filterForm'].controls.search.setValue('Plan');
    await vi.waitFor(() => expect(labels()).toEqual(['All (2)', 'Project (1)', 'Groups (1)', 'Meetings', 'Mailing Lists']));
  });

  it('sorts the legacy My Documents feed globally across sources before pagination and after filtering', async () => {
    routeLens.set('me');
    legacyDocuments = [
      legacyDocument('old-link', '2026-01-01'),
      ...Array.from({ length: 11 }, (_, index) => legacyDocument(`meeting-${index}`, `2026-10-${String(index + 1).padStart(2, '0')}`, { source: 'meeting' })),
      legacyDocument('latest-link', '2026-11-01'),
    ];
    const original = structuredClone(legacyDocuments);
    await render();
    expect(visibleIds()).toEqual(['latest-link', ...Array.from({ length: 11 }, (_, index) => `meeting-${10 - index}`), 'old-link']);
    expect(fixture.componentInstance['rppOptions']()).toEqual([10, 25, 50]);
    expect(legacyDocuments).toEqual(original);

    fixture.componentInstance['onSourceTabChange']('link');
    expect(visibleIds()).toEqual(['latest-link', 'old-link']);
  });

  it('uses name and ID tie-breakers and places missing or invalid dates after all valid dates', async () => {
    await render();
    // Exercise malformed-date ordering independently: DatePipe cannot render malformed dates.
    const documents = [
      legacyDocument('missing-z', '', { name: 'Z' }),
      legacyDocument('same-b', '2026-10-01T00:00:00Z', { name: 'Same' }),
      legacyDocument('invalid', 'not-a-date', { name: 'A' }),
      legacyDocument('epoch', '1960-01-01'),
      legacyDocument('same-a', '2026-09-30T20:00:00-04:00', { name: 'Same' }),
      legacyDocument('alpha', '2026-10-01T00:00:00Z', { name: 'Alpha' }),
      legacyDocument('missing-a', '', { name: 'A' }),
    ];
    expect(documents.sort(fixture.componentInstance['compareDocuments']).map((doc) => doc.id)).toEqual([
      'alpha',
      'same-a',
      'same-b',
      'epoch',
      'invalid',
      'missing-a',
      'missing-z',
    ]);
  });
});
