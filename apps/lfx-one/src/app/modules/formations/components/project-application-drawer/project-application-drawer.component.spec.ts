// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Project, ProjectApplication, ProjectApplicationViewMode } from '@lfx-one/shared/interfaces';
import { ProjectApplicationService } from '@services/project-application.service';
import { ProjectService } from '@services/project.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProjectApplicationDrawerComponent } from './project-application-drawer.component';

interface DrawerAccess {
  isOpen: () => boolean;
  isStaff: () => boolean;
  editing: () => boolean;
  onWithdraw: () => void;
  onDeny: () => void;
  onDelete: () => void;
  onParentSelected: (event: { value: Project }) => void;
  confirmAccept: () => void;
}

function buildApplication(overrides: Partial<ProjectApplication> = {}): ProjectApplication {
  return {
    uid: '3f2b8c1e-7a4d-4e1b-9c2a-5d6e7f8a9b0c',
    state: 'submitted',
    revision: 4,
    submitter_username: 'jdoe',
    submitter_name: 'Jane Doe',
    submitter_email: 'jane@example.org',
    target_parent_uid: null,
    application: { project_name: 'Example Foundation', future_question: 'kept' },
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    ...overrides,
  };
}

describe('ProjectApplicationDrawerComponent (#3037)', () => {
  const setup = async (mode: ProjectApplicationViewMode, application = buildApplication()) => {
    TestBed.resetTestingModule();
    const service = {
      withdraw: vi.fn(() => of({ application: buildApplication({ state: 'withdrawn', revision: 5 }), etag: '5' })),
      deny: vi.fn(() => of({ application: buildApplication({ state: 'denied', revision: 5 }), etag: '5' })),
      accept: vi.fn(() => of({ application: buildApplication({ state: 'accepted', revision: 6 }), etag: '6' })),
      remove: vi.fn(() => of(undefined)),
      revise: vi.fn(),
    };
    const messages = { add: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ProjectApplicationDrawerComponent],
      providers: [
        { provide: ProjectApplicationService, useValue: service },
        { provide: ProjectService, useValue: { searchProjects: vi.fn(() => of([])) } },
        { provide: MessageService, useValue: messages },
        ConfirmationService,
      ],
    }).compileComponents();
    // Auto-accept every confirm so the action under test runs.
    const confirmation = {
      confirm: vi.spyOn(TestBed.inject(ConfirmationService), 'confirm').mockImplementation((options: Confirmation) => {
        options.accept?.();
        return TestBed.inject(ConfirmationService);
      }),
    };

    const fixture: ComponentFixture<ProjectApplicationDrawerComponent> = TestBed.createComponent(ProjectApplicationDrawerComponent);
    fixture.componentRef.setInput('application', application);
    fixture.componentRef.setInput('mode', mode);
    const changed: ProjectApplication[] = [];
    const deleted: string[] = [];
    let staleCount = 0;
    fixture.componentInstance.changed.subscribe((app) => changed.push(app));
    fixture.componentInstance.deleted.subscribe((uid) => deleted.push(uid));
    fixture.componentInstance.stale.subscribe(() => staleCount++);
    fixture.detectChanges();
    return {
      fixture,
      component: fixture.componentInstance as unknown as DrawerAccess,
      service,
      messages,
      confirmation,
      changed,
      deleted,
      staleCount: () => staleCount,
    };
  };

  it('never offers accept or deny to a submitter', async () => {
    const { component } = await setup('submitter');
    expect(component.isOpen()).toBe(true);
    expect(component.isStaff()).toBe(false);
  });

  it('closes every state transition once the application is decided', async () => {
    const { component } = await setup('staff', buildApplication({ state: 'accepted' }));
    expect(component.isOpen()).toBe(false);
  });

  it('withdraws after confirmation and emits the returned application', async () => {
    const { component, service, confirmation, changed } = await setup('submitter');
    component.onWithdraw();
    expect(confirmation.confirm).toHaveBeenCalledTimes(1);
    expect(service.withdraw).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }));
    expect(changed.map((app) => app.state)).toEqual(['withdrawn']);
  });

  it('denies after confirmation', async () => {
    const { component, service, changed } = await setup('staff');
    component.onDeny();
    expect(service.deny).toHaveBeenCalledTimes(1);
    expect(changed[0].state).toBe('denied');
  });

  it('deletes after confirmation and emits the uid', async () => {
    const { component, service, deleted } = await setup('submitter');
    component.onDelete();
    expect(service.remove).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual(['3f2b8c1e-7a4d-4e1b-9c2a-5d6e7f8a9b0c']);
  });

  it('accepts under the chosen parent', async () => {
    const { component, service, changed } = await setup('staff');
    component.confirmAccept();
    expect(service.accept).not.toHaveBeenCalled();

    component.onParentSelected({ value: { uid: 'parent-uid', name: 'Parent', slug: 'parent' } as Project });
    component.confirmAccept();
    expect(service.accept).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }), 'parent-uid');
    expect(changed[0].state).toBe('accepted');
  });

  it('asks the list to reload on a stale revision and never replays the write', async () => {
    const { component, service, staleCount, changed, messages } = await setup('submitter');
    service.withdraw.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 412 })));
    component.onWithdraw();
    expect(service.withdraw).toHaveBeenCalledTimes(1);
    expect(staleCount()).toBe(1);
    expect(changed).toHaveLength(0);
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
  });

  it('shows the server message for any other failure', async () => {
    const { component, service, staleCount, messages } = await setup('staff');
    service.deny.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'Only the formation team can perform this action' } }))
    );
    component.onDeny();
    expect(staleCount()).toBe(0);
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Only the formation team can perform this action' }));
  });
});
