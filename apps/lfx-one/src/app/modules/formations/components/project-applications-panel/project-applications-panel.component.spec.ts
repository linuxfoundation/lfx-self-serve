// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ProjectApplication, ProjectApplicationViewMode } from '@lfx-one/shared/interfaces';
import { ProjectApplicationService } from '@services/project-application.service';
import { ProjectService } from '@services/project.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProjectApplicationsPanelComponent } from './project-applications-panel.component';

interface PanelAccess {
  applications: () => ProjectApplication[];
  filteredApplications: () => ProjectApplication[];
  onChanged: (application: ProjectApplication) => void;
  onDeleted: (uid: string) => void;
  onStale: () => void;
  open: (application: ProjectApplication) => void;
  onStateFilterChange: (state: string) => void;
}

function buildApplication(overrides: Partial<ProjectApplication> = {}): ProjectApplication {
  return {
    uid: 'a',
    state: 'submitted',
    revision: 1,
    submitter_username: 'jdoe',
    submitter_name: 'Jane Doe',
    submitter_email: 'jane@example.org',
    target_parent_uid: null,
    application: { project_name: 'Alpha' },
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('ProjectApplicationsPanelComponent (#3037)', () => {
  const setup = async (mode: ProjectApplicationViewMode, fetched: ProjectApplication[], pending: ProjectApplication | null = null) => {
    TestBed.resetTestingModule();
    const service = {
      getApplications: vi.fn(() => of(fetched)),
      consumePendingCreated: vi.fn(() => pending),
    };
    await TestBed.configureTestingModule({
      imports: [ProjectApplicationsPanelComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectApplicationService, useValue: service },
        { provide: ProjectService, useValue: { searchProjects: vi.fn(() => of([])) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
      ],
    }).compileComponents();
    const fixture: ComponentFixture<ProjectApplicationsPanelComponent> = TestBed.createComponent(ProjectApplicationsPanelComponent);
    fixture.componentRef.setInput('mode', mode);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance as unknown as PanelAccess, service };
  };

  it('loads the caller’s own proposals in submitter mode and the queue in staff mode', async () => {
    const mine = await setup('submitter', []);
    expect(mine.service.getApplications).toHaveBeenCalledWith('submitter');
    const staff = await setup('staff', []);
    expect(staff.service.getApplications).toHaveBeenCalledWith('staff');
    expect(staff.service.consumePendingCreated).not.toHaveBeenCalled();
  });

  it('shows a just-submitted proposal before the index has caught up', async () => {
    const { component } = await setup('submitter', [], buildApplication({ uid: 'new' }));
    expect(component.applications().map((app) => app.uid)).toEqual(['new']);
  });

  it('keeps a local write over a lagging index read, and drops deleted rows', async () => {
    const { component, service, fixture } = await setup('submitter', [buildApplication({ uid: 'a' }), buildApplication({ uid: 'b' })]);

    component.onChanged(buildApplication({ uid: 'a', state: 'withdrawn', revision: 2 }));
    component.onDeleted('b');
    // The next read still returns the stale index docs.
    service.getApplications.mockReturnValue(of([buildApplication({ uid: 'a' }), buildApplication({ uid: 'b' })]));
    component.onStale();
    fixture.detectChanges();

    expect(component.applications().map((app) => `${app.uid}:${app.state}`)).toEqual(['a:withdrawn']);
  });

  it('on a stale write, lets the fresh read win for the open application', async () => {
    const { component, service } = await setup('submitter', [buildApplication({ uid: 'a' })]);
    component.open(buildApplication({ uid: 'a' }));
    component.onChanged(buildApplication({ uid: 'a', state: 'withdrawn', revision: 2 }));

    service.getApplications.mockReturnValue(of([buildApplication({ uid: 'a', state: 'denied', revision: 3 })]));
    component.onStale();

    expect(component.applications()[0].state).toBe('denied');
  });

  it('filters by state', async () => {
    const { component } = await setup('staff', [buildApplication({ uid: 'a' }), buildApplication({ uid: 'b', state: 'denied' })]);
    component.onStateFilterChange('denied');
    expect(component.filteredApplications().map((app) => app.uid)).toEqual(['b']);
  });

  it('renders the submitter column only in staff mode', async () => {
    const staff = await setup('staff', [buildApplication({ uid: 'a' })]);
    expect(staff.fixture.nativeElement.querySelector('[data-testid="project-applications-submitter-a"]')).not.toBeNull();
    const mine = await setup('submitter', [buildApplication({ uid: 'a' })]);
    expect(mine.fixture.nativeElement.querySelector('[data-testid="project-applications-submitter-a"]')).toBeNull();
  });
});
