// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import type { ProjectApplication, ProjectApplicationViewMode } from '@lfx-one/shared/interfaces';
import { ProjectApplicationService } from '@services/project-application.service';
import { ProjectService } from '@services/project.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { ProjectApplicationsPanelComponent } from './project-applications-panel.component';

interface PanelAccess {
  applications: () => ProjectApplication[];
  filteredApplications: () => ProjectApplication[];
  pageFirst: () => number;
  hasError: () => boolean;
  onChanged: (application: ProjectApplication) => void;
  onDeleted: (uid: string) => void;
  onStale: (uid: string) => void;
  selectedUid: () => string | null;
  onPage: (event: { first: number; rows: number }) => void;
  open: (application: ProjectApplication) => void;
  retry: () => void;
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
  let service: ProjectApplicationService;
  let getApplications: MockInstance<ProjectApplicationService['getApplications']>;
  let getProject: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    getProject = vi.fn(() => of(null));
    await TestBed.configureTestingModule({
      imports: [ProjectApplicationsPanelComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ProjectService, useValue: { searchProjects: vi.fn(() => of([])), getProject } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        DialogService,
      ],
    }).compileComponents();
    service = TestBed.inject(ProjectApplicationService);
    getApplications = vi.spyOn(service, 'getApplications');
  });

  const mount = async (mode: ProjectApplicationViewMode, fetched: ProjectApplication[] | Observable<ProjectApplication[]>) => {
    getApplications.mockReturnValue(Array.isArray(fetched) ? of(fetched) : fetched);
    const fixture: ComponentFixture<ProjectApplicationsPanelComponent> = TestBed.createComponent(ProjectApplicationsPanelComponent);
    fixture.componentRef.setInput('mode', mode);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance as unknown as PanelAccess };
  };

  it('loads the caller’s own proposals in submitter mode and the queue in staff mode', async () => {
    await mount('submitter', []);
    expect(getApplications).toHaveBeenLastCalledWith('submitter');
    await mount('staff', []);
    expect(getApplications).toHaveBeenLastCalledWith('staff');
  });

  it('shows a just-submitted proposal before the index has caught up', async () => {
    service.recordWrite('submitter', buildApplication({ uid: 'new' }));
    const { component } = await mount('submitter', []);
    expect(component.applications().map((app) => app.uid)).toEqual(['new']);
  });

  it('keeps write and delete overlays across a destroyed and recreated panel (tab switch)', async () => {
    const lagging = [buildApplication({ uid: 'a' }), buildApplication({ uid: 'b' })];
    const first = await mount('submitter', lagging);
    first.component.onChanged(buildApplication({ uid: 'a', state: 'withdrawn', revision: 2 }));
    first.component.onDeleted('b');
    first.fixture.destroy();

    const second = await mount('submitter', lagging);
    expect(second.component.applications().map((app) => `${app.uid}:${app.state}`)).toEqual(['a:withdrawn']);
  });

  it('never shows a staff-side write in the submitter list', async () => {
    service.recordWrite('staff', buildApplication({ uid: 'someone-elses' }));
    const { component } = await mount('submitter', []);
    expect(component.applications()).toEqual([]);
  });

  it('on a stale write, lets the fresh read win for the open application', async () => {
    const { component } = await mount('submitter', [buildApplication({ uid: 'a' })]);
    component.open(buildApplication({ uid: 'a' }));
    component.onChanged(buildApplication({ uid: 'a', state: 'withdrawn', revision: 2 }));

    getApplications.mockReturnValue(of([buildApplication({ uid: 'a', state: 'denied', revision: 3 })]));
    component.onStale('a');

    expect(component.applications()[0].state).toBe('denied');
  });

  it('clamps using the chosen page size, and writes the clamp back', async () => {
    const rows = Array.from({ length: 26 }, (_, index) => buildApplication({ uid: `app-${index}` }));
    const { component } = await mount('staff', rows);
    component.onPage({ first: 25, rows: 25 });

    component.onDeleted('app-25');
    expect(component.pageFirst()).toBe(0);
    expect((component as unknown as { first: () => number }).first()).toBe(0);
  });

  it('a late 404 for another application drops it without closing the one now open', async () => {
    const { component } = await mount('staff', [buildApplication({ uid: 'a' }), buildApplication({ uid: 'b' })]);
    component.open(buildApplication({ uid: 'b' }));
    component.onDeleted('a');
    expect(component.selectedUid()).toBe('b');
    expect(component.applications().map((app) => app.uid)).toEqual(['b']);
  });

  it('a late 412 forgets the overlay of the application it targeted, not the one now open', async () => {
    const { component } = await mount('staff', [buildApplication({ uid: 'a' }), buildApplication({ uid: 'b' })]);
    component.onChanged(buildApplication({ uid: 'a', state: 'withdrawn', revision: 2 }));
    component.onChanged(buildApplication({ uid: 'b', state: 'denied', revision: 2 }));
    component.open(buildApplication({ uid: 'b' }));
    component.onStale('a');
    expect(component.applications().map((app) => `${app.uid}:${app.state}`)).toEqual(['a:submitted', 'b:denied']);
  });

  it('pulls the paginator back when a delete empties the last page', async () => {
    const rows = Array.from({ length: 11 }, (_, index) => buildApplication({ uid: `app-${index}` }));
    const { component } = await mount('staff', rows);
    component.onPage({ first: 10, rows: 10 });
    expect(component.pageFirst()).toBe(10);

    component.onDeleted('app-10');
    expect(component.pageFirst()).toBe(0);
  });

  it('shows the error state when the read fails, and Retry reads again', async () => {
    const { component, fixture } = await mount(
      'submitter',
      throwError(() => new Error('boom'))
    );
    expect(component.hasError()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="project-applications-error"]')).not.toBeNull();

    getApplications.mockReturnValue(of([buildApplication()]));
    component.retry();
    fixture.detectChanges();
    expect(component.hasError()).toBe(false);
    expect(component.applications()).toHaveLength(1);
  });

  it('cancels a superseded load, so an older response landing late is never applied', async () => {
    const { component } = await mount('submitter', [buildApplication({ uid: 'initial' })]);
    const older = new Subject<ProjectApplication[]>();
    const newer = new Subject<ProjectApplication[]>();
    getApplications.mockReturnValueOnce(older).mockReturnValueOnce(newer);

    component.retry();
    component.retry();
    newer.next([buildApplication({ uid: 'newer' })]);
    older.next([buildApplication({ uid: 'older' })]);

    expect(component.applications().map((app) => app.uid)).toEqual(['newer']);
  });

  it('filters by state', async () => {
    const { component } = await mount('staff', [buildApplication({ uid: 'a' }), buildApplication({ uid: 'b', state: 'denied' })]);
    component.onStateFilterChange('denied');
    expect(component.filteredApplications().map((app) => app.uid)).toEqual(['b']);
  });

  it('renders the submitter column only in staff mode', async () => {
    const staff = await mount('staff', [buildApplication({ uid: 'a' })]);
    expect(staff.fixture.nativeElement.querySelector('[data-testid="project-applications-submitter-a"]')).not.toBeNull();
    const mine = await mount('submitter', [buildApplication({ uid: 'a' })]);
    expect(mine.fixture.nativeElement.querySelector('[data-testid="project-applications-submitter-a"]')).toBeNull();
  });

  describe('started from (#5187)', () => {
    const AAIF_UID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    /** Funded, active, membership-style: what `computeIsFoundation` accepts. */
    const AAIF = {
      uid: AAIF_UID,
      name: 'Agentic AI Foundation',
      stage: 'Active',
      funding: 'Funded',
      funding_model: ['Membership'],
      legal_entity_type: 'Corporation',
    };
    const startedFrom = (fixture: ComponentFixture<ProjectApplicationsPanelComponent>, uid: string): string | null =>
      (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="project-applications-started-from-${uid}"]`)?.textContent?.trim() ?? null;

    const settle = async (fixture: ComponentFixture<ProjectApplicationsPanelComponent>): Promise<void> => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('shows "Started from: {foundation}" on a staff row once the name resolves, reading each foundation once', async () => {
      getProject.mockReturnValue(of(AAIF));
      const { fixture } = await mount('staff', [
        buildApplication({ uid: 'a', target_parent_uid: AAIF_UID }),
        buildApplication({ uid: 'b', target_parent_uid: AAIF_UID }),
        buildApplication({ uid: 'c' }),
      ]);
      await settle(fixture);

      expect(startedFrom(fixture, 'a')).toBe('Started from: Agentic AI Foundation');
      expect(startedFrom(fixture, 'b')).toBe('Started from: Agentic AI Foundation');
      expect(startedFrom(fixture, 'c')).toBeNull();
      expect(getProject).toHaveBeenCalledTimes(1);
      expect(getProject).toHaveBeenCalledWith(AAIF_UID, false);
    });

    it('shows nothing for a foundation that does not resolve', async () => {
      const { fixture } = await mount('staff', [buildApplication({ uid: 'a', target_parent_uid: AAIF_UID })]);
      await settle(fixture);

      expect(startedFrom(fixture, 'a')).toBeNull();
    });

    it('shows nothing when the named project is not a foundation, so a submitter-chosen uid is not presented as where it started', async () => {
      getProject.mockReturnValue(of({ ...AAIF, funding: 'Unfunded', funding_model: [] }));
      const { fixture } = await mount('staff', [buildApplication({ uid: 'a', target_parent_uid: AAIF_UID })]);
      await settle(fixture);

      expect(startedFrom(fixture, 'a')).toBeNull();
    });

    it('does not show or look anything up in the submitter list', async () => {
      getProject.mockReturnValue(of(AAIF));
      const { fixture } = await mount('submitter', [buildApplication({ uid: 'a', target_parent_uid: AAIF_UID })]);
      await settle(fixture);

      expect(startedFrom(fixture, 'a')).toBeNull();
      expect(getProject).not.toHaveBeenCalled();
    });
  });
});

describe('ProjectApplicationsPanelComponent — deep link (#5229)', () => {
  const KNOWN = '3f2b8c1e-7a4d-4e1b-9c2a-5d6e7f8a9b0c';
  const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  let navigate: MockInstance<Router['navigate']>;

  const mount = async (mode: ProjectApplicationViewMode, param: string | null, fetched: ProjectApplication[], platform = 'browser') => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProjectApplicationsPanelComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: platform },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(param !== null ? { tab: 'proposals', application: param } : {})) } },
        { provide: ProjectService, useValue: { searchProjects: vi.fn(() => of([])), getProject: vi.fn(() => of(null)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        DialogService,
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vi.spyOn(TestBed.inject(ProjectApplicationService), 'getApplications').mockReturnValue(of(fetched));
    const fixture = TestBed.createComponent(ProjectApplicationsPanelComponent);
    fixture.componentRef.setInput('mode', mode);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance as unknown as { selectedUid: () => string | null; drawerVisible: () => boolean };
  };

  it('opens the drawer for a known uid once, and strips the param', async () => {
    const panel = await mount('staff', KNOWN, [buildApplication({ uid: OTHER }), buildApplication({ uid: KNOWN })]);
    expect(panel.selectedUid()).toBe(KNOWN);
    expect(panel.drawerVisible()).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][1]).toMatchObject({ queryParams: { application: null }, queryParamsHandling: 'merge', replaceUrl: true });
  });

  it('matches the uid case-insensitively', async () => {
    const panel = await mount('staff', KNOWN.toUpperCase(), [buildApplication({ uid: KNOWN })]);
    expect(panel.selectedUid()).toBe(KNOWN);
  });

  it('opens nothing for a uid that is not in the queue, but still strips the param', async () => {
    const panel = await mount('staff', OTHER, [buildApplication({ uid: KNOWN })]);
    expect(panel.selectedUid()).toBeNull();
    expect(panel.drawerVisible()).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][1]).toMatchObject({ queryParams: { application: null }, replaceUrl: true });
  });

  it('opens nothing for a malformed uid, but still strips the param', async () => {
    const panel = await mount('staff', 'not-a-uuid', [buildApplication({ uid: 'not-a-uuid' })]);
    expect(panel.selectedUid()).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('strips an empty param too, opening nothing', async () => {
    const panel = await mount('staff', '', [buildApplication({ uid: KNOWN })]);
    expect(panel.selectedUid()).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does nothing on the server, so SSR never turns the URL change into a redirect', async () => {
    const panel = await mount('staff', KNOWN, [buildApplication({ uid: KNOWN })], 'server');
    expect(panel.selectedUid()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('is not consumed by a failed read, so a retry still opens the proposal', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProjectApplicationsPanelComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ tab: 'proposals', application: KNOWN })) } },
        { provide: ProjectService, useValue: { searchProjects: vi.fn(() => of([])), getProject: vi.fn(() => of(null)) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        DialogService,
      ],
    }).compileComponents();
    const router = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vi.spyOn(TestBed.inject(ProjectApplicationService), 'getApplications')
      .mockReturnValueOnce(throwError(() => new Error('boom')))
      .mockReturnValue(of([buildApplication({ uid: KNOWN })]));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(ProjectApplicationsPanelComponent);
    fixture.componentRef.setInput('mode', 'staff');
    fixture.detectChanges();
    await fixture.whenStable();
    const panel = fixture.componentInstance as unknown as { selectedUid: () => string | null; retry: () => void };
    expect(panel.selectedUid()).toBeNull();
    expect(router).not.toHaveBeenCalled();

    panel.retry();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panel.selectedUid()).toBe(KNOWN);
    expect(router).toHaveBeenCalledTimes(1);
  });

  it('ignores the param in submitter mode', async () => {
    const panel = await mount('submitter', KNOWN, [buildApplication({ uid: KNOWN })]);
    expect(panel.selectedUid()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
