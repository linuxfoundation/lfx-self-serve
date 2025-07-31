// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT
// Generated with Claude Code

import { CommonModule } from '@angular/common';
import { Component, inject, output, signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MeetingParticipant } from '@lfx-pcc/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-participant-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, CheckboxComponent, InputTextComponent],
  templateUrl: './participant-form.component.html',
  styleUrl: './participant-form.component.scss',
})
export class ParticipantFormComponent {
  // Injected services
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly confirmationService = inject(ConfirmationService);

  // Inputs
  public readonly meetingId = this.config.data.meetingId;
  public readonly participant = this.config.data.participant;

  // Outputs
  public readonly participantSaved = output<MeetingParticipant>();
  public readonly cancel = output<void>();

  // Class variables with explicit types
  public submitting: WritableSignal<boolean>;
  public form: FormGroup;
  public isEditMode = !!this.participant;

  public constructor() {
    this.submitting = signal<boolean>(false);
    this.form = this.initializeForm();

    if (this.participant) {
      this.form.patchValue({
        first_name: this.participant.first_name,
        last_name: this.participant.last_name,
        email: this.participant.email,
        organization: this.participant.organization || '',
        job_title: this.participant.job_title || '',
      });
    }
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
        // Note: add_more_participants is excluded as it's only for UI control
      };

      const operation = this.isEditMode
        ? this.meetingService.updateMeetingParticipant(this.meetingId, this.participant!.id, participantData)
        : this.meetingService.addMeetingParticipant(this.meetingId, participantData);

      const successMessage = this.isEditMode ? 'Guest updated successfully' : 'Guest added successfully';
      const errorMessage = this.isEditMode ? 'Failed to update guest' : 'Failed to add guest';

      operation.subscribe({
        next: (participant: MeetingParticipant) => {
          this.submitting.set(false);
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: successMessage,
          });
          this.participantSaved.emit(participant);

          if (this.isEditMode) {
            // For edit mode, close the modal
            this.ref.close(participant);
          } else {
            // For add mode, check if user wants to add more participants
            const shouldAddMore = this.form.get('add_more_participants')?.value;
            if (shouldAddMore) {
              // Reset form but keep checkbox state
              const addMoreState = this.form.get('add_more_participants')?.value;
              this.form.reset();
              this.form.get('add_more_participants')?.setValue(addMoreState);
            } else {
              // Close the modal
              this.ref.close(participant);
            }
          }
        },
        error: (error: any) => {
          this.submitting.set(false);
          console.error(`Failed to ${this.isEditMode ? 'update' : 'add'} guest:`, error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error?.error?.message || errorMessage,
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

  public onDeleteGuest(): void {
    if (!this.participant) return;

    this.confirmationService.confirm({
      message: `Are you sure you want to delete ${this.participant.first_name} ${this.participant.last_name}?`,
      header: 'Delete Guest',
      acceptLabel: 'Yes, Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-sm p-button-secondary',
      accept: () => {
        this.submitting.set(true);
        this.meetingService.deleteMeetingParticipant(this.meetingId, this.participant!.id).subscribe({
          next: () => {
            this.submitting.set(false);
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'Guest deleted successfully',
            });
            // Close modal and indicate deletion occurred
            this.ref.close(true);
          },
          error: (error: any) => {
            this.submitting.set(false);
            console.error('Failed to delete guest:', error);
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: error?.error?.message || 'Failed to delete guest',
            });
          },
        });
      },
    });
  }

  public onCancel(): void {
    this.ref.close();
  }

  // Private initialization methods
  private initializeForm(): FormGroup {
    return new FormGroup({
      first_name: new FormControl('', [Validators.required]),
      last_name: new FormControl('', [Validators.required]),
      email: new FormControl('', [Validators.required, Validators.email]),
      organization: new FormControl(''),
      job_title: new FormControl(''),
      add_more_participants: new FormControl(false), // Only used in add mode
    });
  }
}
