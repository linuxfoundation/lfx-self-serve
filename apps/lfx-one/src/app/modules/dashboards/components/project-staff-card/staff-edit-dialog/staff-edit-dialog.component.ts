// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ControlEvent, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { ERROR_CODES } from '@lfx-one/shared/constants';
import { StaffEditDialogData, UpdateProjectStaffRequest, UserSearchResult } from '@lfx-one/shared/interfaces';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { PermissionsService } from '@services/permissions.service';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { map, merge, startWith, take } from 'rxjs';

@Component({
  selector: 'lfx-staff-edit-dialog',
  imports: [ReactiveFormsModule, InputTextComponent, ButtonComponent, ConfirmDialogModule, UserSearchComponent],
  templateUrl: './staff-edit-dialog.component.html',
})
export class StaffEditDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly permissionsService = inject(PermissionsService);

  // Dialog data (provided via DialogService.open config)
  public readonly data: StaffEditDialogData = inject(DynamicDialogConfig).data as StaffEditDialogData;

  // Create form group internally
  public form = signal<FormGroup>(this.createFormGroup());

  // Loading state for form submissions
  public submitting = signal<boolean>(false);

  // Track if the writer confirmed manual entry after the directory lookup found no match
  public showManualFields = signal<boolean>(false);

  // Whether the plain email input has replaced the typeahead. The picker searches the
  // committee-member pool (see the template), so anyone outside it — and anyone the writer knows
  // the address for but not the name — is reached by typing the address directly. The BFF's own
  // lookup is an exact NATS directory read, so a hand-typed address still resolves a real name.
  public manualEmailEntry = signal<boolean>(false);

  // The exact address that returned the directory 404. Manual entry is only ever valid for this
  // address, so `showManualFields` alone is not enough to authorize sending a hand-typed name —
  // see the email watcher in the constructor.
  private readonly confirmedManualEmail = signal<string | null>(null);

  // Each control's own event stream mirrored into a signal. Plain FormControl state is not
  // signal-reactive, so the error-id computeds below need this to re-run on touch/value/status
  // changes — and the template must read signals, not call methods
  // (docs/reviews/frontend-checklist.md § No template functions).
  private readonly emailState: Signal<ControlEvent | null> = this.initControlState('email');
  private readonly nameState: Signal<ControlEvent | null> = this.initControlState('name');

  /**
   * Id of the error currently on screen for each field, wired to the input's
   * `describedBy`/`invalid` and to the message blocks (undefined when there is none).
   */
  protected readonly emailErrorId: Signal<string | undefined> = this.initEmailErrorId();
  protected readonly nameErrorId: Signal<string | undefined> = this.initNameErrorId();

  /**
   * Committed "Name (email)" label for the picker's input box. `lfx-user-search` treats this as
   * the single source of truth for its text, so it both hydrates the box with the current
   * assignee and restores it after a blur that didn't pick anyone.
   */
  protected readonly selectedUserLabel: Signal<string> = this.initSelectedUserLabel();

  public constructor() {
    // Pre-fill the current assignee so replacing them is a one-field edit
    if (this.data.currentUser) {
      this.form().patchValue({
        email: this.data.currentUser.email,
        name: this.data.currentUser.name,
      });
    }

    // Editing the address after accepting manual entry invalidates the confirmation: the new
    // address was never looked up, and sending a name for it would make the BFF skip its lookup
    // and persist a manual record for someone the directory may well know. Drop back to
    // lookup mode so the next submit goes through the directory again.
    this.form()
      .get('email')!
      .valueChanges.pipe(takeUntilDestroyed())
      .subscribe((email: string | null) => {
        if (this.showManualFields() && email !== this.confirmedManualEmail()) {
          this.exitManualEntry();
        }
      });
  }

  public onSubmit(): void {
    // Mark all form controls as touched and dirty to show validation errors
    Object.keys(this.form().controls).forEach((key) => {
      const control = this.form().get(key);
      control?.markAsTouched();
      control?.markAsDirty();
    });

    if (this.form().invalid) {
      return;
    }

    if (!this.data?.projectUid || !this.data?.role) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Project information is required to update staff.',
      });
      return;
    }

    this.submitting.set(true);
    const formValue = this.form().value;

    // A name is only sent once the writer confirms manual entry — its presence tells the
    // BFF to skip the directory lookup (the person is not in the directory). The address must
    // match the one that actually 404'd: the watcher above keeps these in step, and this
    // re-check keeps the invariant local to the decision that depends on it.
    const isConfirmedManual = this.showManualFields() && formValue.email === this.confirmedManualEmail();
    const assignee: UpdateProjectStaffRequest['assignee'] = isConfirmedManual ? { email: formValue.email, name: formValue.name } : { email: formValue.email };

    this.permissionsService
      .updateProjectStaff(this.data.projectUid, { role: this.data.role, assignee })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `${this.data.roleLabel} updated successfully`,
          });
          // Evict here, not in the parent card: DialogService is root-scoped, so this dialog can
          // outlive the card that opened it. The card's onClose handler is torn down with the host,
          // which would otherwise leave the root-scoped settings cache holding the pre-save document.
          this.permissionsService.invalidateProjectSettings(this.data.projectUid);
          this.dialogRef.close(true);
        },
        error: (error: HttpErrorResponse) => {
          // Directory miss on the lookup attempt → offer the manual-entry fallback. The BFF
          // re-codes a 404 from its own project-settings read/write as
          // PROJECT_SETTINGS_NOT_FOUND, so a plain NOT_FOUND here means the assignee's email
          // was not in the directory — not that the project itself went away.
          const isDirectoryMiss = error.status === 404 && error.error?.code === ERROR_CODES.NOT_FOUND;

          if (isDirectoryMiss && !this.showManualFields()) {
            this.handleUserNotFound(formValue.email);
          } else {
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: getHttpErrorDetail(error, `Failed to update ${this.data.roleLabel}. Please try again.`),
            });
            this.submitting.set(false);
          }
        },
      });
  }

  public onClear(): void {
    const user = this.data?.currentUser;
    if (!user) {
      return;
    }

    this.confirmationService.confirm({
      header: `Remove ${this.data.roleLabel}`,
      message: `Remove ${user.name || user.email} as ${this.data.roleLabel}? The role will be left unassigned.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Yes, Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        this.clearRole();
      },
    });
  }

  public onCancel(): void {
    this.dialogRef.close();
  }

  /**
   * A pick from the typeahead. `lfx-user-search` has already patched the bound `email` control;
   * the display name is composed here rather than by binding `firstNameControl`/`lastNameControl`,
   * which would clobber each other writing into this form's single `name` control.
   *
   * The name is only ever used for the picker's own label — `onSubmit` sends a name solely for a
   * confirmed manual entry, so a pick still goes through the BFF's directory lookup and persists
   * the directory's own spelling rather than the search index's.
   */
  public handleUserSelection(user: UserSearchResult): void {
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    this.form()
      .get('name')
      ?.setValue(fullName || null);
  }

  /**
   * The in-field ⊗ on the picker. It nulls only the control it binds (`email`), so the composed
   * `name` is cleared here to keep the two in step — otherwise the stale name would keep rendering
   * in the committed label after the address behind it was cleared.
   */
  public handleSearchCleared(): void {
    this.form().get('name')?.setValue(null);
  }

  /** "Enter details manually" in the picker's footer — swap the typeahead for a plain email input. */
  public switchToManualEmailEntry(): void {
    this.manualEmailEntry.set(true);
  }

  public backToSearch(): void {
    // An invalid address would keep gating submit invisibly after the switch: its error message
    // renders only in manual mode, and the remounted picker is a separate control that cannot edit
    // `email`. Drop it rather than stranding the form (mirrors meeting-details' backToOwnerSearch).
    const email = this.form().get('email');
    if (email?.invalid) {
      email.setValue(null);
      // The composed name goes with it (same reasoning as handleSearchCleared): left behind, it
      // would render alone in the picker's box and read as a committed selection while `email` —
      // the control that actually gates submit — is empty.
      this.form().get('name')?.setValue(null);
    }

    // Returning to the picker means returning to lookup mode; a name confirmed for the address
    // that 404'd must not survive, or the next submit would skip the directory lookup.
    if (this.showManualFields()) {
      this.exitManualEntry();
    }

    this.manualEmailEntry.set(false);
  }

  private clearRole(): void {
    if (!this.data?.projectUid || !this.data?.role) {
      return;
    }

    this.submitting.set(true);

    this.permissionsService
      .updateProjectStaff(this.data.projectUid, { role: this.data.role, assignee: null })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `${this.data.roleLabel} removed`,
          });
          // See onSubmit: the dialog owns the write, so it owns the cache eviction.
          this.permissionsService.invalidateProjectSettings(this.data.projectUid);
          this.dialogRef.close(true);
        },
        error: (error: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: getHttpErrorDetail(error, `Failed to remove ${this.data.roleLabel}. Please try again.`),
          });
          this.submitting.set(false);
        },
      });
  }

  private handleUserNotFound(email: string): void {
    const message =
      `No user found with email address "${email}". ` +
      `The system could not locate this user in the directory.\n\n` +
      `Would you like to assign them anyway? You will need to manually enter their name.`;

    this.confirmationService.confirm({
      header: 'User Not Found',
      message,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Yes, Continue',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        // Writer confirmed - show the manual entry fields and require a name. The address is
        // recorded so manual entry stays bound to the one that actually returned the 404.
        this.showManualFields.set(true);
        this.confirmedManualEmail.set(email);
        this.submitting.set(false);

        // Swap the typeahead out too: the address that failed has to stay visible and correctable
        // next to the name field, and the picker's box can't show or edit `email` directly.
        this.manualEmailEntry.set(true);

        // The name control may still hold the PRIOR assignee's pre-filled name — clear it
        // so a replacement can't be persisted under the previous person's name.
        this.form().get('name')?.reset();
        // trimmedRequired alongside Validators.required: required alone passes a whitespace-only
        // string, which the BFF reads as "no name" (`assignee.name?.trim()`) and routes back into
        // the directory lookup that just 404'd. trimmedRequired lets null/undefined through, so
        // both validators are needed to cover empty and whitespace-only input.
        this.form().get('name')?.setValidators([Validators.required, trimmedRequired()]);
        this.form().get('name')?.updateValueAndValidity();
      },
      reject: () => {
        this.submitting.set(false);
      },
    });
  }

  /**
   * Undo the manual-entry switch: hide the name field, forget the confirmed address, and drop the
   * name validators. Clearing the validators matters as much as hiding the field — a stale
   * `required`/`trimmedRequired` error would otherwise block submitting an address that should
   * simply go back through the directory lookup, against a field no longer on screen.
   */
  private exitManualEntry(): void {
    this.showManualFields.set(false);
    this.confirmedManualEmail.set(null);

    const name = this.form().get('name');
    name?.clearValidators();
    name?.reset();
    name?.updateValueAndValidity();
  }

  private createFormGroup(): FormGroup {
    return new FormGroup({
      email: new FormControl('', [Validators.required, Validators.email]),
      name: new FormControl(''),
    });
  }

  private initSelectedUserLabel(): Signal<string> {
    const nameCtrl = this.form().get('name')!;
    const emailCtrl = this.form().get('email')!;

    // startWith so the label is composed from the constructor's pre-fill on first render, not only
    // after a later edit. The form is created once in a field initializer, so there is no need to
    // re-resolve the controls when it changes (it doesn't).
    return toSignal(
      merge(nameCtrl.valueChanges, emailCtrl.valueChanges).pipe(
        startWith(null),
        map(() => {
          const name = ((nameCtrl.value as string | null) || '').trim();
          const email = ((emailCtrl.value as string | null) || '').trim();
          if (name && email) {
            return `${name} (${email})`;
          }
          return name || email;
        })
      ),
      { initialValue: '' }
    );
  }

  private initControlState(control: string): Signal<ControlEvent | null> {
    // Per-control `events` rather than the group's: a FormGroup only re-emits a touched change
    // when its own aggregate touched flips, so a second field being touched would not notify.
    return toSignal(this.form().get(control)!.events, { initialValue: null });
  }

  private initEmailErrorId(): Signal<string | undefined> {
    return computed(() => {
      // Read the mirrored stream so this re-runs whenever the control's state changes.
      this.emailState();

      const control = this.form().get('email');
      if (!control?.touched || !control.errors) {
        return undefined;
      }
      if (control.errors['required']) {
        return 'staff-email-required-error';
      }
      if (control.errors['email']) {
        return 'staff-email-format-error';
      }
      return undefined;
    });
  }

  private initNameErrorId(): Signal<string | undefined> {
    return computed(() => {
      this.nameState();

      const control = this.form().get('name');
      const errors = control?.errors;
      // Both keys map to the one "Full name is required" message — see handleUserNotFound's validators.
      return control?.touched && (errors?.['required'] || errors?.['trimmedRequired']) ? 'staff-name-required-error' : undefined;
    });
  }
}
