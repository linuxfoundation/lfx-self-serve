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
import { EmailManagementData, EmailSettingsState, UserEmail } from '@lfx-one/shared/interfaces';
import { emailsEqual } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, catchError, finalize, forkJoin, Observable, of, switchMap, take } from 'rxjs';

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
  // Read-only when impersonating — email mutations act on the real account and are blocked server-side.
  public readonly impersonating = this.userService.impersonating;
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
  private readonly emailState: Signal<EmailSettingsState> = this.initEmailState();

  public emailData: Signal<EmailManagementData | null> = computed(() => this.emailState().emails);

  // Preferred meeting-invitation email (meeting-service). Its address cannot be deleted here —
  // doing so would orphan the meeting-service preference. Null = no override (uses primary).
  public meetingInviteEmail: Signal<string | null> = computed(() => this.emailState().invite?.email ?? null);

  public allEmails = computed((): UserEmail[] => {
    const data = this.emailData();
    if (!data) return [];
    const primary: UserEmail = { email: data.primary_email, verified: true };
    const alternates = data.alternate_emails.filter((e) => !emailsEqual(e.email, data.primary_email));
    return [primary, ...alternates];
  });

  public emailsWithMetadata = computed(() => {
    const inviteEmail = this.meetingInviteEmail();
    const primaryEmail = this.emailData()?.primary_email;
    return this.allEmails().map((email) => {
      // The invite address comes from the meeting-service (v1/SFDC), a different source than this
      // Auth0-backed list, so casing can legitimately differ — compare case-insensitively.
      const isPrimary = emailsEqual(email.email, primaryEmail);
      const isMeetingInvite = emailsEqual(email.email, inviteEmail);
      return {
        ...email,
        isPrimary,
        isMeetingInvite,
        canDelete: this.allEmails().length > 1 && !isPrimary && !!email.user_id && !isMeetingInvite,
        canSetPrimary: !isPrimary && email.verified,
      };
    });
  });

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
    if (emailsEqual(email.email, this.emailData()?.primary_email)) {
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

    // Defensive guard: never delete the email selected as the meeting-invitation preference.
    // The button is already hidden for it; this covers any programmatic call path.
    if (emailsEqual(email.email, this.meetingInviteEmail())) {
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

  /**
   * Loads the address list and the meeting-invitation preference as one unit, behind a single
   * loading flag. Fetching them independently let the list turn interactive while the preference
   * was still in flight, so the badge and the delete guard briefly protected the previous
   * selection — long enough to delete the newly chosen invite address and orphan the preference.
   */
  private initEmailState(): Signal<EmailSettingsState> {
    return toSignal(
      this.refresh.pipe(
        switchMap((): Observable<EmailSettingsState> => {
          this.loading.set(true);
          return forkJoin({
            emails: this.userService.getUserEmails().pipe(catchError(() => of(null))),
            invite: this.userService.getMeetingInviteEmail(),
          }).pipe(finalize(() => this.loading.set(false)));
        })
      ),
      { initialValue: { emails: null, invite: null } }
    );
  }
}
