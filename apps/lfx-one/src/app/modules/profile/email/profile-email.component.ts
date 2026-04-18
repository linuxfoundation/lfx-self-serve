// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { EmailManagementData, UserEmail } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, catchError, finalize, of, switchMap, take } from 'rxjs';

@Component({
  selector: 'lfx-profile-email',
  imports: [
    NgClass,
    ReactiveFormsModule,
    CardComponent,
    InputTextComponent,
    MessageComponent,
    ButtonComponent,
    BadgeComponent,
    ConfirmDialogModule,
    ToastModule,
    TooltipModule,
  ],
  templateUrl: './profile-email.component.html',
})
export class ProfileEmailComponent {
  private readonly userService = inject(UserService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // Refresh mechanism
  private refresh = new BehaviorSubject<void>(undefined);

  // OTP flow state
  public otpStep = signal(false);
  public pendingEmail = signal('');
  public sendingCode = signal(false);
  public verifyingOtp = signal(false);

  // Forms
  public addEmailForm = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
  });

  public otpForm = new FormGroup({
    otp: new FormControl('', [Validators.required, Validators.pattern(/^\d{6}$/)]),
  });

  // State signals
  public loading = signal(false);

  // Data signals
  public emailData: Signal<EmailManagementData | null> = this.initializeEmailData();

  public allEmails = computed((): UserEmail[] => {
    const data = this.emailData();
    if (!data) return [];
    const primary: UserEmail = { email: data.primary_email, verified: true };
    const alternates = data.alternate_emails.filter((e) => e.email !== data.primary_email);
    return [primary, ...alternates];
  });

  public emailsWithMetadata = computed(() =>
    this.allEmails().map((email) => ({
      ...email,
      isPrimary: email.email === this.emailData()?.primary_email,
      canDelete: this.allEmails().length > 1 && email.email !== this.emailData()?.primary_email && !!email.user_id,
      canSetPrimary: email.email !== this.emailData()?.primary_email && email.verified,
    }))
  );

  // Public methods

  public sendVerificationCode(): void {
    if (this.addEmailForm.invalid) {
      return;
    }

    const email = this.addEmailForm.value.email!;
    this.sendingCode.set(true);

    this.userService
      .sendEmailVerificationCode(email)
      .pipe(finalize(() => this.sendingCode.set(false)))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.pendingEmail.set(email);
            this.otpStep.set(true);
          } else {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: response.message || 'Failed to send verification code' });
          }
        },
        error: (error) => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: error.error?.message || 'Failed to send verification code' });
        },
      });
  }

  public verifyAndLink(): void {
    if (this.otpForm.invalid) {
      return;
    }

    const otp = this.otpForm.value.otp!;
    this.verifyingOtp.set(true);

    this.userService
      .verifyAndLinkEmail(this.pendingEmail(), otp)
      .pipe(finalize(() => this.verifyingOtp.set(false)))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.cancelOtpStep();
            this.refresh.next();
            this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Email address added successfully' });
          } else {
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: response.message || 'Verification failed. Please check your code and try again.',
            });
          }
        },
        error: (err: HttpErrorResponse) => {
          if (err.error?.error === 'management_token_required' && err.error?.authorize_url) {
            window.location.href = err.error.authorize_url;
            return;
          }
          this.messageService.add({ severity: 'error', summary: 'Error', detail: err.error?.message || 'Verification failed. Please try again.' });
        },
      });
  }

  public cancelOtpStep(): void {
    this.otpStep.set(false);
    this.pendingEmail.set('');
    this.addEmailForm.reset();
    this.otpForm.reset();
  }

  public setPrimary(email: UserEmail): void {
    if (email.email === this.emailData()?.primary_email) {
      return;
    }

    if (!email.verified) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Only verified email addresses can be set as primary' });
      return;
    }

    this.userService
      .getProfileAuthStatus()
      .pipe(take(1))
      .subscribe((status) => {
        if (!status.authorized) {
          window.location.href = '/api/profile/auth/start?returnTo=/profile/emails';
          return;
        }

        this.userService.setPrimaryEmail(email.email).subscribe({
          next: () => {
            this.refresh.next();
            this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Primary email updated successfully' });
          },
          error: (err: HttpErrorResponse) => {
            if (err.error?.error === 'management_token_required' && err.error?.authorize_url) {
              window.location.href = err.error.authorize_url;
              return;
            }
            this.messageService.add({ severity: 'error', summary: 'Error', detail: err.error?.message || 'Failed to update primary email' });
          },
        });
      });
  }

  public deleteEmail(email: UserEmail): void {
    if (!email.user_id) {
      return;
    }

    const userId = email.user_id;

    this.userService
      .getProfileAuthStatus()
      .pipe(take(1))
      .subscribe((status) => {
        if (!status.authorized) {
          window.location.href = '/api/profile/auth/start?returnTo=/profile/emails';
          return;
        }

        this.confirmationService.confirm({
          message: `Are you sure you want to delete ${email.email}? This action cannot be undone.`,
          header: 'Delete Email Address',
          acceptLabel: 'Delete',
          rejectLabel: 'Cancel',
          acceptButtonStyleClass: 'p-button-danger p-button-sm',
          rejectButtonStyleClass: 'p-button-outlined p-button-sm',
          accept: () => {
            const identityId = `auth0:${userId}`;
            this.userService
              .rejectIdentity(identityId, 'email', userId)
              .pipe(take(1))
              .subscribe({
                next: () => {
                  this.refresh.next();
                  this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Email address deleted successfully' });
                },
                error: (err: HttpErrorResponse) => {
                  if (err.error?.error === 'management_token_required' && err.error?.authorize_url) {
                    window.location.href = err.error.authorize_url;
                    return;
                  }
                  this.messageService.add({ severity: 'error', summary: 'Error', detail: err.error?.message || 'Failed to delete email address' });
                },
              });
          },
        });
      });
  }

  // Private methods
  private initializeEmailData(): Signal<EmailManagementData | null> {
    return toSignal(
      this.refresh.pipe(
        switchMap(() => {
          this.loading.set(true);
          return this.userService.getUserEmails().pipe(
            catchError(() => of(null)),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
