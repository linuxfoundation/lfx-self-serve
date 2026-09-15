// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { ERROR_CODES, PROJECT_SETTINGS_NOT_FOUND_CODE } from '@lfx-one/shared/constants';
import { StaffEditDialogData, UpdateProjectStaffRequest, UserInfo, UserSearchResult } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { AutoCompleteSelectEvent } from 'primeng/autocomplete';
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

  const DIRECTORY_HIT: UserSearchResult = {
    first_name: 'Search',
    last_name: 'Result',
    email: 'search.result@example.com',
    username: 'sresult',
  } as UserSearchResult;

  /** The typeahead's input box — the dialog's default assignee affordance. */
  function searchInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-user-search"] input');
  }

  /** The plain email input, which only mounts once the picker's manual exit is taken. */
  function emailInput(): HTMLInputElement | null {
    return fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-email"] input');
  }

  function nameInput(): HTMLInputElement | null {
    return fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-name"] input');
  }

  /** The "← Back to search" exit, which only renders alongside the plain email input. */
  function backToSearchButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-back-to-search"]');
  }

  function submitButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-submit"] button');
  }

  /**
   * The mounted picker. Its selection, clear, and "Enter details manually" affordances all live
   * inside the autocomplete's overlay panel, which never renders in these tests — driving the
   * child's own handlers exercises the same wiring (child output → parent handler) without it.
   */
  function picker(): UserSearchComponent {
    return fixture.debugElement.query(By.directive(UserSearchComponent)).componentInstance;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  }

  /** Take the picker's manual exit, swapping the typeahead for the plain email input. */
  async function enterManualEmail(): Promise<void> {
    picker().onEnterManually();
    await settle();
  }

  /**
   * Put an address in the `email` control the way a writer assigning someone the typeahead can't
   * offer does: take the manual exit, then type. Every lookup and validation path below keys off
   * that control, and typing is the only way to reach an address outside the search pool.
   */
  async function typeEmail(value: string): Promise<void> {
    if (!emailInput()) {
      await enterManualEmail();
    }

    await type(emailInput()!, value);
  }

  async function submit(): Promise<void> {
    submitButton().click();
    await settle();
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
        // The picker pulls SearchService — and with it HttpClient — into the dialog's injector.
        // No request is expected here: the overlay panel never opens, so no query is ever typed.
        provideHttpClient(),
        provideHttpClientTesting(),
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

  beforeEach(async () => {
    create(CURRENT_ED);
    // The picker mirrors its committed label through an effect, so the box only reflects the
    // constructor's pre-fill once change detection has run.
    await settle();
  });

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
    // No search request should ever be issued here — the overlay never opens, so a pending one
    // would mean the picker started querying off some other trigger.
    TestBed.inject(HttpTestingController).verify();
  });

  it('opens on the typeahead, pre-filled with the current assignee', () => {
    expect(searchInput().value).toBe('Current ED (ed@example.com)');
    // The plain email input and the manual-entry fields both stay out until they're asked for.
    expect(emailInput()).toBeNull();
    expect(nameInput()).toBeNull();
  });

  it('sends the email alone when someone is picked from the typeahead', async () => {
    picker().onUserSelected({ value: DIRECTORY_HIT } as AutoCompleteSelectEvent);
    await settle();

    // The pick composes a label, but the write still carries only the address: the BFF's own
    // directory lookup persists the directory's spelling rather than the search index's.
    expect(searchInput().value).toBe('Search Result (search.result@example.com)');

    await submit();

    expect(requestBody().assignee).toEqual({ email: DIRECTORY_HIT.email });
  });

  it('drops the composed name when the picker is cleared', async () => {
    picker().onUserSelected({ value: DIRECTORY_HIT } as AutoCompleteSelectEvent);
    await settle();

    // The picker nulls only the control it binds (`email`), so without the parent clearing `name`
    // the box would keep rendering a name whose address is gone.
    picker().onSearchClear();
    await settle();

    expect(searchInput().value).toBe('');
  });

  it('does not submit without an assignee, and says so under the picker', async () => {
    picker().onSearchClear();
    await settle();
    await submit();

    expect(permissions.updateProjectStaff).not.toHaveBeenCalled();
    // The manual-mode message is keyed to a field that isn't mounted here, so the picker carries
    // its own copy — one that points at the manual exit.
    expect(fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-search-required-error"]')).not.toBeNull();
  });

  it('sends the email alone when the directory has not been ruled out', async () => {
    await typeEmail('resolved@example.com');
    await submit();

    expect(permissions.updateProjectStaff).toHaveBeenCalledWith('project-1', expect.anything());
    // No `name` key at all: its presence is what tells the BFF to skip the directory lookup,
    // so sending an empty one here would silently persist a nameless manual entry.
    expect(requestBody().assignee).toEqual({ email: 'resolved@example.com' });
  });

  it('does not submit a blank email', async () => {
    await typeEmail('');
    await submit();

    expect(permissions.updateProjectStaff).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#staff-email-required-error')).not.toBeNull();
  });

  it('does not submit a malformed email', async () => {
    await typeEmail('not-an-email');
    await submit();

    expect(permissions.updateProjectStaff).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#staff-email-format-error')).not.toBeNull();
  });

  it('abandons an invalid typed address when returning to the picker', async () => {
    await typeEmail('not-an-email');

    backToSearchButton().click();
    await settle();

    // The address has to go: its error message renders only in manual mode, and the remounted
    // picker is a separate control that cannot edit `email` — keeping it would gate submit
    // invisibly. The composed name goes with it so the box can't read as a live selection.
    expect(emailInput()).toBeNull();
    expect(searchInput().value).toBe('');
    expect(submitButton().disabled).toBe(false);
  });

  it('does not keep the old name against a hand-typed address', async () => {
    // Reachable without any 404: the pre-filled name survives the mode switch, and a valid new
    // address neither trips the invalid-email branch nor the confirmed-manual watcher. Left alone,
    // the picker would come back reading "Current ED (someone.else@example.com)" — a named person
    // asserted against an address that is not theirs, which a writer could reasonably Save.
    await typeEmail('someone.else@example.com');
    backToSearchButton().click();
    await settle();

    expect(searchInput().value).toBe('someone.else@example.com');
  });

  describe('directory miss', () => {
    beforeEach(async () => {
      permissions.updateProjectStaff.mockReturnValue(throwError(() => httpError(404, ERROR_CODES.NOT_FOUND)));
      await typeEmail('nobody@example.com');
      await submit();
    });

    it('offers manual entry and reveals the name field once confirmed', async () => {
      expect(confirmation?.header).toBe('User Not Found');
      expect(nameInput()).toBeNull();

      confirmation?.accept?.();
      await settle();

      expect(nameInput()).not.toBeNull();
      // The prior assignee's name must not be carried into a replacement.
      expect(nameInput()?.value).toBe('');
      // The address that failed stays on screen and correctable next to the name field.
      expect(emailInput()?.value).toBe('nobody@example.com');
    });

    it('rejects a whitespace-only name after the switch to manual entry', async () => {
      confirmation?.accept?.();
      await settle();

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
      await settle();

      permissions.updateProjectStaff.mockClear();
      permissions.updateProjectStaff.mockReturnValue(new Observable<void>());
      await type(nameInput()!, 'New Person');
      await submit();

      expect(requestBody().assignee).toEqual({ email: 'nobody@example.com', name: 'New Person' });
    });

    it('leaves manual entry when the email is changed, so the new address is looked up', async () => {
      confirmation?.accept?.();
      await settle();
      await type(nameInput()!, 'New Person');

      // The confirmation only ruled out 'nobody@example.com'. This address was never looked up,
      // so sending a name for it would make the BFF skip its lookup and persist a manual record
      // for someone the directory may well know.
      await type(emailInput()!, 'someone@example.com');

      // The name field is gone and its validators with it — a stale `required` error against a
      // hidden field would otherwise block the submit below.
      expect(nameInput()).toBeNull();

      permissions.updateProjectStaff.mockClear();
      permissions.updateProjectStaff.mockReturnValue(new Observable<void>());
      await submit();

      expect(requestBody().assignee).toEqual({ email: 'someone@example.com' });
    });

    it('still submits manually once the email is typed back to the address that 404d', async () => {
      confirmation?.accept?.();
      await settle();

      await type(emailInput()!, 'someone@example.com');
      await type(emailInput()!, 'nobody@example.com');

      // Returning to the confirmed address does not silently restore manual entry: that address
      // was cleared along with the confirmation, so the writer is sent back through the lookup.
      expect(nameInput()).toBeNull();

      permissions.updateProjectStaff.mockClear();
      permissions.updateProjectStaff.mockReturnValue(new Observable<void>());
      await submit();

      expect(requestBody().assignee).toEqual({ email: 'nobody@example.com' });
    });

    it('drops the confirmed manual entry when the writer goes back to the picker', async () => {
      confirmation?.accept?.();
      await settle();
      await type(nameInput()!, 'New Person');

      backToSearchButton().click();
      await settle();

      // Back on the picker means back in lookup mode: the name confirmed for the 404'd address
      // must not survive, or the next submit would skip the directory lookup for it.
      expect(nameInput()).toBeNull();

      permissions.updateProjectStaff.mockClear();
      permissions.updateProjectStaff.mockReturnValue(new Observable<void>());
      await submit();

      expect(requestBody().assignee).toEqual({ email: 'nobody@example.com' });
    });

    it('leaves the form submittable again when manual entry is declined', async () => {
      confirmation?.reject?.();
      await settle();

      expect(nameInput()).toBeNull();
      expect(submitButton().disabled).toBe(false);
    });
  });

  it('does not offer manual entry for a project-settings 404', async () => {
    // The BFF re-codes its own settings 404 precisely so it cannot be mistaken for a directory
    // miss — offering manual entry here would persist a staff member onto a project that is
    // gone or inaccessible.
    permissions.updateProjectStaff.mockReturnValue(throwError(() => httpError(404, PROJECT_SETTINGS_NOT_FOUND_CODE)));

    await typeEmail('resolved@example.com');
    await submit();

    expect(confirmation).toBeUndefined();
    expect(nameInput()).toBeNull();
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('does not offer manual entry for a 403', async () => {
    permissions.updateProjectStaff.mockReturnValue(throwError(() => httpError(403, 'AUTHORIZATION_REQUIRED')));

    await typeEmail('resolved@example.com');
    await submit();

    expect(confirmation).toBeUndefined();
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('clears the role with assignee null, but only after the confirmation is accepted', async () => {
    const clearButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-clear"] button');
    clearButton.click();
    await settle();

    expect(permissions.updateProjectStaff).not.toHaveBeenCalled();
    expect(confirmation?.header).toBe('Remove Executive Director');

    confirmation?.accept?.();
    await settle();

    expect(requestBody()).toEqual({ role: 'executive_director', assignee: null });
  });

  it('evicts the cached settings and closes with true on a successful save', async () => {
    permissions.updateProjectStaff.mockReturnValue(
      new Observable<void>((subscriber) => {
        subscriber.next();
        subscriber.complete();
      })
    );

    await typeEmail('resolved@example.com');
    await submit();

    // The dialog owns the eviction because DialogService is root-scoped and can outlive the
    // card that opened it — without this the root-scoped cache keeps serving the pre-save
    // document even though the write succeeded.
    expect(permissions.invalidateProjectSettings).toHaveBeenCalledWith('project-1');
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('keeps the dialog open on a failed save so the input is not lost', async () => {
    permissions.updateProjectStaff.mockReturnValue(throwError(() => httpError(500, 'INTERNAL')));

    await typeEmail('resolved@example.com');
    await submit();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(permissions.invalidateProjectSettings).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
  });

  it('opens on the plain input when the assigned address is malformed', async () => {
    document.body.removeChild(fixture.nativeElement);
    TestBed.resetTestingModule();
    create({ name: 'Legacy Record', email: 'not-an-email' });
    await settle();

    // The picker's box renders the committed label and snaps back on blur, so it can neither show
    // nor repair a bad address. Opening on the typeahead would leave the writer with a form that
    // refuses to submit and no visible reason why.
    expect(emailInput()).not.toBeNull();
    expect(emailInput()!.value).toBe('not-an-email');
  });

  it('abandons a malformed pre-fill, and its name, on an immediate return to the picker', async () => {
    document.body.removeChild(fixture.nativeElement);
    TestBed.resetTestingModule();
    create({ name: 'Legacy Record', email: 'not-an-email' });
    await settle();

    backToSearchButton().click();
    await settle();

    // Nothing was hand-edited, so the name is dropped by backToSearch's own setValue(null) reaching
    // the email watcher — which only works while manualEmailEntry is still true. An empty box, not
    // "Legacy Record", is what proves that ordering still holds.
    expect(searchInput().value).toBe('');
  });

  it('offers no remove affordance when the role is unassigned', async () => {
    document.body.removeChild(fixture.nativeElement);
    // The module is already instantiated by the outer beforeEach, so it has to be torn down
    // before a second configuration is accepted.
    TestBed.resetTestingModule();
    create(null);
    await settle();

    // An unassigned role is `required`-invalid, which must not be mistaken for a malformed
    // address: it still opens on the picker, where someone can actually be found.
    expect(emailInput()).toBeNull();

    expect(fixture.nativeElement.querySelector('[data-testid="staff-edit-dialog-clear"]')).toBeNull();
    expect(searchInput().value).toBe('');
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
