// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, inject, output, signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { CreateMeetingRegistrantRequest, MeetingRegistrant, UpdateMeetingRegistrantRequest } from '@lfx-pcc/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { RegistrantFormComponent } from '../registrant-form/registrant-form.component';

@Component({
  selector: 'lfx-registrant-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, CheckboxComponent, RegistrantFormComponent],
  templateUrl: './registrant-modal.component.html',
  styleUrl: './registrant-modal.component.scss',
})
export class RegistrantModalComponent {
  // Injected services
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly confirmationService = inject(ConfirmationService);

  // Inputs
  public readonly meetingId = this.config.data.meetingId;
  public readonly registrant = this.config.data.registrant;

  // Outputs
  public readonly registrantSaved = output<MeetingRegistrant>();
  public readonly registrantDeleted = output<string>();
  public readonly cancel = output<void>();

  // Class variables with explicit types
  public submitting: WritableSignal<boolean>;
  public form: FormGroup;
  public isEditMode = !!this.registrant;

  public constructor() {
    this.submitting = signal<boolean>(false);
    this.form = this.initializeForm();

    if (this.registrant) {
      this.form.patchValue({
        first_name: this.registrant.first_name,
        last_name: this.registrant.last_name,
        email: this.registrant.email,
        job_title: this.registrant.job_title || '',
        org_name: this.registrant.org_name || '',
        host: this.registrant.host || false,
      });
    }
  }

  // Public methods
  public onSubmit(): void {
    if (this.submitting()) {
      return;
    }

    if (this.form.valid) {
      this.submitting.set(true);
      const formValue = this.form.value;

      if (this.isEditMode) {
        // For edit mode, call update API
        const updateData: UpdateMeetingRegistrantRequest = {
          meeting_uid: this.meetingId,
          email: formValue.email,
          first_name: formValue.first_name,
          last_name: formValue.last_name,
          job_title: formValue.job_title || null,
          org_name: formValue.org_name || null,
          host: formValue.host || false,
        };

        this.meetingService
          .updateMeetingRegistrants(this.meetingId, [
            {
              uid: this.registrant!.uid,
              changes: updateData,
            },
          ])
          .subscribe({
            next: (updatedRegistrants: MeetingRegistrant[]) => {
              const updatedRegistrant = updatedRegistrants[0];
              this.handleSuccess(updatedRegistrant, 'Registrant updated successfully');
            },
            error: (error: any) => {
              this.handleError(error, 'Failed to update registrant');
            },
          });
      } else {
        // For add mode, call add API
        const createData: CreateMeetingRegistrantRequest = {
          meeting_uid: this.meetingId,
          email: formValue.email,
          first_name: formValue.first_name,
          last_name: formValue.last_name,
          job_title: formValue.job_title || null,
          org_name: formValue.org_name || null,
          host: formValue.host || false,
        };

        this.meetingService.addMeetingRegistrants(this.meetingId, [createData]).subscribe({
          next: (newRegistrants: MeetingRegistrant[]) => {
            const newRegistrant = newRegistrants[0];
            this.handleSuccess(newRegistrant, 'Registrant added successfully');
          },
          error: (error: any) => {
            this.handleError(error, 'Failed to add registrant');
          },
        });
      }
    } else {
      this.markFormControlsAsTouched();
    }
  }

  public onDeleteRegistrant(): void {
    if (!this.registrant) return;

    this.confirmationService.confirm({
      message: `Are you sure you want to delete ${this.registrant.first_name} ${this.registrant.last_name}?`,
      header: 'Delete Registrant',
      acceptLabel: 'Yes, Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-sm p-button-secondary',
      accept: () => {
        this.submitting.set(true);

        this.meetingService.deleteMeetingRegistrants(this.meetingId, [this.registrant!.uid]).subscribe({
          next: () => {
            this.submitting.set(false);
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'Registrant deleted successfully',
            });

            // Emit deletion event and close modal
            this.registrantDeleted.emit(this.registrant!.uid);
            this.ref.close({ deleted: true, registrant: this.registrant });
          },
          error: (error: any) => {
            this.handleError(error, 'Failed to delete registrant');
          },
        });
      },
    });
  }

  public onCancel(): void {
    this.ref.close();
  }

  // Private helper methods
  private handleSuccess(registrant: MeetingRegistrant, message: string): void {
    this.submitting.set(false);
    this.messageService.add({
      severity: 'success',
      summary: 'Success',
      detail: message,
    });

    this.registrantSaved.emit(registrant);

    if (this.isEditMode) {
      // For edit mode, close the modal
      this.ref.close(registrant);
    } else {
      // For add mode, check if user wants to add more registrants
      const shouldAddMore = this.form.get('add_more_registrants')?.value;
      if (shouldAddMore) {
        // Reset form but keep checkbox state
        const addMoreState = this.form.get('add_more_registrants')?.value;
        this.form.reset();
        this.form.get('add_more_registrants')?.setValue(addMoreState);
      } else {
        // Close the modal
        this.ref.close(registrant);
      }
    }
  }

  private handleError(error: any, defaultMessage: string): void {
    this.submitting.set(false);
    console.error('Registrant modal error:', error);
    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: error?.error?.message || defaultMessage,
    });
  }

  private markFormControlsAsTouched(): void {
    Object.keys(this.form.controls).forEach((key) => {
      this.form.get(key)?.markAsTouched();
      this.form.get(key)?.markAsDirty();
    });
  }

  // Private initialization methods
  private initializeForm(): FormGroup {
    return new FormGroup({
      first_name: new FormControl(''),
      last_name: new FormControl(''),
      email: new FormControl('', [Validators.required, Validators.email]),
      job_title: new FormControl(''),
      org_name: new FormControl(''),
      host: new FormControl(false),
      add_more_registrants: new FormControl(false), // Only used in add mode
    });
  }
}
