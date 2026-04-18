// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { markFormControlsAsTouched } from '@lfx-one/shared';
import { useResendCooldown } from '@shared/utils/resend-cooldown';
import { ChangePasswordRequest, EmailManagementData, PasswordStrength, UserEmail } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, catchError, finalize, of, switchMap, take } from 'rxjs';

@Component({
  selector: 'lfx-account-settings',
  host: { class: 'block' },
  imports: [NgClass, ReactiveFormsModule, BadgeComponent, ButtonComponent, InputTextComponent, ConfirmDialogModule, ToastModule, TooltipModule],
  providers: [ConfirmationService, MessageService],
  templateUrl: './account-settings.component.html',
})
export class AccountSettingsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  // ── Refresh mechanisms ──
  private emailRefresh = new BehaviorSubject<void>(undefined);

  // ── Resend cooldown ──
  private resendCooldownUtil = useResendCooldown(this.destroyRef);
  public resendCooldown = this.resendCooldownUtil.cooldown;

  // ── TOC active section ──
  public activeSection = signal('email-settings');

  // ══════════════════════════════════════════
  // EMAIL SETTINGS
  // ══════════════════════════════════════════

  // OTP flow state
  public otpStep = signal(false);
  public pendingEmail = signal('');
  public sendingCode = signal(false);
  public verifyingOtp = signal(false);

  // Add email form (step 1: enter email)
  public addEmailForm = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
  });

  // OTP form (step 2: enter code)
  public otpForm = new FormGroup({
    otp: new FormControl('', [Validators.required, Validators.pattern(/^\d{6}$/)]),
  });

  // State signals
  public emailLoading = signal(false);

  // Data signals
  public emailData: Signal<EmailManagementData | null> = this.initEmailData();

  public allEmails = computed((): UserEmail[] => {
    const data = this.emailData();
    if (!data) return [];
    const primary: UserEmail = { email: data.primary_email, verified: true };
    const alternates = (data.alternate_emails ?? []).filter((e) => e.email !== data.primary_email);
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

  // ══════════════════════════════════════════
  // DEVELOPER SETTINGS
  // ══════════════════════════════════════════

  public developerToken = signal('');
  public showToken = signal(false);
  public loadingToken = signal(true);
  public tokenCopied = signal(false);

  public maskedToken = computed(() => {
    const token = this.developerToken();
    if (!token || token.length <= 8) return token;
    return `${token.slice(0, 4)}${'*'.repeat(11)}${token.slice(-4)}`;
  });

  // ══════════════════════════════════════════
  // PASSWORD
  // ══════════════════════════════════════════

  // State signals
  public changingPassword = signal(false);
  public sendingReset = signal(false);
  public resetResultMessage = signal('');
  public resetResultSuccess = signal(false);
  public showCurrentPassword = signal(false);
  public showNewPassword = signal(false);
  public showConfirmPassword = signal(false);
  public newPasswordSignal = signal('');

  // Password form
  public passwordForm: FormGroup = this.fb.group(
    {
      currentPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required, this.passwordStrengthValidator()]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: this.passwordMatchValidator() }
  );

  public passwordStrength = computed(() => this.calculatePasswordStrength(this.newPasswordSignal()));
  public passwordStrengthLabel = computed(() => {
    const labels: Record<string, string> = { weak: 'Weak', fair: 'Fair', good: 'Good', strong: 'Strong' };
    return labels[this.passwordStrength().label] || '';
  });

  public constructor() {
    this.passwordForm
      .get('newPassword')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value: string | null) => {
        this.newPasswordSignal.set(value || '');
      });

    this.loadDeveloperToken();
  }

  // ══════════════════════════════════════════
  // TOC NAVIGATION
  // ══════════════════════════════════════════

  public scrollToSection(sectionId: string): void {
    this.activeSection.set(sectionId);
    if (!isPlatformBrowser(this.platformId)) return;
    const el = document.getElementById(sectionId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ══════════════════════════════════════════
  // EMAIL PUBLIC METHODS
  // ══════════════════════════════════════════

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
            this.resendCooldownUtil.start();
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
            this.emailRefresh.next();
            this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Email address added successfully' });
          } else {
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: response.message || 'Verification failed. Please check your code and try again.',
            });
          }
        },
        error: (error) => {
          if (error.status === 403 && error.error?.error === 'management_token_required') {
            window.location.href = error.error.authorize_url;
            return;
          }
          this.messageService.add({ severity: 'error', summary: 'Error', detail: error.error?.message || 'Verification failed. Please try again.' });
        },
      });
  }

  public cancelOtpStep(): void {
    this.otpStep.set(false);
    this.pendingEmail.set('');
    this.addEmailForm.reset();
    this.otpForm.reset();
    this.resendCooldownUtil.clear();
  }

  public setPrimary(email: UserEmail): void {
    if (email.email === this.emailData()?.primary_email || !email.verified) {
      return;
    }

    this.userService.setPrimaryEmail(email.email).subscribe({
      next: () => {
        this.emailRefresh.next();
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
          window.location.href = '/api/profile/auth/start?returnTo=/settings';
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
                  this.emailRefresh.next();
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

  // ══════════════════════════════════════════
  // PASSWORD PUBLIC METHODS
  // ══════════════════════════════════════════

  public onChangePassword(): void {
    if (this.passwordForm.invalid) {
      markFormControlsAsTouched(this.passwordForm);
      return;
    }

    const formValue = this.passwordForm.value;
    const changeRequest: ChangePasswordRequest = {
      current_password: formValue.currentPassword,
      new_password: formValue.newPassword,
    };

    this.changingPassword.set(true);

    this.userService
      .changePassword(changeRequest)
      .pipe(finalize(() => this.changingPassword.set(false)))
      .subscribe({
        next: (response) => {
          this.passwordForm.reset();
          this.messageService.add({ severity: 'success', summary: 'Success', detail: response.message || 'Password changed successfully!' });
        },
        error: (error: HttpErrorResponse) => {
          if (error.error?.error === 'management_token_required' && error.error?.authorize_url) {
            window.location.href = error.error.authorize_url;
            return;
          }
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error.error?.message || 'Failed to change password. Please try again.',
          });
        },
      });
  }

  public onSendPasswordReset(): void {
    this.sendingReset.set(true);
    this.resetResultMessage.set('');

    this.userService
      .sendPasswordResetEmail()
      .pipe(finalize(() => this.sendingReset.set(false)))
      .subscribe({
        next: (response) => {
          this.resetResultSuccess.set(true);
          this.resetResultMessage.set(response.message || 'Password reset email has been sent to your registered email address!');
        },
        error: (error: HttpErrorResponse) => {
          if (error.error?.error === 'management_token_required' && error.error?.authorize_url) {
            window.location.href = error.error.authorize_url;
            return;
          }
          this.resetResultSuccess.set(false);
          const msg = typeof error.error === 'string' ? error.error : error.error?.message;
          this.resetResultMessage.set(msg || 'There was a problem sending you a link. Please try again later.');
        },
      });
  }

  public clearPasswordForm(): void {
    this.passwordForm.reset();
    this.passwordForm.markAsUntouched();
  }

  public toggleCurrentPasswordVisibility(): void {
    this.showCurrentPassword.set(!this.showCurrentPassword());
  }

  public toggleNewPasswordVisibility(): void {
    this.showNewPassword.set(!this.showNewPassword());
  }

  public toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.set(!this.showConfirmPassword());
  }

  // ══════════════════════════════════════════
  // DEVELOPER SETTINGS PUBLIC METHODS
  // ══════════════════════════════════════════

  public toggleTokenVisibility(): void {
    this.showToken.set(!this.showToken());
  }

  public copyToken(): void {
    const token = this.developerToken();
    if (!token || !isPlatformBrowser(this.platformId)) return;

    navigator.clipboard.writeText(token).then(() => {
      this.tokenCopied.set(true);
      this.messageService.add({ severity: 'success', summary: 'Copied', detail: 'Token copied to clipboard' });
      setTimeout(() => this.tokenCopied.set(false), 2000);
    });
  }

  // ══════════════════════════════════════════
  // PRIVATE INITIALIZERS
  // ══════════════════════════════════════════

  private initEmailData(): Signal<EmailManagementData | null> {
    return toSignal(
      this.emailRefresh.pipe(
        switchMap(() => {
          this.emailLoading.set(true);
          return this.userService.getUserEmails().pipe(
            catchError(() => of(null)),
            finalize(() => this.emailLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private loadDeveloperToken(): void {
    this.loadingToken.set(true);
    this.userService
      .getDeveloperTokenInfo()
      .pipe(finalize(() => this.loadingToken.set(false)))
      .subscribe({
        next: (info) => this.developerToken.set(info.token),
        error: () => this.developerToken.set(''),
      });
  }

  private calculatePasswordStrength(password: string): PasswordStrength {
    const requirements = {
      minLength: password.length >= 8,
      hasLowercase: /[a-z]/.test(password),
      hasUppercase: /[A-Z]/.test(password),
      hasNumbers: /[0-9]/.test(password),
      hasSpecialChars: /[!@#$%^&*(),.?":{}|<>]/.test(password),
      meetsCriteria: false,
    };

    const typeCount = [requirements.hasLowercase, requirements.hasUppercase, requirements.hasNumbers, requirements.hasSpecialChars].filter(Boolean).length;
    requirements.meetsCriteria = typeCount >= 3;

    let score = 0;
    if (requirements.minLength) score++;
    if (requirements.meetsCriteria) score += 2;
    if (typeCount === 4) score++;

    let label: 'weak' | 'fair' | 'good' | 'strong' = 'weak';
    if (score >= 4) label = 'strong';
    else if (score >= 3) label = 'good';
    else if (score >= 2) label = 'fair';

    return { score, label, requirements };
  }

  private passwordStrengthValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;
      const strength = this.calculatePasswordStrength(control.value);
      if (!strength.requirements.minLength) return { minLength: true };
      if (!strength.requirements.meetsCriteria) return { weakPassword: true };
      return null;
    };
  }

  private passwordMatchValidator(): ValidatorFn {
    return (group: AbstractControl): ValidationErrors | null => {
      const newPassword = group.get('newPassword');
      const confirmPassword = group.get('confirmPassword');
      if (!newPassword || !confirmPassword || !confirmPassword.value) return null;
      return newPassword.value !== confirmPassword.value ? { passwordMismatch: true } : null;
    };
  }
}
