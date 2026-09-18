// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ERROR_CODES } from '@lfx-one/shared/constants';
import { FormationInviteDialogData } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationInviteDialogComponent } from './formation-invite-dialog.component';

describe('FormationInviteDialogComponent', () => {
  let fixture: ComponentFixture<FormationInviteDialogComponent>;
  let component: FormationInviteDialogComponent;
  let close: ReturnType<typeof vi.fn>;
  let addUserToProject: ReturnType<typeof vi.fn>;
  let invalidateProjectSettings: ReturnType<typeof vi.fn>;
  let toast: ReturnType<typeof vi.fn>;

  const data: FormationInviteDialogData = { projectUid: 'proj-1', existingEmails: ['sam.chen@cascade-data.example'] };
  const directoryMiss = () => new HttpErrorResponse({ status: 404, error: { code: ERROR_CODES.NOT_FOUND, error: 'User not found' } });

  beforeEach(async () => {
    close = vi.fn();
    addUserToProject = vi.fn(() => of(undefined));
    invalidateProjectSettings = vi.fn();
    toast = vi.fn();

    await TestBed.configureTestingModule({
      imports: [FormationInviteDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: PermissionsService, useValue: { addUserToProject, invalidateProjectSettings } },
        { provide: MessageService, useValue: { add: toast } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationInviteDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** `onSubmit`/`onCancel` are the template's handlers — protected, so specs drive them the way the template does. */
  async function submit(): Promise<void> {
    (component as unknown as { onSubmit(): void }).onSubmit();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function errorId(field: 'name' | 'email'): string | undefined {
    return (component as unknown as { nameErrorId(): string | undefined; emailErrorId(): string | undefined })[`${field}ErrorId`]();
  }

  function fill(name: string, email: string, role: 'view' | 'manage' = 'view'): void {
    component.form.setValue({ name, email, role });
  }

  it('defaults the role to view', () => {
    expect(component.form.controls.role.value).toBe('view');
  });

  it('blocks an empty submission with both required errors and no request', async () => {
    await submit();

    expect(addUserToProject).not.toHaveBeenCalled();
    expect(errorId('name')).toBe('formation-invite-name-required');
    expect(errorId('email')).toBe('formation-invite-email-required');
  });

  it('rejects a malformed address without a request', async () => {
    fill('Jordan Lee', 'not-an-email');
    await submit();

    expect(addUserToProject).not.toHaveBeenCalled();
    expect(errorId('email')).toBe('formation-invite-email-invalid');
  });

  it('flags an address already on the project as soon as it is typed, and never sends it', async () => {
    component.form.controls.email.setValue('Sam.Chen@Cascade-Data.example');
    fixture.detectChanges();
    expect(errorId('email')).toBe('formation-invite-email-duplicate');

    component.form.controls.name.setValue('Sam Chen');
    await submit();
    expect(addUserToProject).not.toHaveBeenCalled();
  });

  it('adds an address with an LF account in one request, evicts the settings cache, toasts Added, and closes with added', async () => {
    fill('  Kim Park ', 'Kim.Park@Partner-Corp.example');
    await submit();

    expect(addUserToProject).toHaveBeenCalledTimes(1);
    expect(addUserToProject).toHaveBeenCalledWith('proj-1', { email: 'kim.park@partner-corp.example', role: 'view' });
    expect(invalidateProjectSettings).toHaveBeenCalledWith('proj-1');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Added', detail: expect.stringContaining('View access') }));
    expect(close).toHaveBeenCalledWith('added');
  });

  it('re-sends with the trimmed name on a directory miss — the manual add upstream emails an invite for — and closes with invite_sent', async () => {
    addUserToProject.mockReturnValueOnce(throwError(directoryMiss)).mockReturnValueOnce(of(undefined));
    fill('  Kim Park ', 'kim.park@partner-corp.example', 'manage');
    await submit();

    expect(addUserToProject).toHaveBeenCalledTimes(2);
    expect(addUserToProject).toHaveBeenNthCalledWith(1, 'proj-1', { email: 'kim.park@partner-corp.example', role: 'manage' });
    expect(addUserToProject).toHaveBeenNthCalledWith(2, 'proj-1', { name: 'Kim Park', email: 'kim.park@partner-corp.example', role: 'manage' });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Invite sent', detail: expect.stringContaining('Manage access') })
    );
    expect(close).toHaveBeenCalledWith('invite_sent');
  });

  it('surfaces any other failure as an error toast and stays open for a retry', async () => {
    addUserToProject.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'boom' } })));
    fill('Kim Park', 'kim.park@partner-corp.example');
    await submit();

    expect(addUserToProject).toHaveBeenCalledTimes(1);
    expect(invalidateProjectSettings).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Invite failed' }));
    expect((component as unknown as { submitting(): boolean }).submitting()).toBe(false);
  });

  it('ignores submit and cancel while a submission is in flight', async () => {
    addUserToProject.mockReturnValue(new Subject<void>().asObservable());
    fill('Kim Park', 'kim.park@partner-corp.example');
    await submit();
    await submit();
    (component as unknown as { onCancel(): void }).onCancel();

    expect(addUserToProject).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('closes without a result on Cancel', () => {
    (component as unknown as { onCancel(): void }).onCancel();

    expect(close).toHaveBeenCalledWith();
    expect(addUserToProject).not.toHaveBeenCalled();
  });
});
