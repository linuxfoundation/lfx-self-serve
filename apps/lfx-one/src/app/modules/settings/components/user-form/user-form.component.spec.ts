// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PROJECT_USER_ALREADY_ON_PROJECT_MESSAGE } from '@lfx-one/shared/constants';
import { PermissionsService } from '@services/permissions.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserFormComponent } from './user-form.component';

const ADD_FALLBACK = 'Failed to add user. Please try again.';

/** A BFF error body: the reason is under `error`, with a `code`, and never under `message`. */
function bffError(status: number, error: string, code: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error, code } });
}

describe('UserFormComponent', () => {
  let fixture: ComponentFixture<UserFormComponent>;
  let component: UserFormComponent;
  let addUserToProject: ReturnType<typeof vi.fn>;
  let updateUserRole: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.spyOn>;
  let close: ReturnType<typeof vi.fn>;

  async function mount(data: Record<string, unknown> = {}): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [UserFormComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: ProjectContextService, useValue: { activeContext: () => ({ uid: 'project-1', name: 'Project One', slug: 'project-one' }) } },
        { provide: PermissionsService, useValue: { addUserToProject, updateUserRole } },
        { provide: MessageService, useValue: { add: messageAdd } },
        ConfirmationService,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(UserFormComponent);
    component = fixture.componentInstance;
    confirm = vi.spyOn(TestBed.inject(ConfirmationService), 'confirm').mockImplementation(() => undefined as never);
    fixture.detectChanges();
  }

  const lastToast = (): { severity: string; detail: string } => messageAdd.mock.calls.at(-1)![0];

  beforeEach(() => {
    TestBed.resetTestingModule();
    addUserToProject = vi.fn(() => of(undefined));
    updateUserRole = vi.fn(() => of(undefined));
    messageAdd = vi.fn();
    close = vi.fn();
  });

  describe('adding a user', () => {
    beforeEach(async () => {
      await mount();
      component.form().patchValue({ email: 'someone@example.com', role: 'manage' });
    });

    it('closes the dialog and says so when the add succeeds', () => {
      component.onSubmit();

      expect(addUserToProject).toHaveBeenCalledWith('project-1', { email: 'someone@example.com', role: 'manage' });
      expect(lastToast()).toMatchObject({ severity: 'success', detail: 'User added successfully' });
      expect(close).toHaveBeenCalledWith(true);
    });

    it('tells the admin the person is already on the project and where to change their role', () => {
      addUserToProject.mockReturnValue(throwError(() => bffError(409, 'This person is already on the project', 'ALREADY_ON_PROJECT')));

      component.onSubmit();

      expect(lastToast()).toMatchObject({ severity: 'error', detail: PROJECT_USER_ALREADY_ON_PROJECT_MESSAGE });
      // The dialog stays open and usable, not stuck on a spinner.
      expect(close).not.toHaveBeenCalled();
      expect(component.submitting()).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("shows the server's own reason for any other 409 rather than the role-change guidance", () => {
      addUserToProject.mockReturnValue(throwError(() => bffError(409, 'The project settings changed. Reload and try again.', 'CONFLICT')));

      component.onSubmit();

      expect(lastToast().detail).toBe('The project settings changed. Reload and try again.');
      expect(lastToast().detail).not.toBe(PROJECT_USER_ALREADY_ON_PROJECT_MESSAGE);
    });

    it("shows the server's reason for a permission failure", () => {
      addUserToProject.mockReturnValue(throwError(() => bffError(403, 'Only project managers can add users', 'FORBIDDEN')));

      component.onSubmit();

      expect(lastToast().detail).toBe('Only project managers can add users');
      expect(component.submitting()).toBe(false);
    });

    it('falls back to the action-named text when the server says nothing useful', () => {
      addUserToProject.mockReturnValue(throwError(() => bffError(500, 'Internal server error', 'INTERNAL_ERROR')));

      component.onSubmit();

      expect(lastToast().detail).toBe(ADD_FALLBACK);
      expect(component.submitting()).toBe(false);
    });

    it('offers manual entry, with no error toast, when the address is not in the directory', () => {
      addUserToProject.mockReturnValue(throwError(() => bffError(404, 'User not found', 'NOT_FOUND')));

      component.onSubmit();

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(messageAdd).not.toHaveBeenCalled();
    });
  });

  describe('adding a user with manually entered details', () => {
    beforeEach(async () => {
      await mount();
      component.showManualFields.set(true);
      component.form().patchValue({ email: 'someone@example.com', name: 'Some One', username: 'someone', role: 'view' });
    });

    it('gives the same already-on-the-project guidance', () => {
      addUserToProject.mockReturnValue(throwError(() => bffError(409, 'This person is already on the project', 'ALREADY_ON_PROJECT')));

      component.onSubmit();

      expect(addUserToProject).toHaveBeenCalledWith('project-1', expect.objectContaining({ email: 'someone@example.com', name: 'Some One', role: 'view' }));
      expect(lastToast()).toMatchObject({ severity: 'error', detail: PROJECT_USER_ALREADY_ON_PROJECT_MESSAGE });
      expect(component.submitting()).toBe(false);
    });
  });

  describe('editing a user', () => {
    beforeEach(async () => {
      await mount({ isEditing: true, user: { name: 'Some One', email: 'someone@example.com', username: 'someone', role: 'view' } });
      component.form().patchValue({ role: 'manage' });
    });

    it("shows the server's reason when the role change is refused", () => {
      updateUserRole.mockReturnValue(throwError(() => bffError(403, 'Only project managers can change roles', 'FORBIDDEN')));

      component.onSubmit();

      expect(updateUserRole).toHaveBeenCalledWith('project-1', 'someone', { role: 'manage' }, undefined);
      expect(lastToast()).toMatchObject({ severity: 'error', detail: 'Only project managers can change roles' });
      expect(component.submitting()).toBe(false);
    });

    it('falls back to the action-named text when the server says nothing useful', () => {
      updateUserRole.mockReturnValue(throwError(() => bffError(500, 'Internal server error', 'INTERNAL_ERROR')));

      component.onSubmit();

      expect(lastToast().detail).toBe('Failed to update user. Please try again.');
    });
  });
});
