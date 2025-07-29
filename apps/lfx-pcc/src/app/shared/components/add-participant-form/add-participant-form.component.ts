// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT
// Generated with Claude Code

import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { InputTextComponent } from '@app/shared/components/input-text/input-text.component';
import { MeetingService } from '@app/shared/services/meeting.service';
import { MeetingParticipant } from '@lfx-pcc/shared/interfaces';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'lfx-add-participant-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, InputTextComponent],
  templateUrl: './add-participant-form.component.html',
  styleUrl: './add-participant-form.component.scss',
})
export class AddParticipantFormComponent {
  // Injected services
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);

  // Inputs
  public readonly meetingId = input.required<string>();

  // Outputs
  public readonly participantAdded = output<MeetingParticipant>();
  public readonly cancel = output<void>();

  // Class variables with explicit types
  public submitting: WritableSignal<boolean>;
  public form: FormGroup;

  public constructor() {
    this.submitting = signal<boolean>(false);
    this.form = this.initializeForm();
  }

  // Public methods
  public onSubmit(): void {
    if (this.form.valid) {
      this.submitting.set(true);
      const formValue = this.form.value;

      const participantData: Partial<MeetingParticipant> = {
        first_name: formValue.first_name,
        last_name: formValue.last_name,
        email: formValue.email,
        organization: formValue.organization || null,
        job_title: formValue.job_title || null,
        is_host: false,
      };

      this.meetingService.addMeetingParticipant(this.meetingId(), participantData).subscribe({
        next: (participant) => {
          this.submitting.set(false);
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Participant added successfully',
          });
          this.participantAdded.emit(participant);
          this.form.reset();
        },
        error: (error) => {
          this.submitting.set(false);
          console.error('Failed to add participant:', error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error?.error?.message || 'Failed to add participant',
          });
        },
      });
    } else {
      Object.keys(this.form.controls).forEach((key) => {
        this.form.get(key)?.markAsTouched();
        this.form.get(key)?.markAsDirty();
      });
    }
  }

  public onCancel(): void {
    this.cancel.emit();
  }

  // Private initialization methods
  private initializeForm(): FormGroup {
    return new FormGroup({
      first_name: new FormControl('', [Validators.required]),
      last_name: new FormControl('', [Validators.required]),
      email: new FormControl('', [Validators.required, Validators.email]),
      organization: new FormControl(''),
      job_title: new FormControl(''),
    });
  }
}
