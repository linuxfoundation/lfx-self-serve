// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardSelectorComponent } from '@components/card-selector/card-selector.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MAILING_LIST_MEMBER_LABEL } from '@lfx-one/shared/constants';
import { MailingListMemberDeliveryMode, MailingListMemberModStatus, MailingListMemberType } from '@lfx-one/shared/enums';
import { CardSelectorOption, MailingListMember } from '@lfx-one/shared/interfaces';
import { markFormControlsAsTouched } from '@lfx-one/shared/utils';
import { MailingListService } from '@services/mailing-list.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-manage-member-modal',
  imports: [ReactiveFormsModule, ButtonComponent, CardSelectorComponent, InputTextComponent],
  templateUrl: './manage-member-modal.component.html',
})
export class ManageMemberModalComponent {
  // Injected services
  private readonly fb = inject(FormBuilder);
  private readonly mailingListService = inject(MailingListService);
  private readonly messageService = inject(MessageService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  // Config data
  public readonly mailingListId: string = this.config.data.mailingListId;
  public readonly mailingListName: string = this.config.data.mailingListName;
  public readonly member: MailingListMember | null = this.config.data.member || null;

  // Computed
  public readonly isEditMode = !!this.member;

  // Constants
  protected readonly memberLabel = MAILING_LIST_MEMBER_LABEL;

  // State
  public submitting = signal<boolean>(false);
  public form: FormGroup;

  // Delivery mode options
  public readonly deliveryModeOptions: CardSelectorOption<MailingListMemberDeliveryMode>[] = [
    {
      value: MailingListMemberDeliveryMode.NORMAL,
      label: 'Individual',
      info: {
        description: "Receive each message as it's posted",
        icon: 'fa-light fa-envelope',
        color: '#2563eb',
      },
    },
    {
      value: MailingListMemberDeliveryMode.DIGEST,
      label: 'Digest',
      info: {
        description: 'Receive messages bundled together periodically',
        icon: 'fa-light fa-layer-group',
        color: '#9333ea',
      },
    },
    {
      value: MailingListMemberDeliveryMode.NONE,
      label: 'No Email',
      info: {
        description: 'Do not receive any emails from this list',
        icon: 'fa-light fa-bell-slash',
        color: '#6b7280',
      },
    },
  ];

  // Role options
  public readonly roleOptions: CardSelectorOption<MailingListMemberModStatus>[] = [
    {
      value: MailingListMemberModStatus.NONE,
      label: 'Member',
      info: {
        description: 'Standard member with normal posting permissions',
        icon: 'fa-light fa-user',
        color: '#2563eb',
      },
    },
    {
      value: MailingListMemberModStatus.MODERATOR,
      label: 'Moderator',
      info: {
        description: 'Can moderate messages and manage list settings',
        icon: 'fa-light fa-shield-check',
        color: '#9333ea',
      },
    },
  ];

  public constructor() {
    this.form = this.fb.group({
      first_name: ['', Validators.required],
      last_name: ['', Validators.required],
      job_title: [''],
      organization: [''],
      email: ['', [Validators.required, Validators.email]],
      delivery_mode: [MailingListMemberDeliveryMode.NORMAL],
      mod_status: [MailingListMemberModStatus.NONE],
    });

    // Populate form if editing
    if (this.member) {
      this.form.patchValue({
        first_name: this.member.first_name || '',
        last_name: this.member.last_name || '',
        job_title: this.member.job_title || '',
        organization: this.member.organization || '',
        email: this.member.email,
        delivery_mode: this.member.delivery_mode,
        mod_status: this.member.mod_status,
      });

      // Name and email are immutable in edit mode
      this.form.get('first_name')?.disable();
      this.form.get('last_name')?.disable();
      this.form.get('email')?.disable();
    }
  }

  public onSubmit(): void {
    if (this.submitting()) {
      return;
    }

    if (this.form.valid) {
      this.submitting.set(true);
      const formValue = this.form.getRawValue();

      if (this.isEditMode) {
        // Update existing member - PUT requires full payload
        // Only job_title and organization are editable, preserve other fields from existing member
        const updateData = {
          username: this.member!.username || null,
          first_name: this.member!.first_name || null,
          last_name: this.member!.last_name || null,
          organization: formValue.organization || null,
          job_title: formValue.job_title || null,
          delivery_mode: this.member!.delivery_mode,
          mod_status: this.member!.mod_status,
        };

        this.mailingListService.updateMember(this.mailingListId, this.member!.uid, updateData).subscribe({
          next: (updatedMember) => {
            this.handleSuccess(updatedMember, `${this.memberLabel.singular} updated successfully`);
          },
          error: (error) => {
            this.handleError(error, `Failed to update ${this.memberLabel.singular.toLowerCase()}`);
          },
        });
      } else {
        // Create new member - explicitly set member_type to DIRECT since this is manual addition
        const createData = {
          email: formValue.email,
          first_name: formValue.first_name || null,
          last_name: formValue.last_name || null,
          job_title: formValue.job_title || null,
          organization: formValue.organization || null,
          member_type: MailingListMemberType.DIRECT,
          delivery_mode: formValue.delivery_mode,
          mod_status: formValue.mod_status,
        };

        this.mailingListService.createMember(this.mailingListId, createData).subscribe({
          next: (newMember) => {
            this.handleSuccess(newMember, `${this.memberLabel.singular} added successfully`);
          },
          error: (error) => {
            this.handleError(error, `Failed to add ${this.memberLabel.singular.toLowerCase()}`);
          },
        });
      }
    } else {
      markFormControlsAsTouched(this.form);
    }
  }

  public onCancel(): void {
    this.ref.close();
  }

  private handleSuccess(_member: MailingListMember, message: string): void {
    this.submitting.set(false);
    this.messageService.add({
      severity: 'success',
      summary: 'Success',
      detail: message,
    });

    this.ref.close(true);
  }

  private handleError(error: unknown, defaultMessage: string): void {
    this.submitting.set(false);
    console.error('Manage member modal error:', error);

    const errorMessage = error instanceof Error ? error.message : (error as { error?: { message?: string } })?.error?.message || defaultMessage;

    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: errorMessage,
    });
  }
}
