// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { StaffEditDialogData, UpdateProjectStaffRequest } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-staff-edit-dialog',
  imports: [ReactiveFormsModule, InputTextComponent, ButtonComponent, ConfirmDialogModule],
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

  public constructor() {
    // Pre-fill the current assignee so replacing them is a one-field edit
    if (this.data.currentUser) {
      this.form().patchValue({
        email: this.data.currentUser.email,
        name: this.data.currentUser.name,
      });
    }
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
    // BFF to skip the directory lookup (the person is not in the directory).
    const assignee: UpdateProjectStaffRequest['assignee'] = this.showManualFields()
      ? { email: formValue.email, name: formValue.name }
      : { email: formValue.email };

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
          this.dialogRef.close(true);
        },
        error: (error: HttpErrorResponse) => {
          // Directory miss on the lookup attempt → offer the manual-entry fallback
          if (error.status === 404 && error.error?.code === 'NOT_FOUND' && !this.showManualFields()) {
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
   * Id of the email error currently on screen, wired to the input's `describedBy`/`invalid`
   * (undefined when none). A method, not a computed: plain FormControl state is not
   * signal-reactive, so a computed would freeze on its first read.
   */
  protected emailErrorId(): string | undefined {
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
  }

  /** Id of the name error currently on screen — see emailErrorId. */
  protected nameErrorId(): string | undefined {
    const control = this.form().get('name');
    return control?.touched && control.errors?.['required'] ? 'staff-name-required-error' : undefined;
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
        // Writer confirmed - show the manual entry fields and require a name
        this.showManualFields.set(true);
        this.submitting.set(false);

        // The name control may still hold the PRIOR assignee's pre-filled name — clear it
        // so a replacement can't be persisted under the previous person's name.
        this.form().get('name')?.reset();
        this.form().get('name')?.setValidators([Validators.required]);
        this.form().get('name')?.updateValueAndValidity();
      },
      reject: () => {
        this.submitting.set(false);
      },
    });
  }

  private createFormGroup(): FormGroup {
    return new FormGroup({
      email: new FormControl('', [Validators.required, Validators.email]),
      name: new FormControl(''),
    });
  }
}
