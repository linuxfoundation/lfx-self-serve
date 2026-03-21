// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { Committee, JoinMode } from '@lfx-one/shared/interfaces';
import { CommitteeMemberVisibility } from '@lfx-one/shared/enums';
import { CommitteeService } from '@services/committee.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { take } from 'rxjs';

import { CommitteeSettingsComponent } from '../committee-settings/committee-settings.component';

@Component({
  selector: 'lfx-committee-settings-tab',
  imports: [CommitteeSettingsComponent, ButtonComponent],
  templateUrl: './committee-settings-tab.component.html',
  styleUrl: './committee-settings-tab.component.scss',
})
export class CommitteeSettingsTabComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly router = inject(Router);

  // Inputs
  public committee = input.required<Committee>();

  // Outputs
  public readonly committeeUpdated = output<void>();

  // State
  public saving = signal(false);
  public deleting = signal(false);

  // Form
  public form = new FormGroup({
    member_visibility: new FormControl(''),
    join_mode: new FormControl(''),
    business_email_required: new FormControl(false),
    enable_voting: new FormControl(false),
    is_audit_enabled: new FormControl(false),
    public: new FormControl(false),
    sso_group_enabled: new FormControl(false),
    show_meeting_attendees: new FormControl(false),
  });

  public constructor() {
    effect(
      () => {
        const c = this.committee();
        if (c) {
          this.form.patchValue({
            member_visibility: c.member_visibility || 'hidden',
            join_mode: c.join_mode || 'invite_only',
            business_email_required: c.business_email_required || false,
            enable_voting: c.enable_voting || false,
            is_audit_enabled: c.is_audit_enabled || false,
            public: c.public || false,
            sso_group_enabled: c.sso_group_enabled || false,
            show_meeting_attendees: c.show_meeting_attendees || false,
          });
        }
      },
      { allowSignalWrites: true }
    );
  }

  public confirmDelete(): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to permanently delete "${this.committee().name}"? This will remove all associated meetings, votes, surveys, and member records. This action cannot be undone.`,
      header: 'Delete Group',
      icon: 'fa-light fa-triangle-exclamation',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-outlined p-button-sm',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        this.deleting.set(true);
        this.committeeService
          .deleteCommittee(this.committee().uid)
          .pipe(take(1))
          .subscribe({
            next: () => {
              this.messageService.add({ severity: 'success', summary: 'Deleted', detail: `"${this.committee().name}" has been deleted` });
              this.deleting.set(false);
              this.router.navigate(['/groups']);
            },
            error: () => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete group' });
              this.deleting.set(false);
            },
          });
      },
    });
  }

  public saveSettings(): void {
    this.saving.set(true);
    const values = this.form.getRawValue();
    this.committeeService
      .updateCommittee(this.committee().uid, {
        member_visibility: (values.member_visibility as CommitteeMemberVisibility) || undefined,
        join_mode: (values.join_mode as JoinMode) || undefined,
        business_email_required: values.business_email_required ?? false,
        enable_voting: values.enable_voting ?? false,
        is_audit_enabled: values.is_audit_enabled ?? false,
        public: values.public ?? false,
        sso_group_enabled: values.sso_group_enabled ?? false,
        show_meeting_attendees: values.show_meeting_attendees ?? false,
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Settings saved' });
          this.saving.set(false);
          this.committeeUpdated.emit();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to save settings' });
          this.saving.set(false);
        },
      });
  }
}
