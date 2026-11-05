// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ProjectFunding, ProjectStage } from '@lfx-one/shared/enums';
import type { Project, ProjectApplication, ProjectApplicationAnswers } from '@lfx-one/shared/interfaces';
import { ProjectApplicationService } from '@services/project-application.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProposeProjectComponent } from './propose-project.component';

interface PageAccess {
  onSubmit: (answers: ProjectApplicationAnswers) => void;
  onCancel: () => void;
  onChangeParent: () => void;
  submitting: () => boolean;
  errorMessage: () => string | null;
}

const FOUNDATION_UID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

/** A funded, active, membership-style project — what `computeIsFoundation` accepts. */
const FOUNDATION = {
  uid: FOUNDATION_UID,
  slug: 'example-foundation',
  name: 'Example Foundation',
  stage: ProjectStage.Active,
  legal_entity_type: 'Corporation',
  funding_model: ['Membership'],
  funding: ProjectFunding.Funded,
} as unknown as Project;

const CREATED = { uid: 'new-uid', state: 'submitted', revision: 1, application: { project_name: 'Example' } } as ProjectApplication;

describe('ProposeProjectComponent (#3037)', () => {
  const setup = async (create: ReturnType<typeof vi.fn>, options: { parent?: string; project?: Observable<Project | null> } = {}) => {
    TestBed.resetTestingModule();
    const getStartedFrom = vi.fn(() => options.project ?? of(null));
    const service = { create, recordWrite: vi.fn(), getStartedFrom };
    const messages = { add: vi.fn() };
    const queryParams = options.parent === undefined ? {} : { parent: options.parent };
    await TestBed.configureTestingModule({
      imports: [ProposeProjectComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectApplicationService, useValue: service },
        { provide: MessageService, useValue: messages },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProposeProjectComponent);
    fixture.detectChanges();
    return { component: fixture.componentInstance as unknown as PageAccess, fixture, service, messages, navigate, getStartedFrom };
  };

  const parentLine = (fixture: ComponentFixture<ProposeProjectComponent>): string | null =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-testid="propose-project-parent-line"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

  it('hands the created application to the list and lands on Submitted proposals', async () => {
    const { component, service, messages, navigate } = await setup(vi.fn(() => of({ application: CREATED, etag: null })));
    component.onSubmit({ project_name: 'Example' });

    expect(service.create).toHaveBeenCalledWith({ project_name: 'Example' }, null);
    expect(service.recordWrite).toHaveBeenCalledWith('submitter', CREATED);
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    expect(navigate).toHaveBeenCalledWith(['/formations'], { queryParams: { tab: 'proposals' } });
    expect(component.submitting()).toBe(false);
  });

  it('shows the server message and stays on the page when submit fails', async () => {
    const { component, service, navigate } = await setup(
      vi.fn(() => throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'project_website must be an http or https URL' } })))
    );
    component.onSubmit({ project_name: 'Example' });

    expect(component.errorMessage()).toBe('project_website must be an http or https URL');
    expect(component.submitting()).toBe(false);
    expect(service.recordWrite).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('cancel returns to My Formations', async () => {
    const { component, navigate } = await setup(vi.fn());
    component.onCancel();
    expect(navigate).toHaveBeenCalledWith(['/formations']);
  });
  describe('starting foundation (#5187)', () => {
    const created = () => vi.fn(() => of({ application: CREATED, etag: null }));

    it('shows "Proposing under" for a valid foundation, and the submit body carries its uid', async () => {
      const { component, fixture, service, getStartedFrom } = await setup(created(), { parent: FOUNDATION_UID, project: of(FOUNDATION) });
      fixture.detectChanges();

      expect(getStartedFrom).toHaveBeenCalledWith(FOUNDATION_UID);
      expect(parentLine(fixture)).toBe('Proposing under Example Foundation');

      component.onSubmit({ project_name: 'Example' });
      expect(service.create).toHaveBeenCalledWith({ project_name: 'Example' }, FOUNDATION_UID);
    });

    it('Change clears the line, drops it from the URL and sends no uid', async () => {
      const { component, fixture, service, navigate } = await setup(created(), { parent: FOUNDATION_UID, project: of(FOUNDATION) });
      fixture.detectChanges();

      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="propose-project-parent-change"]')?.click();
      fixture.detectChanges();

      expect(parentLine(fixture)).toBeNull();
      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { parent: null }, queryParamsHandling: 'merge', replaceUrl: true }));
      component.onSubmit({ project_name: 'Example' });
      expect(service.create).toHaveBeenCalledWith({ project_name: 'Example' }, null);
    });

    it('ignores a lookup that answers after Change, so a cleared foundation never comes back or reaches the body', async () => {
      const pending = new Subject<Project | null>();
      const { component, fixture, service } = await setup(created(), { parent: FOUNDATION_UID, project: pending });
      fixture.detectChanges();
      expect(parentLine(fixture)).toBeNull();

      component.onChangeParent();
      pending.next(FOUNDATION);
      fixture.detectChanges();

      expect(parentLine(fixture)).toBeNull();
      component.onSubmit({ project_name: 'Example' });
      expect(service.create).toHaveBeenCalledWith({ project_name: 'Example' }, null);
    });

    it('drops a parent that does not resolve to a foundation silently, with no message and no uid in the body', async () => {
      // `getStartedFrom` resolves null for a bad UUID, an unreadable (404/403) project and a non-foundation alike.
      const { component, fixture, service, messages } = await setup(created(), { parent: FOUNDATION_UID, project: of(null) });
      fixture.detectChanges();

      expect(parentLine(fixture)).toBeNull();
      expect(messages.add).not.toHaveBeenCalled();
      component.onSubmit({ project_name: 'Example' });
      expect(service.create).toHaveBeenCalledWith({ project_name: 'Example' }, null);
    });

    it('does not look anything up without a parent', async () => {
      const { getStartedFrom } = await setup(created());
      expect(getStartedFrom).not.toHaveBeenCalled();
    });
  });
});
