// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MeetingRegisterDialogData, PublicMeetingRegistrationResponse, User } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { map, startWith } from 'rxjs';

/**
 * Register for Meeting dialog of the meeting details drawer: the signed-in profile fills the form, and the email stays the account's.
 * @description Closes with the new registration, or nothing on Cancel. A failure keeps the dialog open behind an error toast.
 */
@Component({
  selector: 'lfx-meeting-details-register-modal',
  imports: [ReactiveFormsModule, UiButtonComponent, UiInputComponent, UiModalComponent],
  templateUrl: './meeting-details-register-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingDetailsRegisterModalComponent {
  private readonly dialogRef = inject<DialogRef<PublicMeetingRegistrationResponse>>(DialogRef);
  private readonly data = inject<MeetingRegisterDialogData>(DIALOG_DATA);
  private readonly meetingService = inject(MeetingService);
  private readonly toast = inject(UiToastService);

  protected readonly meetingTitle = this.data.meetingTitle;
  /** The BFF registers the account behind the session, so an address typed here would be ignored; editable only without one. */
  protected readonly emailLocked = !!this.data.user?.email?.trim();
  protected readonly form = new FormGroup({
    first_name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/)] }),
    last_name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    job_title: new FormControl('', { nonNullable: true }),
    org_name: new FormControl('', { nonNullable: true }),
  });
  public readonly submitting = signal(false);
  /** Bumps on every value, status, touched or dirty change, so the messages below follow the form. */
  private readonly formState = toSignal(
    this.form.events.pipe(
      map(() => ({})),
      startWith({})
    ),
    { requireSync: true }
  );
  protected readonly invalid: Signal<boolean> = computed(() => {
    this.formState();
    return this.form.invalid;
  });
  protected readonly errors: Signal<Record<'first_name' | 'last_name' | 'email', string>> = this.initErrors();

  public constructor() {
    this.form.patchValue({ ...this.profileName(this.data.user), email: this.data.user?.email ?? '' });
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected submit(): void {
    if (this.submitting() || this.form.invalid) return;
    this.submitting.set(true);
    const value = this.form.getRawValue();
    this.meetingService
      .registerForPublicMeeting({
        meeting_id: this.data.meetingId,
        email: value.email,
        first_name: value.first_name,
        last_name: value.last_name,
        // Left out when blank: upstream declares both non-nullable.
        ...(value.job_title ? { job_title: value.job_title } : {}),
        ...(value.org_name ? { org_name: value.org_name } : {}),
      })
      .subscribe({
        next: (registrant) => {
          this.submitting.set(false);
          this.toast.show({
            variant: 'success',
            position: 'bottom-center',
            message: 'Registration Successful',
            description: 'You have been registered for this meeting',
          });
          this.dialogRef.close(registrant);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.toast.show({
            variant: 'error',
            position: 'bottom-center',
            message: 'Registration Failed',
            description: extractErrorMessage(error, 'Failed to register for this meeting'),
          });
        },
      });
  }

  /** First word as the first name and the rest as the last, as the meeting page does; else the profile's given and family names. */
  private profileName(user: User | null): { first_name: string; last_name: string } {
    if (!user) return { first_name: '', last_name: '' };
    if (user.name) {
      const [first = '', ...rest] = user.name.trim().split(/\s+/);
      return { first_name: first, last_name: rest.join(' ') };
    }
    return { first_name: user.given_name || user.first_name || '', last_name: user.family_name || user.last_name || '' };
  }

  /** A field's message shows once it has been edited and left, as on the meeting page. */
  private initErrors(): Signal<Record<'first_name' | 'last_name' | 'email', string>> {
    return computed(() => {
      this.formState();
      const shown = (name: 'first_name' | 'last_name' | 'email'): boolean => this.form.controls[name].touched && this.form.controls[name].dirty;
      const email = this.form.controls.email;
      const emailError = email.hasError('required') ? 'Email is required' : '';
      return {
        first_name: shown('first_name') && this.form.controls.first_name.invalid ? 'First name cannot be empty' : '',
        last_name: shown('last_name') && this.form.controls.last_name.invalid ? 'Last name cannot be empty' : '',
        email: shown('email') ? emailError || (email.hasError('email') ? 'Invalid email address' : '') : '',
      };
    });
  }
}
