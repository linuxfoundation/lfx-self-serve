// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { OrganizationSearchComponent } from '@components/organization-search/organization-search.component';
import { SelectComponent } from '@components/select/select.component';
import { APPOINTED_BY_OPTIONS, LINKEDIN_PROFILE_PATTERN, MEMBER_ROLES, VOTING_STATUSES } from '@lfx-one/shared/constants';
import { Committee, CommitteeMember, CreateCommitteeMemberRequest, MemberFormValue } from '@lfx-one/shared/interfaces';
import { formatDateToISOString, parseISODateString } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';

@Component({
  selector: 'lfx-member-form',
  imports: [ReactiveFormsModule, ButtonComponent, SelectComponent, InputTextComponent, CalendarComponent, OrganizationSearchComponent],
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

  // Form group created in constructor after committee is assigned from config
  public form!: ReturnType<typeof signal<FormGroup>>;
  public loading = signal<boolean>(false);

  // Config-based properties (static, set once on dialog open)
  public readonly isEditing: boolean;
  public readonly memberId: string | undefined;
  public readonly member: CommitteeMember | undefined;
  public readonly committee: Committee | undefined;
  // Wizard mode: returns data instead of calling API (used when committee doesn't exist yet)
  public readonly wizardMode: boolean;

  // Member options
  public roleOptions = MEMBER_ROLES;
  public votingStatusOptions = VOTING_STATUSES;
  public appointedByOptions = APPOINTED_BY_OPTIONS;

  public constructor() {
    // Initialize config-based properties
    this.isEditing = this.config.data?.isEditing || false;
    this.memberId = this.config.data?.memberId;
    this.member = this.config.data?.member;
    this.committee = this.config.data?.committee;
    this.wizardMode = this.config.data?.wizardMode || false;

    // Create form group after committee is assigned so enable_voting validators work
    this.form = signal<FormGroup>(this.createMemberFormGroup());

    // Initialize form with data when component is created
    this.initializeForm();
  }

  public clearRoleDates(): void {
    this.form().get('role_start')?.reset();
    this.form().get('role_end')?.reset();
    this.form().updateValueAndValidity();
  }

  public clearVotingDates(): void {
    this.form().get('voting_status_start')?.reset();
    this.form().get('voting_status_end')?.reset();
    this.form().updateValueAndValidity();
  }

  public onCancel(): void {
    this.config.data?.onCancel?.();
    this.dialogRef.close();
  }

  public onSubmit(): void {
    if (this.form().valid) {
      this.submitting.set(true);
      const formValue = this.form().getRawValue() as MemberFormValue;

      // Prepare member data using form values, mapping to new structure
      const memberData: CreateCommitteeMemberRequest = {
        first_name: formValue.first_name || null,
        last_name: formValue.last_name || null,
        email: formValue.email,
        job_title: formValue.job_title || null,
        linkedin_profile: formValue.linkedin_profile || null,
        appointed_by: formValue.appointed_by || null,
        role: formValue.role
          ? {
              name: formValue.role,
              start_date: formatDateToISOString(formValue.role_start) || null,
              end_date: formatDateToISOString(formValue.role_end) || null,
            }
          : null,
        voting: formValue.voting_status
          ? {
              status: formValue.voting_status,
              start_date: formatDateToISOString(formValue.voting_status_start) || null,
              end_date: formatDateToISOString(formValue.voting_status_end) || null,
            }
          : null,
        organization: this.buildOrganizationPayload(formValue),
      };

      // In wizard mode, return the data without calling API
      if (this.wizardMode) {
        this.submitting.set(false);
        this.dialogRef.close(memberData);
        return;
      }

      // Normal mode: call API
      const committeeId = this.committee?.uid;
      if (!committeeId) {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Committee ID is required',
        });
        this.submitting.set(false);
        return;
      }

      const operation = this.isEditing
        ? this.committeeService.updateCommitteeMember(committeeId, this.member!.uid as string, memberData)
        : this.committeeService.createCommitteeMember(committeeId, memberData);

      operation.subscribe({
        next: () => {
          this.submitting.set(false);
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `Member ${this.isEditing ? 'updated' : 'created'} successfully`,
          });
          this.dialogRef.close(true);
        },
        error: (err: HttpErrorResponse) => {
          this.submitting.set(false);
          if (err.status === 409) {
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: 'Member already exists',
            });
          } else {
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: getHttpErrorDetail(err, `Failed to ${this.isEditing ? 'update' : 'create'} member. Please try again.`),
            });
          }
        },
      });
    } else {
      this.form().markAllAsTouched();
    }
  }

  private initializeForm(): void {
    if (this.isEditing && this.member) {
      const member = this.member;
      this.form().patchValue({
        first_name: member.first_name,
        last_name: member.last_name,
        email: member.email,
        job_title: member.job_title,
        linkedin_profile: member.linkedin_profile,
        organization: member.organization?.name,
        organization_url: member.organization?.website,
        role: member.role?.name,
        voting_status: member.voting?.status,
        appointed_by: member.appointed_by,
        role_start: parseISODateString(member.role?.start_date),
        role_end: parseISODateString(member.role?.end_date),
        voting_status_start: parseISODateString(member.voting?.start_date),
        voting_status_end: parseISODateString(member.voting?.end_date),
      });
    }
  }

  private buildOrganizationPayload(formValue: MemberFormValue): CreateCommitteeMemberRequest['organization'] {
    if (formValue.organization || formValue.organization_url) {
      return {
        name: formValue.organization || null,
        website: formValue.organization_url || null,
      };
    }
    return null;
  }

  private createMemberFormGroup(): FormGroup {
    return new FormGroup(
      {
        first_name: new FormControl('', [Validators.required]),
        last_name: new FormControl('', [Validators.required]),
        email: new FormControl('', [Validators.required, Validators.email]),
        job_title: new FormControl(''),
        linkedin_profile: new FormControl('', [Validators.pattern(LINKEDIN_PROFILE_PATTERN)]),
        organization: new FormControl(''),
        organization_url: new FormControl(''),
        role: new FormControl('', this.committee?.enable_voting ? [Validators.required] : []),
        voting_status: new FormControl('', this.committee?.enable_voting ? [Validators.required] : []),
        appointed_by: new FormControl(''),
        role_start: new FormControl(null),
        role_end: new FormControl(null),
        voting_status_start: new FormControl(null),
        voting_status_end: new FormControl(null),
      },
      {
        validators: [
          MemberFormComponent.dateRangeValidator('role_start', 'role_end'),
          MemberFormComponent.dateRangeValidator('voting_status_start', 'voting_status_end'),
        ],
      }
    );
  }

  private static dateRangeValidator(startKey: string, endKey: string) {
    return (group: AbstractControl): ValidationErrors | null => {
      const start = group.get(startKey)?.value;
      const end = group.get(endKey)?.value;
      if (start && end && new Date(start) > new Date(end)) {
        return { [`${startKey}_after_${endKey}`]: true };
      }
      return null;
    };
  }
}
