// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ERROR_CODES, PROJECT_SETTINGS_NOT_FOUND_CODE } from '@lfx-one/shared/constants';
import { StaffEditDialogData, UpdateProjectStaffRequest, UserInfo } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StaffEditDialogComponent } from './staff-edit-dialog.component';

describe('StaffEditDialogComponent', () => {
  let fixture: ComponentFixture<StaffEditDialogComponent>;
  let dialogRef: { close: ReturnType<typeof vi.fn> };
  let permissions: {
    updateProjectStaff: ReturnType<typeof vi.fn>;
    invalidateProjectSettings: ReturnType<typeof vi.fn>;
  };
  let messages: { add: ReturnType<typeof vi.fn> };
  /** The last confirmation the component asked for — accepted/rejected explicitly per test. */
  let confirmation: Confirmation | undefined;

  const CURRENT_ED: UserInfo = { name: 'Current ED', email: 'ed@example.com', username: 'currented' };

  function emailInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-email"] input');
  }

  function nameInput(): HTMLInputElement | null {
    return fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-name"] input');
  }

  function submitButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-submit"] button');
  }

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    submitButton().click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** The request body of the Nth updateProjectStaff call. */
  function requestBody(call = 0): UpdateProjectStaffRequest {
    return permissions.updateProjectStaff.mock.calls[call][1];
  }

  function httpError(status: number, code: string): HttpErrorResponse {
    return new HttpErrorResponse({ status, error: { code, message: 'nope' } });
  }

  function create(currentUser: UserInfo | null): void {
    dialogRef = { close: vi.fn() };
    confirmation = undefined;
    permissions = {
      // Default: the write never settles. Tests that care about the outcome override it, so the
      // ones that only inspect the request body can't accidentally depend on a success path.
      updateProjectStaff: vi.fn(() => new Observable<void>()),
      invalidateProjectSettings: vi.fn(),
    };
    messages = { add: vi.fn() };

    const data: StaffEditDialogData = {
      projectUid: 'project-1',
      role: 'executive_director',
      roleLabel: 'Executive Director',
      currentUser,
    };

    TestBed.configureTestingModule({
      imports: [StaffEditDialogComponent],
      providers: [
        provideRouter([]),
        { provide: DynamicDialogRef, useValue: dialogRef },
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: PermissionsService, useValue: permissions },
        { provide: MessageService, useValue: messages },
        // Real service, not a useValue fake: the template's <p-confirmDialog> subscribes to the
        // service's internal Subjects in its constructor, so a fake throws the moment the fixture
        // renders.
        ConfirmationService,
      ],
    });

    // confirm() is captured rather than forwarded to the real dialog: the manual-entry fallback
    // and the destructive clear both hang off a confirmation, and whether the writer accepted is
    // the branch under test in each case.
    const confirmationService = TestBed.inject(ConfirmationService);
    vi.spyOn(confirmationService, 'confirm').mockImplementation((c: Confirmation) => {
      confirmation = c;
      return confirmationService;
    });

    fixture = TestBed.createComponent(StaffEditDialogComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  }

  beforeEach(() => create(CURRENT_ED));

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
  });

  it('pre-fills the current assignee so replacing them is a one-field edit', () => {
    expect(emailInput().value).toBe(CURRENT_ED.email);
    // The manual-entry fields stay hidden until a directory miss is confirmed.
    expect(nameInput()).toBeNull();
  });

  it('sends the email alone when the directory has not been ruled out', async () => {
    await type(emailInput(), 'resolved@example.com');
    await submit();

    expect(permissions.updateProjectStaff).toHaveBeenCalledWith('project-1', expect.anything());
    // No `name` key at all: its presence is what tells the BFF to skip the directory lookup,
    // so sending an empty one here would silently persist a nameless manual entry.
    expect(requestBody().assignee).toEqual({ email: 'resolved@example.com' });
  });

  it('does not submit a blank email', async () => {
    await type(emailInput(), '');
    await submit();

    expect(permissions.updateProjectStaff).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#staff-email-required-error')).not.toBeNull();
  });

  it('does not submit a malformed email', async () => {
    await type(emailInput(), 'not-an-email');
    await submit();

    expect(permissions.updateProjectStaff).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#staff-email-format-error')).not.toBeNull();
  });

  describe('directory miss', () => {
    beforeEach(async () => {
      permissions.updateProjectStaff.mockReturnValue(throwError(() => httpError(404, ERROR_CODES.NOT_FOUND)));
      await type(emailInput(), 'nobody@example.com');
      await submit();
    });

    it('offers manual entry and reveals the name field once confirmed', async () => {
      expect(confirmation?.header).toBe('User Not Found');
      expect(nameInput()).toBeNull();

      confirmation?.accept?.();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(nameInput()).not.toBeNull();
      // The prior assignee's name must not be carried into a replacement.
      expect(nameInput()?.value).toBe('');
    });

    it('rejects a whitespace-only name after the switch to manual entry', async () => {
      confirmation?.accept?.();
      fixture.detectChanges();
      await fixture.whenStable();

      permissions.updateProjectStaff.mockClear();
      await type(nameInput()!, '   ');
      await submit();

      // Validators.required alone passes "   ", which the BFF reads as "no name" and routes
      // back into the directory lookup that just 404'd — trimmedRequired is what stops it.
      expect(permissions.updateProjectStaff).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('#staff-name-required-error')).not.toBeNull();
    });

    it('submits name + email once a real name is entered', async () => {
      confirmation?.accept?.();
      fixture.detectChanges();
      await fixture.whenStable();

      permissions.updateProjectStaff.mockClear();
      permissions.updateProjectStaff.mockReturnValue(new Observable<void>());
      await type(nameInput()!, 'New Person');
      await submit();

      expect(requestBody().assignee).toEqual({ email: 'nobody@example.com', name: 'New Person' });
    });

    it('leaves the form submittable again when manual entry is declined', async () => {
      confirmation?.reject?.();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(nameInput()).toBeNull();
      expect(submitButton().disabled).toBe(false);
    });
  });

  it('does not offer manual entry for a project-settings 404', async () => {
    // The BFF re-codes its own settings 404 precisely so it cannot be mistaken for a directory
    // miss — offering manual entry here would persist a staff member onto a project that is
    // gone or inaccessible.
    permissions.updateProjectStaff.mockReturnValue(throwError(() => httpError(404, PROJECT_SETTINGS_NOT_FOUND_CODE)));

    await type(emailInput(), 'resolved@example.com');
    await submit();

    expect(confirmation).toBeUndefined();
    expect(nameInput()).toBeNull();
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('does not offer manual entry for a 403', async () => {
    permissions.updateProjectStaff.mockReturnValue(throwError(() => httpError(403, 'AUTHORIZATION_REQUIRED')));

    await type(emailInput(), 'resolved@example.com');
    await submit();

    expect(confirmation).toBeUndefined();
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('clears the role with assignee null, but only after the confirmation is accepted', async () => {
    const clearButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-clear"] button');
    clearButton.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(permissions.updateProjectStaff).not.toHaveBeenCalled();
    expect(confirmation?.header).toBe('Remove Executive Director');

    confirmation?.accept?.();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(requestBody()).toEqual({ role: 'executive_director', assignee: null });
  });

  it('evicts the cached settings and closes with true on a successful save', async () => {
    permissions.updateProjectStaff.mockReturnValue(
      new Observable<void>((subscriber) => {
        subscriber.next();
        subscriber.complete();
      })
    );

    await type(emailInput(), 'resolved@example.com');
    await submit();

    // The dialog owns the eviction because DialogService is root-scoped and can outlive the
    // card that opened it — without this the root-scoped cache keeps serving the pre-save
    // document even though the write succeeded.
    expect(permissions.invalidateProjectSettings).toHaveBeenCalledWith('project-1');
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('keeps the dialog open on a failed save so the input is not lost', async () => {
    permissions.updateProjectStaff.mockReturnValue(throwError(() => httpError(500, 'INTERNAL')));

    await type(emailInput(), 'resolved@example.com');
    await submit();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(permissions.invalidateProjectSettings).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
  });

  it('offers no remove affordance when the role is unassigned', () => {
    document.body.removeChild(fixture.nativeElement);
    // The module is already instantiated by the outer beforeEach, so it has to be torn down
    // before a second configuration is accepted.
    TestBed.resetTestingModule();
    create(null);

    expect(fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-clear"]')).toBeNull();
    expect(emailInput().value).toBe('');
  });

  it('Cancel closes without a result', async () => {
    const cancelButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-cancel"] button');
    cancelButton.click();
    await fixture.whenStable();

    expect(dialogRef.close).toHaveBeenCalledTimes(1);
    expect(dialogRef.close.mock.calls[0]).toHaveLength(0);
    expect(permissions.updateProjectStaff).not.toHaveBeenCalled();
  });
});
