// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { MEMBER_ROLES, VOTING_STATUSES } from '@lfx-pcc/shared/constants';
import { CommitteeMember } from '@lfx-pcc/shared/interfaces';
import { formatDateToISOString, parseISODateString } from '@lfx-pcc/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-member-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, SelectComponent, InputTextComponent, CalendarComponent],
  templateUrl: './member-form.component.html',
  styleUrl: './member-form.component.scss',
})
export class MemberFormComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly committeeService = inject(CommitteeService);
  private readonly messageService = inject(MessageService);

  // Loading state for form submissions
  public submitting = signal<boolean>(false);

  // Create form group internally
  public form = signal<FormGroup>(this.createMemberFormGroup());
  public loading = signal<boolean>(false);

  public isEditing = computed(() => this.config.data?.isEditing || false);
  public memberId = computed(() => this.config.data?.memberId);
  public member = computed(() => this.config.data?.member);
  public committee = computed(() => this.config.data?.committee);

  // Member options
  public roleOptions = MEMBER_ROLES;
  public votingStatusOptions = VOTING_STATUSES;

  public constructor() {
    // Initialize form with data when component is created
    this.initializeForm();
  }

  public onCancel(): void {
    this.config.data?.onCancel?.();
    this.dialogRef.close();
  }

  public onSubmit(): void {
    if (this.form().valid) {
      this.submitting.set(true);
      const formValue = this.form().value;
      const committeeId = this.committee().id;

      if (!committeeId) {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Committee ID is required',
        });
        this.submitting.set(false);
        return;
      }

      // Prepare member data using form values directly, with date formatting overrides
      const memberData: Partial<CommitteeMember> = {
        ...formValue,
        // Override date fields to format them properly (convert Date objects to ISO date strings)
        role_start: formatDateToISOString(formValue.role_start),
        role_end: formatDateToISOString(formValue.role_end),
        voting_status_start: formatDateToISOString(formValue.voting_status_start),
        voting_status_end: formatDateToISOString(formValue.voting_status_end),
      };

      const operation = this.isEditing()
        ? this.committeeService.updateCommitteeMember(committeeId, this.memberId()!, memberData)
        : this.committeeService.createCommitteeMember(committeeId, memberData);

      operation.subscribe({
        next: () => {
          this.submitting.set(false);
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `Member ${this.isEditing() ? 'updated' : 'created'} successfully`,
          });
          this.dialogRef.close(true);
        },
        error: (error) => {
          this.submitting.set(false);
          console.error('Failed to save member:', error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: `Failed to ${this.isEditing() ? 'update' : 'create'} member`,
          });
        },
      });
    } else {
      // Mark all fields as touched to show validation errors
      Object.keys(this.form().controls).forEach((key) => {
        this.form().get(key)?.markAsTouched();
      });
    }
  }

  private initializeForm(): void {
    if (this.isEditing() && this.member()) {
      const member = this.member()!;
      this.form().patchValue({
        first_name: member.first_name,
        last_name: member.last_name,
        email: member.email,
        job_title: member.job_title,
        organization: member.organization,
        organization_url: member.organization_url,
        role: member.role,
        voting_status: member.voting_status,
        appointed_by: member.appointed_by,
        role_start: parseISODateString(member.role_start),
        role_end: parseISODateString(member.role_end),
        voting_status_start: parseISODateString(member.voting_status_start),
        voting_status_end: parseISODateString(member.voting_status_end),
      });
    }
  }

  private createMemberFormGroup(): FormGroup {
    return new FormGroup({
      first_name: new FormControl('', [Validators.required]),
      last_name: new FormControl('', [Validators.required]),
      email: new FormControl('', [Validators.required, Validators.email]),
      job_title: new FormControl(''),
      organization: new FormControl(''),
      organization_url: new FormControl('', [Validators.pattern('^https?://.+')]),
      role: new FormControl(''),
      voting_status: new FormControl(''),
      appointed_by: new FormControl(''),
      role_start: new FormControl(null),
      role_end: new FormControl(null),
      voting_status_start: new FormControl(null),
      voting_status_end: new FormControl(null),
    });
  }
}
