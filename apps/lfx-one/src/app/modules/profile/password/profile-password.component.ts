// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, OnInit, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { markFormControlsAsTouched } from '@lfx-one/shared';
import { ChangePasswordRequest, PasswordStrength, TwoFactorSettings } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, finalize, of, switchMap } from 'rxjs';

import { ProfileNavComponent } from '../components/profile-nav/profile-nav.component';

@Component({
  selector: 'lfx-profile-password',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardComponent,
    InputTextComponent,
    MessageComponent,
    ButtonComponent,
    ToastModule,
    TooltipModule,
    ProfileNavComponent,
  ],
  providers: [MessageService],
  templateUrl: './profile-password.component.html',
})
export class ProfilePasswordComponent implements OnInit {
  private readonly accountRecovery = viewChild<ElementRef>('accountRecovery');
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);

  // Refresh mechanism
  private refresh = new BehaviorSubject<void>(undefined);

  // State signals
  private readonly changingPasswordSignal = signal<boolean>(false);
  private readonly sendingResetSignal = signal<boolean>(false);
  private readonly loadingTwoFactorSignal = signal<boolean>(false);
  private readonly showCurrentPasswordSignal = signal<boolean>(false);
  private readonly showNewPasswordSignal = signal<boolean>(false);
  private readonly showConfirmPasswordSignal = signal<boolean>(false);
  public readonly newPasswordSignal = signal<string>('');

  public readonly isChangingPassword = computed(() => this.changingPasswordSignal());
  public readonly isSendingReset = computed(() => this.sendingResetSignal());
  public readonly isLoadingTwoFactor = computed(() => this.loadingTwoFactorSignal());
  public readonly showCurrentPassword = computed(() => this.showCurrentPasswordSignal());
  public readonly showNewPassword = computed(() => this.showNewPasswordSignal());
  public readonly showConfirmPassword = computed(() => this.showConfirmPasswordSignal());

  // Data signals using toSignal with refresh for 2FA settings
  public twoFactorData: Signal<TwoFactorSettings | null>;
  public readonly twoFactorSettings = computed(() => this.twoFactorData());

  // Password change form
  public passwordForm: FormGroup = this.fb.group(
    {
      currentPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required, this.passwordStrengthValidator()]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: this.passwordMatchValidator() }
  );

  // Password strength signal
  public passwordStrength = computed(() => {
    const password = this.newPasswordSignal();
    return this.calculatePasswordStrength(password);
  });

  public constructor() {
    this.twoFactorData = this.initializeTwoFactorData();

    // Subscribe to new password field changes to update the signal
    this.passwordForm
      .get('newPassword')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value: string | null) => {
        this.newPasswordSignal.set(value || '');
      });
  }

  public ngOnInit(): void {
    // 2FA data loads automatically via toSignal
  }

  // Password visibility toggle methods
  public toggleCurrentPasswordVisibility(): void {
    this.showCurrentPasswordSignal.set(!this.showCurrentPasswordSignal());
  }

  public toggleNewPasswordVisibility(): void {
    this.showNewPasswordSignal.set(!this.showNewPasswordSignal());
  }

  public toggleConfirmPasswordVisibility(): void {
    this.showConfirmPasswordSignal.set(!this.showConfirmPasswordSignal());
  }

  // Form submission methods
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

    this.changingPasswordSignal.set(true);

    this.userService
      .changePassword(changeRequest)
      .pipe(finalize(() => this.changingPasswordSignal.set(false)))
      .subscribe({
        next: (response) => {
          this.passwordForm.reset();
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: response.message || 'Password changed successfully!',
          });
        },
        error: (error) => {
          console.error('Error changing password:', error);
          const message = error.error?.message || 'Failed to change password. Please try again.';
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: message,
          });
        },
      });
  }

  public onSendPasswordReset(): void {
    this.sendingResetSignal.set(true);

    this.userService
      .sendPasswordResetEmail()
      .pipe(finalize(() => this.sendingResetSignal.set(false)))
      .subscribe({
        next: (response) => {
          this.messageService.add({
            severity: 'success',
            summary: 'Reset Email Sent',
            detail: response.message || 'Password reset email has been sent to your registered email address!',
          });
        },
        error: (error) => {
          console.error('Error sending password reset:', error);
          const message = error.error?.message || 'Failed to send password reset email. Please try again.';
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: message,
          });
        },
      });
  }

  public onReset(): void {
    this.passwordForm.reset();
    this.passwordForm.markAsUntouched();
  }

  public openTwoFactorSetup(): void {
    // For now, this will open an external link or show a message
    // In the future, this could navigate to a 2FA setup page
    window.open('https://docs.example.com/2fa-setup', '_blank');
  }

  public scrollToAccountRecovery(): void {
    const accountRecoveryElement = this.accountRecovery()?.nativeElement;
    if (accountRecoveryElement) {
      accountRecoveryElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }

  // Private helper methods
  private initializeTwoFactorData(): Signal<TwoFactorSettings | null> {
    this.loadingTwoFactorSignal.set(true);
    return toSignal(
      this.refresh.pipe(
        switchMap(() =>
          this.userService.getTwoFactorSettings().pipe(
            catchError((error) => {
              console.error('Error loading 2FA settings:', error);
              return of(null);
            }),
            finalize(() => this.loadingTwoFactorSignal.set(false))
          )
        )
      ),
      { initialValue: null }
    );
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

    // Count character types
    const typeCount = [requirements.hasLowercase, requirements.hasUppercase, requirements.hasNumbers, requirements.hasSpecialChars].filter(Boolean).length;

    requirements.meetsCriteria = typeCount >= 3;

    // Calculate score
    let score = 0;
    if (requirements.minLength) score++;
    if (requirements.meetsCriteria) score += 2;
    if (typeCount === 4) score++;

    // Determine label
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
      if (!strength.requirements.minLength) {
        return { minLength: true };
      }
      if (!strength.requirements.meetsCriteria) {
        return { weakPassword: true };
      }
      return null;
    };
  }

  private passwordMatchValidator(): ValidatorFn {
    return (group: AbstractControl): ValidationErrors | null => {
      const newPassword = group.get('newPassword');
      const confirmPassword = group.get('confirmPassword');

      if (!newPassword || !confirmPassword) return null;

      // Don't show error if confirm password is empty
      if (!confirmPassword.value) return null;

      if (newPassword.value !== confirmPassword.value) {
        return { passwordMismatch: true };
      }

      return null;
    };
  }
}
