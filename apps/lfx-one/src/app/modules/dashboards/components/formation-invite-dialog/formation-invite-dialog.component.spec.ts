// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FormGroup } from '@angular/forms';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { ERROR_CODES, FORMATION_INVITE_NAME_NEEDED_SUMMARY } from '@lfx-one/shared/constants';
import { FormationInviteDialogData, FormationInviteMode, UserSearchResult } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { SearchService } from '@services/search.service';
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
  const serverError = (status: number) => new HttpErrorResponse({ status, error: { error: 'boom' } });
  const directoryMiss = () => new HttpErrorResponse({ status: 404, error: { code: ERROR_CODES.NOT_FOUND, error: 'User not found' } });

  beforeEach(async () => {
    close = vi.fn();
    addUserToProject = vi.fn(() => of(undefined));
    invalidateProjectSettings = vi.fn();
    toast = vi.fn();

    await TestBed.configureTestingModule({
      imports: [FormationInviteDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: PermissionsService, useValue: { addUserToProject, invalidateProjectSettings } },
        { provide: SearchService, useValue: { searchUsers: vi.fn(() => of([])) } },
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

  // The search/manual toggles and the picker's handlers are template-driven and protected, like onSubmit.
  const handlers = (): {
    switchToManual(): void;
    backToSearch(): void;
    onPersonPicked(user: UserSearchResult): void;
    onPersonCleared(): void;
    mode(): FormationInviteMode;
    selectedLabel(): string;
  } =>
    component as unknown as {
      switchToManual(): void;
      backToSearch(): void;
      onPersonPicked(user: UserSearchResult): void;
      onPersonCleared(): void;
      mode(): FormationInviteMode;
      selectedLabel(): string;
    };

  // Await stability rather than forcing detectChanges — the file's own `submit()` pairs the two the same way.
  async function switchToManual(): Promise<void> {
    handlers().switchToManual();
    await fixture.whenStable();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
  }

  const kim: UserSearchResult = {
    uid: 'cm:kim',
    email: 'kim.park@partner-corp.example',
    first_name: 'Kim',
    last_name: 'Park',
    job_title: null,
    organization: null,
    committee: null,
    type: 'committee_member',
    username: 'kim.park',
  };

  it('defaults the role to view, and opens on the search path', () => {
    expect(component.form.controls.role.value).toBe('view');
    expect(handlers().mode()).toBe('search');
  });

  // #2772: the search path needs a pick (which supplies the name); only the manual path requires a typed name.
  it('in search mode, an empty submission asks for a pick and requires no name', async () => {
    await submit();

    expect(addUserToProject).not.toHaveBeenCalled();
    expect(errorId('email')).toBe('formation-invite-email-required');
    expect(errorId('name')).toBeUndefined();
  });

  it('blocks an empty manual submission with both required errors and no request', async () => {
    await switchToManual();
    await submit();

    expect(addUserToProject).not.toHaveBeenCalled();
    expect(errorId('name')).toBe('formation-invite-name-required');
    expect(errorId('email')).toBe('formation-invite-email-required');
  });

  it('a pick composes the name and the committed label; the in-field clear resets both', async () => {
    // lfx-user-search writes the address into the bound `email` control before emitting the pick.
    component.form.controls.email.setValue(kim.email);
    handlers().onPersonPicked(kim);
    await settle();

    expect(component.form.controls.name.value).toBe('Kim Park');
    expect(handlers().selectedLabel()).toBe('Kim Park (kim.park@partner-corp.example)');

    handlers().onPersonCleared();
    await settle();

    expect(component.form.controls.name.value).toBe('');
    expect(component.form.controls.email.value).toBe('');
    expect(handlers().selectedLabel()).toBe('');
  });

  it('a directory miss for a pick that carried no name switches to manual entry, asks for the name, and does not re-send', async () => {
    addUserToProject.mockReturnValueOnce(throwError(directoryMiss));
    fill('', 'kim.park@partner-corp.example');
    await submit();

    expect(addUserToProject).toHaveBeenCalledTimes(1);
    expect(handlers().mode()).toBe('manual');
    expect(errorId('name')).toBe('formation-invite-name-required');
    expect(component.form.controls.email.value).toBe('kim.park@partner-corp.example');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info', summary: FORMATION_INVITE_NAME_NEEDED_SUMMARY }));
    expect(close).not.toHaveBeenCalled();
    expect((component as unknown as { submitting(): boolean }).submitting()).toBe(false);
  });

  // GH-2694: the click on "Enter details manually" blurs the search box first, which discards the
  // typed text — the switch carries it into the field it belongs in instead of making the user retype it.
  it('carries typed search text into the manual fields — an address into Email, anything else into Name', async () => {
    const picker = (): UserSearchComponent => fixture.debugElement.query(By.directive(UserSearchComponent)).componentInstance as UserSearchComponent;
    const typeThenBlur = (text: string): void => {
      (picker() as unknown as { userSearchForm: FormGroup }).userSearchForm.get('userSearch')?.setValue(text, { emitEvent: false });
      picker().onSearchBlur();
    };

    typeThenBlur('pat@partner.example');
    await switchToManual();
    expect(handlers().mode()).toBe('manual');
    expect(component.form.controls.email.value).toBe('pat@partner.example');
    expect(component.form.controls.name.value).toBe('');

    handlers().backToSearch();
    await settle();
    typeThenBlur('Pat Lee');
    await switchToManual();
    expect(component.form.controls.name.value).toBe('Pat Lee');
    expect(component.form.controls.email.value).toBe('');
  });

  it('back to search resets both fields and drops the manual name requirement', async () => {
    await switchToManual();
    fill('Kim Park', 'not-an-email');
    await submit();
    expect(errorId('email')).toBe('formation-invite-email-invalid');

    handlers().backToSearch();
    await settle();

    expect(handlers().mode()).toBe('search');
    expect(component.form.controls.name.value).toBe('');
    expect(component.form.controls.email.value).toBe('');
    expect(component.form.controls.name.valid).toBe(true);
    expect(errorId('name')).toBeUndefined();
    expect(errorId('email')).toBeUndefined();
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

  it('accepts a pasted address with surrounding whitespace and normalises it before validating', async () => {
    fill('Kim Park', '  Kim.Park@Partner-Corp.example  ');
    await submit();

    expect(errorId('email')).toBeUndefined();
    expect(addUserToProject).toHaveBeenCalledWith('proj-1', { email: 'kim.park@partner-corp.example', role: 'view' });
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

  it('never treats an empty field as a duplicate, so the required error still shows', async () => {
    await submit();

    expect(errorId('email')).toBe('formation-invite-email-required');
  });

  it('caps the name length', () => {
    component.form.controls.name.setValue('x'.repeat(201));

    expect(component.form.controls.name.hasError('maxlength')).toBe(true);
  });

  it('surfaces a failure of the re-send after a directory miss as an error toast, resets submitting, and stays open', async () => {
    addUserToProject.mockReturnValueOnce(throwError(directoryMiss)).mockReturnValueOnce(throwError(() => serverError(500)));
    fill('Kim Park', 'kim.park@partner-corp.example');
    await submit();

    expect(addUserToProject).toHaveBeenCalledTimes(2);
    expect(invalidateProjectSettings).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Invite failed' }));
    expect((component as unknown as { submitting(): boolean }).submitting()).toBe(false);
  });

  it('surfaces any other failure as an error toast and stays open for a retry', async () => {
    addUserToProject.mockReturnValueOnce(throwError(() => serverError(500)));
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
