// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { MENTORSHIP_FOUNDATION_PROGRAMS_NO_ACCESS_TITLE } from '@lfx-one/shared/constants';
import { Lens, MentorshipProgramsResponse } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { ProjectContextService } from '@services/project-context.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminComponent } from './admin.component';

/** Waits out the 200 ms filter debounce, then renders what the read wrote. */
const settle = async (fixture: ComponentFixture<AdminComponent>): Promise<void> => {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 250));
  fixture.detectChanges();
};

const PROJECT_UID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const page: MentorshipProgramsResponse = { data: [], total: 0 };

describe('AdminComponent', () => {
  let getPrograms: ReturnType<typeof vi.fn<() => Observable<MentorshipProgramsResponse>>>;
  let getProjectPrograms: ReturnType<typeof vi.fn<(projectUid: string) => Observable<MentorshipProgramsResponse>>>;
  let navigate: ReturnType<typeof vi.fn>;
  const activeContextUid = signal('');
  /** The lens context's slug, which an in-place project switch changes without a router navigation. */
  const activeSlug = signal('gridflow');

  const create = async (lens: Lens = 'me'): Promise<ComponentFixture<AdminComponent>> => {
    TestBed.overrideComponent(AdminComponent, { set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [
        { provide: MentorshipAdminService, useValue: { getPrograms, getProjectPrograms } },
        {
          provide: ProjectContextService,
          useValue: { activeContextUid, activeContext: () => (activeContextUid() ? { uid: activeContextUid(), slug: activeSlug() } : null) },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { lens } } } },
        { provide: Router, useValue: { navigate } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AdminComponent);
    await settle(fixture);
    return fixture;
  };

  /** The protected members the tests read. */
  const view = (fixture: ComponentFixture<AdminComponent>) =>
    fixture.componentInstance as unknown as {
      programsLoadError: () => boolean;
      programsForbidden: () => boolean;
      pageTitle: string;
      retryPrograms: () => void;
      onProgramClick: (programId: string) => void;
      onEnrollProgram: () => void;
    };
  const query = (fixture: ComponentFixture<AdminComponent>, testId: string): Element | null =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);

  beforeEach(() => {
    TestBed.resetTestingModule();
    getPrograms = vi.fn(() => of(page));
    getProjectPrograms = vi.fn(() => of(page));
    navigate = vi.fn();
    activeContextUid.set('');
    activeSlug.set('gridflow');
  });

  describe('programs load', () => {
    beforeEach(() => {
      getPrograms = vi.fn(() => throwError(() => new Error('down')));
    });

    it('flags a failed first page and clears the flag when Retry succeeds', async () => {
      const fixture = await create();
      const component = view(fixture);

      expect(component.programsLoadError()).toBe(true);

      getPrograms.mockReturnValue(of(page));
      component.retryPrograms();
      fixture.detectChanges();

      expect(component.programsLoadError()).toBe(false);
      expect(getPrograms).toHaveBeenCalledTimes(2);
    });

    it('keeps the error shown while a Retry is in flight', async () => {
      const fixture = await create();
      const component = view(fixture);
      const pending = new Subject<MentorshipProgramsResponse>();

      getPrograms.mockReturnValue(pending);
      component.retryPrograms();
      fixture.detectChanges();

      expect(component.programsLoadError()).toBe(true);

      pending.next(page);
      pending.complete();
      expect(component.programsLoadError()).toBe(false);
    });
  });

  describe('on the Me lens', () => {
    it('lists the caller’s programs under Admin, with Enroll a Program, and opens a program on the Me lens', async () => {
      const fixture = await create('me');

      expect(getPrograms).toHaveBeenCalledWith({ search: undefined, status: undefined, offset: 0, limit: 12 });
      expect(getProjectPrograms).not.toHaveBeenCalled();
      expect(view(fixture).pageTitle).toBe('Admin');
      expect(query(fixture, 'mentorship-admin-enroll-button')).not.toBeNull();

      view(fixture).onProgramClick('p-1');
      expect(navigate).toHaveBeenCalledWith(['/mentorship/admin', 'p-1'], { queryParams: {} });
    });
  });

  describe('on the Project lens', () => {
    it('waits for the project, then lists its own programs under Mentorship Programs, with Enroll a Program', async () => {
      const fixture = await create('project');

      expect(getProjectPrograms).not.toHaveBeenCalled();
      expect(query(fixture, 'mentorship-admin-loading')).not.toBeNull();

      activeContextUid.set(PROJECT_UID);
      await settle(fixture);

      expect(getProjectPrograms).toHaveBeenCalledWith(PROJECT_UID, {
        search: undefined,
        status: undefined,
        offset: 0,
        limit: 12,
        includeSubprojects: false,
      });
      expect(getPrograms).not.toHaveBeenCalled();
      expect(view(fixture).pageTitle).toBe('Mentorship Programs');
      expect(query(fixture, 'mentorship-admin-enroll-button')).not.toBeNull();
      expect(query(fixture, 'mentorship-admin-loading')).toBeNull();

      view(fixture).onEnrollProgram();
      expect(navigate).toHaveBeenCalledWith(['/project/mentorship', 'enroll'], { queryParams: { project: 'gridflow' } });
    });

    it('reads the new project’s programs when the lens switches project', async () => {
      activeContextUid.set(PROJECT_UID);
      const fixture = await create('project');

      activeContextUid.set('0b8a4c62-0d1e-4a55-9a3c-2f6e8d9b1c47');
      await settle(fixture);

      expect(getProjectPrograms.mock.calls.map(([projectUid]) => projectUid)).toEqual([PROJECT_UID, '0b8a4c62-0d1e-4a55-9a3c-2f6e8d9b1c47']);
    });

    it('shows no access, with no Retry, when the gateway refuses the project’s list', async () => {
      getProjectPrograms = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403, statusText: 'Forbidden' })));
      activeContextUid.set(PROJECT_UID);
      const fixture = await create('project');

      expect(view(fixture).programsForbidden()).toBe(true);
      expect(view(fixture).programsLoadError()).toBe(false);
      expect(query(fixture, 'mentorship-admin-programs-no-access')).not.toBeNull();
    });

    it('shows the Retry error for any other failure', async () => {
      getProjectPrograms = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable' })));
      activeContextUid.set(PROJECT_UID);
      const fixture = await create('project');

      expect(view(fixture).programsForbidden()).toBe(false);
      expect(view(fixture).programsLoadError()).toBe(true);
    });

    it('opens a program on the Project lens with the lens context’s project, not a stale ?project= from before a switch', async () => {
      activeContextUid.set(PROJECT_UID);
      const fixture = await create('project');

      // An in-place switch rewrites ?project= with Location.replaceState; the router keeps the old slug.
      activeSlug.set('switched-project');
      view(fixture).onProgramClick('p-1');

      expect(navigate).toHaveBeenCalledWith(['/project/mentorship', 'p-1'], { queryParams: { project: 'switched-project' } });
    });
  });

  describe('on the Foundation lens', () => {
    it('lists the foundation’s and its sub-projects’ programs, and keeps programs and Enroll on the Foundation lens', async () => {
      activeContextUid.set(PROJECT_UID);
      const fixture = await create('foundation');

      expect(getProjectPrograms).toHaveBeenCalledWith(PROJECT_UID, expect.objectContaining({ includeSubprojects: true }));
      expect(view(fixture).pageTitle).toBe('Mentorship Programs');

      view(fixture).onProgramClick('p-1');
      view(fixture).onEnrollProgram();
      expect(navigate).toHaveBeenCalledWith(['/foundation/mentorship', 'p-1'], { queryParams: { project: 'gridflow' } });
      expect(navigate).toHaveBeenCalledWith(['/foundation/mentorship', 'enroll'], { queryParams: { project: 'gridflow' } });
    });

    it('names the foundation in its no-access state', async () => {
      getProjectPrograms = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 403, statusText: 'Forbidden' })));
      activeContextUid.set(PROJECT_UID);
      const fixture = await create('foundation');

      expect(view(fixture).programsForbidden()).toBe(true);
      expect((fixture.componentInstance as unknown as { noAccessTitle: string }).noAccessTitle).toBe(MENTORSHIP_FOUNDATION_PROGRAMS_NO_ACCESS_TITLE);
    });
  });
});
