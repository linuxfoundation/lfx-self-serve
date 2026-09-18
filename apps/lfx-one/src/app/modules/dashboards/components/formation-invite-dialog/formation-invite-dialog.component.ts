// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ControlEvent, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import {
  EMAIL_REGEX,
  ERROR_CODES,
  FORMATION_INVITE_DIALOG_INTRO,
  FORMATION_INVITE_DUPLICATE_MESSAGE,
  FORMATION_INVITE_NAME_MAX_LENGTH,
  FORMATION_INVITE_ROLE_OPTIONS,
} from '@lfx-one/shared/constants';
import type {
  FormationInviteDialogData,
  FormationInviteFormValue,
  FormationInviteOutcome,
  FormationInviteRoleOption,
  FormationPersonRole,
} from '@lfx-one/shared/interfaces';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { PermissionsService } from '@services/permissions.service';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, map, take, throwError } from 'rxjs';

/**
 * The people card's invite dialog (#2724, PR 2), opened through `DialogService` like this module's
 * other dialogs (`staff-edit-dialog`, `reason-prompt-dialog`): name, email, and a View/Manage radio
 * (View by default). A formation invite is a project invite (#2147), so submission goes to the
 * project permissions add flow, directory lookup first — an address with an LF account is added
 * outright and closes with `'added'` — and, on the BFF's `NOT_FOUND` miss, again WITH the name,
 * which the BFF stores as an email-only entry (the shape upstream emails an invite for) and closes
 * with `'invite_sent'`. An address already on the project is rejected inline with no request.
 * Mirrors `StaffEditDialogComponent`: the dialog owns the HTTP calls, the toasts and the settings
 * cache eviction, and closes with the outcome so the host can refresh; every exit is explicit
 * (Cancel, or a success), since the host opens it with `closable: false`.
 */
@Component({
  selector: 'lfx-formation-invite-dialog',
  imports: [ReactiveFormsModule, InputTextComponent, RadioButtonComponent, ButtonComponent],
  templateUrl: './formation-invite-dialog.component.html',
  styleUrl: './formation-invite-dialog.component.scss',
})
export class FormationInviteDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly permissionsService = inject(PermissionsService);
  private readonly messageService = inject(MessageService);

  // Dialog data (provided via DialogService.open config)
  public readonly data: FormationInviteDialogData = inject(DynamicDialogConfig).data as FormationInviteDialogData;

  // `name` is required here although the API marks it optional: the inviter cannot know whether
  // the address already has an LF account, and the directory-miss re-send needs the name to store
  // an email-only entry. The field's hint says what it is for.
  public readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [trimmedRequired(), Validators.maxLength(FORMATION_INVITE_NAME_MAX_LENGTH)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(EMAIL_REGEX)] }),
    role: new FormControl<FormationPersonRole>('view', { nonNullable: true }),
  });

  protected readonly submitting = signal(false);

  protected readonly intro = FORMATION_INVITE_DIALOG_INTRO;
  protected readonly duplicateMessage = FORMATION_INVITE_DUPLICATE_MESSAGE;
  protected readonly roleOptions: readonly FormationInviteRoleOption[] = FORMATION_INVITE_ROLE_OPTIONS;

  // Each control's own event stream mirrored into a signal: plain FormControl state is not
  // signal-reactive, so the error-id computeds below need this to re-run on touch/value/status
  // changes, and the template must read signals, not call methods.
  private readonly nameState: Signal<ControlEvent | null> = this.initControlState('name');
  private readonly emailState: Signal<ControlEvent | null> = this.initControlState('email');
  private readonly emailValue: Signal<string> = toSignal(this.form.controls.email.valueChanges, { initialValue: this.form.controls.email.value });

  protected readonly isDuplicate: Signal<boolean> = computed(() => {
    const email = this.emailValue().trim().toLowerCase();
    // An empty field is "not entered", never "already listed" — the required error owns that case.
    return email.length > 0 && this.data.existingEmails.includes(email);
  });
  protected readonly nameMaxLength = FORMATION_INVITE_NAME_MAX_LENGTH;
  /** Id of the error currently on screen for each field — wired to the input's `describedBy`/`invalid` and the message block. */
  protected readonly nameErrorId: Signal<string | undefined> = this.initNameErrorId();
  protected readonly emailErrorId: Signal<string | undefined> = this.initEmailErrorId();

  protected onCancel(): void {
    if (this.submitting()) {
      return;
    }
    this.dialogRef.close();
  }

  protected onSubmit(): void {
    if (this.submitting()) {
      return;
    }

    // Normalise before validating: a pasted address often carries surrounding whitespace, and the
    // anchored email pattern would otherwise reject a value this form trims on emit anyway.
    this.form.patchValue({ name: this.form.controls.name.value.trim(), email: this.form.controls.email.value.trim() });

    // Submit stays enabled so a click surfaces the validation messages; the guard is here.
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isDuplicate()) {
      return;
    }

    const raw = this.form.getRawValue();
    const value: FormationInviteFormValue = { name: raw.name.trim(), email: raw.email.trim().toLowerCase(), role: raw.role };
    this.submitting.set(true);

    this.permissionsService
      .addUserToProject(this.data.projectUid, { email: value.email, role: value.role })
      .pipe(
        map((): FormationInviteOutcome => 'added'),
        catchError((error: unknown) => {
          if (!FormationInviteDialogComponent.isDirectoryMiss(error)) {
            return throwError(() => error);
          }
          // No LF account for this address: re-send WITH the name, which the BFF treats as a
          // manual add and stores email-only — the shape upstream sends the invite email for.
          return this.permissionsService
            .addUserToProject(this.data.projectUid, { name: value.name, email: value.email, role: value.role })
            .pipe(map((): FormationInviteOutcome => 'invite_sent'));
        }),
        // `take(1)` only — deliberately NOT `takeUntilDestroyed` (the staff dialog's precedent): this
        // is a write, and HttpClient aborts an in-flight request on unsubscribe, so tearing the
        // subscription down with the dialog (a navigation away mid-submit) could cancel a permissions
        // write that already left the client and skip the settings-cache eviction. The stream
        // completes on its own after one result either way.
        take(1)
      )
      .subscribe({
        next: (outcome) => {
          // Evict where the write happened, so the Permissions page's shared settings cache can
          // never serve the pre-add document whichever host opened this dialog.
          this.permissionsService.invalidateProjectSettings(this.data.projectUid);
          this.messageService.add({
            severity: 'success',
            summary: outcome === 'invite_sent' ? 'Invite sent' : 'Added',
            detail: FormationInviteDialogComponent.successDetail(value, outcome),
            life: 3000,
          });
          this.dialogRef.close(outcome);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.messageService.add({
            severity: 'error',
            summary: 'Invite failed',
            detail: serverAuthoredMessage(error, 'Could not add this person. Please try again.'),
            life: 5000,
          });
        },
      });
  }

  private initControlState(control: 'name' | 'email'): Signal<ControlEvent | null> {
    // Per-control `events` rather than the group's: a FormGroup only re-emits a touched change
    // when its own aggregate touched flips, so a second field being touched would not notify.
    return toSignal(this.form.controls[control].events, { initialValue: null });
  }

  private initNameErrorId(): Signal<string | undefined> {
    return computed(() => {
      this.nameState();
      const control = this.form.controls.name;
      if (control.touched && control.invalid) {
        return 'formation-invite-name-required';
      }
      return undefined;
    });
  }

  private initEmailErrorId(): Signal<string | undefined> {
    return computed(() => {
      this.emailState();
      // A duplicate is worth flagging as soon as it is typed — it needs no touch to be certain.
      if (this.isDuplicate()) {
        return 'formation-invite-email-duplicate';
      }
      const control = this.form.controls.email;
      if (!control.touched) {
        return undefined;
      }
      if (control.hasError('required')) {
        return 'formation-invite-email-required';
      }
      if (control.hasError('pattern')) {
        return 'formation-invite-email-invalid';
      }
      return undefined;
    });
  }

  /**
   * The BFF's directory miss on the add flow: a 404 whose body code is `NOT_FOUND`. A project
   * that vanished mid-flow also lands here (this route does not re-code its own settings 404
   * the way the staff route does) and triggers the manual re-send, which then 404s again and
   * surfaces as the error toast — acceptable degradation for a vanished project.
   */
  private static isDirectoryMiss(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 404 && error.error?.code === ERROR_CODES.NOT_FOUND;
  }

  private static successDetail(value: FormationInviteFormValue, outcome: FormationInviteOutcome): string {
    const roleLabel = FORMATION_INVITE_ROLE_OPTIONS.find((option) => option.value === value.role)?.label ?? value.role;
    if (outcome === 'invite_sent') {
      return `An invite was emailed to ${value.email} for ${roleLabel} access.`;
    }
    return `${value.email} was added with ${roleLabel} access.`;
  }
}
