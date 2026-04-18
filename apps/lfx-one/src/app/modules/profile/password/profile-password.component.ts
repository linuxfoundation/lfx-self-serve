// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, TitleCasePipe } from '@angular/common';
import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { markFormControlsAsTouched } from '@lfx-one/shared';
import { ChangePasswordRequest, PasswordStrength } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';

@Component({
  selector: 'lfx-profile-password',
  imports: [NgClass, TitleCasePipe, ReactiveFormsModule, CardComponent, InputTextComponent, MessageComponent, ButtonComponent, ToastModule, TooltipModule],
  providers: [MessageService],
  templateUrl: './profile-password.component.html',
})
export class ProfilePasswordComponent {
  private readonly accountRecovery = viewChild<ElementRef>('accountRecovery');
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);

  // State signals
  private readonly changingPasswordSignal = signal<boolean>(false);
  private readonly sendingResetSignal = signal<boolean>(false);
  private readonly showCurrentPasswordSignal = signal<boolean>(false);
  private readonly showNewPasswordSignal = signal<boolean>(false);
  private readonly showConfirmPasswordSignal = signal<boolean>(false);
  public readonly newPasswordSignal = signal<string>('');

  public readonly isChangingPassword = computed(() => this.changingPasswordSignal());
  public readonly isSendingReset = computed(() => this.sendingResetSignal());
  public readonly showCurrentPassword = computed(() => this.showCurrentPasswordSignal());
  public readonly showNewPassword = computed(() => this.showNewPasswordSignal());
  public readonly showConfirmPassword = computed(() => this.showConfirmPasswordSignal());

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
    // Subscribe to new password field changes to update the signal
    this.passwordForm
      .get('newPassword')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value: string | null) => {
        this.newPasswordSignal.set(value || '');
      });
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
        error: (error: HttpErrorResponse) => {
          if (error.error?.error === 'management_token_required' && error.error?.authorize_url) {
            window.location.href = error.error.authorize_url;
            return;
          }
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
        error: (error: HttpErrorResponse) => {
          if (error.error?.error === 'management_token_required' && error.error?.authorize_url) {
            window.location.href = error.error.authorize_url;
            return;
          }
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
