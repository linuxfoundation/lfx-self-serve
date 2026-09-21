// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ControlEvent, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import {
  EMAIL_REGEX,
  ERROR_CODES,
  FORMATION_INVITE_BACK_TO_SEARCH_LABEL,
  FORMATION_INVITE_DIALOG_INTRO,
  FORMATION_INVITE_DUPLICATE_MESSAGE,
  FORMATION_INVITE_MANUAL_ENTRY_LABEL,
  FORMATION_INVITE_NAME_MAX_LENGTH,
  FORMATION_INVITE_NAME_NEEDED_DETAIL,
  FORMATION_INVITE_NAME_NEEDED_SUMMARY,
  FORMATION_INVITE_ROLE_OPTIONS,
  FORMATION_INVITE_SEARCH_HINT,
  FORMATION_INVITE_SEARCH_PLACEHOLDER,
  FORMATION_INVITE_SEARCH_REQUIRED_MESSAGE,
} from '@lfx-one/shared/constants';
import type {
  FormationInviteDialogData,
  FormationInviteFormValue,
  FormationInviteMode,
  FormationInviteOutcome,
  FormationInviteRoleOption,
  FormationPersonRole,
  UserSearchResult,
} from '@lfx-one/shared/interfaces';
import { composeFullName, formatUserLabel } from '@lfx-one/shared/utils';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { PermissionsService } from '@services/permissions.service';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, EMPTY, map, take, throwError } from 'rxjs';

/**
 * The people card's invite dialog (#2724, PR 2), opened through `DialogService` like this module's
 * other dialogs (`staff-edit-dialog`, `reason-prompt-dialog`). Two entry paths write the same
 * `email` control (#2772): a search box over the committee-member directory, by name or email, and
 * — for a partner the index cannot surface — the Name + Email fields behind "Enter their details
 * manually", the `staff-edit-dialog` pattern. A View/Manage radio (View by default) sits under
 * both. A formation invite is a project invite (#2147), so submission goes to the project
 * permissions add flow, directory lookup first — an address with an LF account is added outright
 * and closes with `'added'` — and, on the BFF's `NOT_FOUND` miss, again WITH the name, which the
 * BFF stores as an email-only entry (the shape upstream emails an invite for) and closes with
 * `'invite_sent'`. An address already on the project is rejected inline with no request. The
 * dialog owns the HTTP calls, the toasts and the settings cache eviction, and closes with the
 * outcome so the host can refresh; every exit is explicit (Cancel, or a success), since the host
 * opens it with `closable: false`.
 */
@Component({
  selector: 'lfx-formation-invite-dialog',
  imports: [ReactiveFormsModule, InputTextComponent, RadioButtonComponent, ButtonComponent, UserSearchComponent],
  templateUrl: './formation-invite-dialog.component.html',
  styleUrl: './formation-invite-dialog.component.scss',
})
export class FormationInviteDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly permissionsService = inject(PermissionsService);
  private readonly messageService = inject(MessageService);

  // Dialog data (provided via DialogService.open config)
  public readonly data: FormationInviteDialogData = inject(DynamicDialogConfig).data as FormationInviteDialogData;

  // `name` is only required on the manual path (see `applyModeValidators`): the inviter cannot
  // know whether the address already has an LF account, and the directory-miss re-send needs a
  // name to store an email-only entry — a pick supplies it, a hand-typed invite must ask for it.
  public readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(FORMATION_INVITE_NAME_MAX_LENGTH)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(EMAIL_REGEX)] }),
    role: new FormControl<FormationPersonRole>('view', { nonNullable: true }),
  });

  protected readonly submitting = signal(false);
  /** Search first; the manual fields are the escape hatch, never the default (#2772). */
  protected readonly mode = signal<FormationInviteMode>('search');

  protected readonly intro = FORMATION_INVITE_DIALOG_INTRO;
  protected readonly duplicateMessage = FORMATION_INVITE_DUPLICATE_MESSAGE;
  protected readonly searchPlaceholder = FORMATION_INVITE_SEARCH_PLACEHOLDER;
  protected readonly searchHint = FORMATION_INVITE_SEARCH_HINT;
  protected readonly manualEntryLabel = FORMATION_INVITE_MANUAL_ENTRY_LABEL;
  protected readonly backToSearchLabel = FORMATION_INVITE_BACK_TO_SEARCH_LABEL;
  protected readonly searchRequiredMessage = FORMATION_INVITE_SEARCH_REQUIRED_MESSAGE;
  protected readonly roleOptions: readonly FormationInviteRoleOption[] = FORMATION_INVITE_ROLE_OPTIONS;

  // Each control's own event stream mirrored into a signal: plain FormControl state is not
  // signal-reactive, so the error-id computeds below need this to re-run on touch/value/status
  // changes, and the template must read signals, not call methods.
  private readonly nameState: Signal<ControlEvent | null> = this.initControlState('name');
  private readonly emailState: Signal<ControlEvent | null> = this.initControlState('email');
  private readonly nameValue: Signal<string> = toSignal(this.form.controls.name.valueChanges, { initialValue: this.form.controls.name.value });
  private readonly emailValue: Signal<string> = toSignal(this.form.controls.email.valueChanges, { initialValue: this.form.controls.email.value });

  protected readonly isDuplicate: Signal<boolean> = computed(() => {
    // The picker's clear writes null into the control it binds, so coalesce before trimming.
    const email = (this.emailValue() ?? '').trim().toLowerCase();
    // An empty field is "not entered", never "already listed" — the required error owns that case.
    return email.length > 0 && this.data.existingEmails.includes(email);
  });
  protected readonly nameMaxLength = FORMATION_INVITE_NAME_MAX_LENGTH;
  /** The picked person as the search box's committed "Name (email)" label — lfx-user-search renders and restores it itself. */
  protected readonly selectedLabel: Signal<string> = computed(() => formatUserLabel(this.nameValue(), this.emailValue()));
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
    this.form.patchValue({ name: (this.form.controls.name.value ?? '').trim(), email: (this.form.controls.email.value ?? '').trim() });

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
          // No LF account for this address, and nothing to put on the invite email: a search pick
          // whose record carried no name. Ask for it on the manual path rather than re-sending a
          // blank the BFF would route straight back into the lookup that just missed.
          if (!value.name) {
            this.requireNameForInvite();
            return EMPTY;
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

  /**
   * A pick from the search box. `lfx-user-search` has already written the address into `email`;
   * the name is composed here — for the committed label, and for the directory-miss re-send —
   * rather than by binding `firstNameControl`/`lastNameControl`, which would clobber each other
   * writing into this form's single `name` control.
   */
  protected onPersonPicked(user: UserSearchResult): void {
    this.form.controls.name.setValue(composeFullName(user.first_name, user.last_name));
    this.form.controls.email.markAsTouched();
  }

  /**
   * The in-field clear on the picker. It nulls only the control it binds (`email`), so the address
   * is normalised back to the empty string the validators expect and the composed name goes with
   * it — a stale name must not survive to be sent under whatever address is picked next.
   */
  protected onPersonCleared(): void {
    this.form.controls.email.setValue('');
    this.form.controls.name.setValue('');
  }

  /** "Enter their details manually": swap the search box for the Name + Email fields, which then require a name for the invite email. */
  protected switchToManual(): void {
    if (this.submitting()) {
      return;
    }
    this.mode.set('manual');
    this.applyModeValidators('manual');
  }

  /**
   * Back to the search box. Whatever was typed by hand describes nobody the directory vouched for,
   * so both fields reset rather than riding along under a later pick — and clearing the name also
   * drops the manual-path `required` error, which would otherwise keep gating submit against a
   * field no longer on screen.
   */
  protected backToSearch(): void {
    if (this.submitting()) {
      return;
    }
    this.form.patchValue({ name: '', email: '' });
    this.form.controls.name.markAsUntouched();
    this.form.controls.email.markAsUntouched();
    this.mode.set('search');
    this.applyModeValidators('search');
  }

  private applyModeValidators(mode: FormationInviteMode): void {
    const name = this.form.controls.name;
    const validators = [Validators.maxLength(FORMATION_INVITE_NAME_MAX_LENGTH)];
    if (mode === 'manual') {
      validators.push(trimmedRequired());
    }
    name.setValidators(validators);
    name.updateValueAndValidity();
  }

  /** The address survives into the manual fields; the name field opens already flagged as required. */
  private requireNameForInvite(): void {
    this.submitting.set(false);
    this.mode.set('manual');
    this.applyModeValidators('manual');
    this.form.controls.name.markAsTouched();
    this.messageService.add({ severity: 'info', summary: FORMATION_INVITE_NAME_NEEDED_SUMMARY, detail: FORMATION_INVITE_NAME_NEEDED_DETAIL, life: 5000 });
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
