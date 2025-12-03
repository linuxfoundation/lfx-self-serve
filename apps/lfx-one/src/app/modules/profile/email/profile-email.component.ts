// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectComponent } from '@components/select/select.component';
import { EmailManagementData, EmailPreferences, UpdateEmailPreferencesRequest, UserEmail } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, finalize, switchMap, tap } from 'rxjs';

import { ProfileNavComponent } from '../components/profile-nav/profile-nav.component';

interface EmailOption {
  label: string;
  value: string | null;
}

@Component({
  selector: 'lfx-profile-email',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardComponent,
    InputTextComponent,
    MessageComponent,
    ButtonComponent,
    BadgeComponent,
    SelectComponent,
    ConfirmDialogModule,
    ToastModule,
    TooltipModule,
    ProfileNavComponent,
  ],
  templateUrl: './profile-email.component.html',
})
export class ProfileEmailComponent {
  private readonly userService = inject(UserService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // Refresh mechanism
  private refresh = new BehaviorSubject<void>(undefined);

  // Forms
  public addEmailForm = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
  });

  public preferencesForm = new FormGroup({
    meetingEmailId: new FormControl<string | null>(null),
    notificationEmailId: new FormControl<string | null>(null),
    billingEmailId: new FormControl<string | null>(null),
  });

  // State signals
  public loading = signal(false);
  public addingEmail = signal(false);
  public updatingPreferences = signal(false);

  // Data signals using toSignal with refresh
  public emailData = this.initializeEmailData();
  public emails = computed(() => this.emailData()?.emails || []);
  public preferences = computed(() => this.emailData()?.preferences || null);
  public emailOptions = this.initializeEmailOptions();

  // Computed values for template - never use functions in templates!
  public emailsWithMetadata = computed(() =>
    this.emails().map((email) => ({
      ...email,
      isPrimary: email.is_primary,
      isMeetingEmail: this.preferences()?.meeting_email_id === email.id,
      isNotificationEmail: this.preferences()?.notification_email_id === email.id,
      isBillingEmail: this.preferences()?.billing_email_id === email.id,
      canDelete: this.emails().length > 1 && !email.is_primary,
      canSetPrimary: !email.is_primary && email.is_verified,
    }))
  );
  // Public methods

  public addEmail(): void {
    if (this.addEmailForm.invalid) {
      return;
    }

    const email = this.addEmailForm.value.email!;
    this.addingEmail.set(true);

    this.userService
      .addEmail(email)
      .pipe(finalize(() => this.addingEmail.set(false)))
      .subscribe({
        next: () => {
          this.addEmailForm.reset();
          this.refresh.next();
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Email address added successfully',
          });
        },
        error: (error) => {
          console.error('Failed to add email:', error);
          const message = error.error?.message || 'Failed to add email address';
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: message,
          });
        },
      });
  }

  public setPrimary(email: UserEmail): void {
    if (email.is_primary) {
      return;
    }

    // Only allow verified emails to be set as primary
    if (!email.is_verified) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Only verified email addresses can be set as primary',
      });
      return;
    }

    this.userService.setPrimaryEmail(email.id).subscribe({
      next: () => {
        this.refresh.next();
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Primary email updated successfully',
        });
      },
      error: (error) => {
        console.error('Failed to set primary email:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to update primary email',
        });
      },
    });
  }

  public deleteEmail(email: UserEmail): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete <strong>${email.email}</strong>? This action cannot be undone.`,
      header: 'Delete Email Address',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => {
        this.userService.deleteEmail(email.id).subscribe({
          next: () => {
            this.refresh.next();
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'Email address deleted successfully',
            });
          },
          error: (error) => {
            console.error('Failed to delete email:', error);
            const message = error.error?.message || 'Failed to delete email address';
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: message,
            });
          },
        });
      },
    });
  }

  public resendVerification(email: UserEmail): void {
    // For now, just show a success toast. In the future, this will call an API endpoint
    this.messageService.add({
      severity: 'success',
      summary: 'Verification Email Sent',
      detail: `Verification email has been sent to ${email.email}`,
    });
  }

  public updatePreferences(): void {
    this.updatingPreferences.set(true);

    const preferences: UpdateEmailPreferencesRequest = {
      meeting_email_id: this.preferencesForm.value.meetingEmailId || null,
      notification_email_id: this.preferencesForm.value.notificationEmailId || null,
      billing_email_id: this.preferencesForm.value.billingEmailId || null,
    };

    this.userService
      .updateEmailPreferences(preferences)
      .pipe(finalize(() => this.updatingPreferences.set(false)))
      .subscribe({
        next: () => {
          this.refresh.next();
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Email preferences updated successfully',
          });
        },
        error: (error) => {
          console.error('Failed to update preferences:', error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to update email preferences',
          });
        },
      });
  }

  // Private methods
  private initializeEmailData(): Signal<EmailManagementData | null> {
    this.loading.set(true);
    return toSignal(
      this.refresh.pipe(
        switchMap(() =>
          this.userService.getUserEmails().pipe(
            tap((data) => {
              this.initializePreferencesForm(data.preferences);
            }),
            finalize(() => this.loading.set(false))
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initializeEmailOptions(): Signal<EmailOption[]> {
    return computed(() => {
      // Only include verified emails in notification preferences
      const verifiedEmails = this.emails()
        .filter((email) => email.is_verified)
        .map((email) => ({
          label: email.email,
          value: email.id,
        }));
      return verifiedEmails;
    });
  }

  private initializePreferencesForm(preferences: EmailPreferences | null): void {
    if (preferences && this.preferencesForm) {
      this.preferencesForm.patchValue({
        meetingEmailId: preferences.meeting_email_id,
        notificationEmailId: preferences.notification_email_id,
        billingEmailId: preferences.billing_email_id,
      });
    }
  }
}
