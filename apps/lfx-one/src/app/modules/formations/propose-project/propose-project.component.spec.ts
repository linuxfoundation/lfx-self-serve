// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { ProjectApplication, ProjectApplicationAnswers } from '@lfx-one/shared/interfaces';
import { ProjectApplicationService } from '@services/project-application.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProposeProjectComponent } from './propose-project.component';

interface PageAccess {
  onSubmit: (answers: ProjectApplicationAnswers) => void;
  onCancel: () => void;
  submitting: () => boolean;
  errorMessage: () => string | null;
}

const CREATED = { uid: 'new-uid', state: 'submitted', revision: 1, application: { project_name: 'Example' } } as ProjectApplication;

describe('ProposeProjectComponent (#3037)', () => {
  const setup = async (create: ReturnType<typeof vi.fn>) => {
    TestBed.resetTestingModule();
    const service = { create, recordWrite: vi.fn() };
    const messages = { add: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [ProposeProjectComponent],
      providers: [provideRouter([]), { provide: ProjectApplicationService, useValue: service }, { provide: MessageService, useValue: messages }],
    }).compileComponents();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProposeProjectComponent);
    fixture.detectChanges();
    return { component: fixture.componentInstance as unknown as PageAccess, service, messages, navigate };
  };

  it('hands the created application to the list and lands on Submitted proposals', async () => {
    const { component, service, messages, navigate } = await setup(vi.fn(() => of({ application: CREATED, etag: null })));
    component.onSubmit({ project_name: 'Example' });

    expect(service.create).toHaveBeenCalledWith({ project_name: 'Example' });
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
});
