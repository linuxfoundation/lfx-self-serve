// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { OrganizationSearchComponent } from '@components/organization-search/organization-search.component';
import { MeetingRegistrant, User } from '@lfx-one/shared/interfaces';
import { markFormControlsAsTouched } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-public-registration-modal',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, OrganizationSearchComponent],
  templateUrl: './public-registration-modal.component.html',
})
export class PublicRegistrationModalComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  public readonly meetingId: string = this.config.data.meetingId;
  public readonly meetingTitle: string = this.config.data.meetingTitle;
  public readonly user: User | null = this.config.data.user;

  public submitting: WritableSignal<boolean> = signal(false);
  public form: FormGroup;

  public constructor() {
    this.form = new FormGroup({
      first_name: new FormControl('', [Validators.required, Validators.minLength(2)]),
      last_name: new FormControl('', [Validators.required, Validators.minLength(2)]),
      email: new FormControl('', [Validators.required, Validators.email]),
      job_title: new FormControl(''),
      org_name: new FormControl(''),
    });

    // Pre-populate with user data if available
    if (this.user) {
      let firstName: string | null = null;
      let lastName: string | null = null;

      if (this.user.name) {
        const nameParts = this.user.name.split(' ');
        firstName = nameParts[0];
        lastName = this.user.name.split(' ').slice(1).join(' ');
      } else {
        firstName = this.user.given_name || this.user.first_name || '';
        lastName = this.user.family_name || this.user.last_name || '';
      }

      this.form.patchValue({ first_name: firstName, last_name: lastName, email: this.user.email || '' });
    }
  }

  public onSubmit(): void {
    if (this.submitting()) {
      return;
    }

    if (this.form.valid) {
      this.submitting.set(true);
      const formValue = this.form.value;

      this.meetingService
        .registerForPublicMeeting({
          meeting_uid: this.meetingId,
          email: formValue.email,
          first_name: formValue.first_name,
          last_name: formValue.last_name,
          job_title: formValue.job_title || null,
          org_name: formValue.org_name || null,
        })
        .subscribe({
          next: (registrant: MeetingRegistrant) => {
            this.submitting.set(false);
            this.messageService.add({
              severity: 'success',
              summary: 'Registration Successful',
              detail: 'You have been registered for this meeting',
            });
            this.ref.close({ registered: true, registrant });
          },
          error: (error: any) => {
            this.submitting.set(false);
            const errorMessage = error?.error?.message || 'Failed to register for this meeting';
            this.messageService.add({
              severity: 'error',
              summary: 'Registration Failed',
              detail: errorMessage,
            });
          },
        });
    } else {
      markFormControlsAsTouched(this.form);
    }
  }

  public onCancel(): void {
    this.ref.close();
  }
}
