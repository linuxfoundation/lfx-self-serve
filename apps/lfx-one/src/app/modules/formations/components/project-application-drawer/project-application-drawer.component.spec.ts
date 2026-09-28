// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type {
  Project,
  ProjectApplication,
  ProjectApplicationAnswerLink,
  ProjectApplicationStatusCallout,
  ProjectApplicationViewMode,
} from '@lfx-one/shared/interfaces';
import { ProjectApplicationService } from '@services/project-application.service';
import { Confirmation, ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import type { DrawerPassThroughOptions } from 'primeng/types/drawer';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProjectApplicationDrawerComponent } from './project-application-drawer.component';

interface DrawerAccess {
  isOpen: () => boolean;
  isStaff: () => boolean;
  editing: () => boolean;
  onWithdraw: () => void;
  onDeny: () => void;
  onDelete: () => void;
  onAccept: () => void;
  onRevise: (answers: Record<string, unknown>) => void;
  startEditing: () => void;
  errorMessage: () => string | null;
  moreActions: () => MenuItem[];
  statusCallout: () => ProjectApplicationStatusCallout | null;
  showUpdated: () => boolean;
  submitterEmailLink: () => ProjectApplicationAnswerLink | null;
  drawerPt: () => DrawerPassThroughOptions;
}

function footerClass(component: DrawerAccess): string | undefined {
  return (component.drawerPt().footer as { class?: string } | undefined)?.class;
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
      revise: vi.fn(() => of({ application: buildApplication({ revision: 5, application: { project_name: 'Renamed' } }), etag: '5' })),
    };
    const messages = { add: vi.fn() };
    // The accept dialog closes with whatever the test pushes through `dialogClose`.
    const dialogClose = new Subject<Project | undefined>();
    const dialog = { open: vi.fn(() => ({ onClose: dialogClose.asObservable() })) };

    await TestBed.configureTestingModule({
      imports: [ProjectApplicationDrawerComponent],
      providers: [
        { provide: ProjectApplicationService, useValue: service },
        { provide: DialogService, useValue: dialog },
        { provide: MessageService, useValue: messages },
        ConfirmationService,
        provideNoopAnimations(),
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
    const gone: string[] = [];
    let staleCount = 0;
    const staleUids: string[] = [];
    fixture.componentInstance.changed.subscribe((app) => changed.push(app));
    fixture.componentInstance.deleted.subscribe((uid) => deleted.push(uid));
    fixture.componentInstance.stale.subscribe((uid) => {
      staleUids.push(uid);
      staleCount++;
    });
    fixture.componentInstance.gone.subscribe((uid) => gone.push(uid));
    fixture.detectChanges();
    return {
      fixture,
      component: fixture.componentInstance as unknown as DrawerAccess,
      service,
      messages,
      confirmation,
      dialog,
      dialogClose,
      changed,
      deleted,
      gone,
      staleCount: () => staleCount,
      staleUids,
    };
  };

  it('never offers accept or deny to a submitter', async () => {
    const { component } = await setup('submitter');
    expect(component.isOpen()).toBe(true);
    expect(component.isStaff()).toBe(false);
  });

  it("keeps the submitter's secondary actions in the More menu, delete last and set apart", async () => {
    const { component } = await setup('submitter');
    expect(component.moreActions().map((item) => item.label ?? '---')).toEqual(['Withdraw', '---', 'Delete']);
  });

  it("adds revise to the formation team's More menu, behind accept and deny", async () => {
    const { component, service } = await setup('staff');
    const items = component.moreActions();
    expect(items.map((item) => item.label ?? '---')).toEqual(['Revise', 'Withdraw', '---', 'Delete']);
    items[0].command?.({});
    expect(component.editing()).toBe(true);
    items[1].command?.({});
    expect(service.withdraw).toHaveBeenCalledTimes(1);
  });

  it("explains the state in the viewer's own terms", async () => {
    const submitter = await setup('submitter');
    expect(submitter.component.statusCallout()?.text).toContain('reviewing your proposal');
    const staff = await setup('staff', buildApplication({ state: 'denied' }));
    expect(staff.component.statusCallout()).toEqual(expect.objectContaining({ severity: 'warn', text: expect.stringContaining('not notified') }));
    const unknown = await setup('staff', buildApplication({ state: 'archived' }));
    expect(unknown.component.statusCallout()).toBeNull();
  });

  it('shows the updated date only when it falls on a different day from the submission', async () => {
    const changedLater = await setup('submitter');
    expect(changedLater.component.showUpdated()).toBe(true);
    const sameDay = await setup('submitter', buildApplication({ created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-01T09:05:00Z' }));
    expect(sameDay.component.showUpdated()).toBe(false);
  });

  it('links the submitter email only when it is a plain address, and shows nothing without one', async () => {
    const plain = await setup('staff');
    expect(plain.component.submitterEmailLink()).toEqual(expect.objectContaining({ href: 'mailto:jane@example.org' }));
    const unsafe = await setup('staff', buildApplication({ submitter_email: 'jane#x@example.org' }));
    expect(unsafe.component.submitterEmailLink()).toEqual(expect.objectContaining({ text: 'jane#x@example.org', href: null }));
    const missing = await setup('staff', buildApplication({ submitter_email: '' }));
    expect(missing.component.submitterEmailLink()).toBeNull();
  });

  it('hides the footer while editing and shows it with a divider otherwise', async () => {
    const { component } = await setup('submitter');
    expect(footerClass(component)).toBe('border-t border-gray-200');
    component.startEditing();
    expect(footerClass(component)).toBe('hidden');
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

  it('does nothing when the accept dialog is cancelled', async () => {
    const { component, service, dialog, dialogClose } = await setup('staff');
    component.onAccept();
    expect(dialog.open).toHaveBeenCalledTimes(1);
    dialogClose.next(undefined);
    expect(service.accept).not.toHaveBeenCalled();
  });

  it('accepts under the parent chosen in the dialog', async () => {
    const { component, service, changed, dialogClose } = await setup('staff');
    component.onAccept();
    dialogClose.next({ uid: 'parent-uid', name: 'Parent', slug: 'parent' } as Project);
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

  it('reloads after any accept failure, since the parent may already be recorded', async () => {
    const { component, service, staleCount, messages, dialogClose } = await setup('staff');
    service.accept.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502, error: { error: 'Upstream unavailable' } })));
    component.onAccept();
    dialogClose.next({ uid: 'parent-uid', name: 'Parent', slug: 'parent' } as Project);
    expect(staleCount()).toBe(1);
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'The proposal could not be accepted' }));
  });

  it('revise saves, leaves edit mode and emits the returned application', async () => {
    const { component, service, changed } = await setup('submitter');
    component.startEditing();
    component.onRevise({ project_name: 'Renamed' });
    expect(service.revise).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }), { project_name: 'Renamed' });
    expect(component.editing()).toBe(false);
    expect(changed[0].application.project_name).toBe('Renamed');
  });

  it('a refused revise keeps the form open with the server message inline', async () => {
    const { component, service, changed } = await setup('submitter');
    service.revise.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'project_website must be an http or https URL' } }))
    );
    component.startEditing();
    component.onRevise({ project_name: 'Renamed' });
    expect(component.editing()).toBe(true);
    expect(component.errorMessage()).toBe('project_website must be an http or https URL');
    expect(changed).toHaveLength(0);
  });

  it('a stale revise leaves edit mode and asks for a reload of the application it targeted', async () => {
    const { component, service, staleCount, staleUids } = await setup('submitter');
    service.revise.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 412 })));
    component.startEditing();
    component.onRevise({ project_name: 'Renamed' });
    expect(component.editing()).toBe(false);
    expect(staleCount()).toBe(1);
    expect(staleUids).toEqual(['3f2b8c1e-7a4d-4e1b-9c2a-5d6e7f8a9b0c']);
  });

  it('a 404 reports the application as gone instead of reloading', async () => {
    const { component, service, gone, staleCount } = await setup('submitter');
    service.withdraw.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    component.onWithdraw();
    expect(gone).toEqual(['3f2b8c1e-7a4d-4e1b-9c2a-5d6e7f8a9b0c']);
    expect(staleCount()).toBe(0);
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
