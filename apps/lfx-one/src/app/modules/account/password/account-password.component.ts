// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, Signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { ACCOUNT_PASSWORD_COPY, ACCOUNT_PASSWORD_STRENGTH_TONES } from '@lfx-one/shared/constants';
import { AccountPasswordCriterion, UiBadgeTone } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { AccountCardComponent } from '@shared/components/account-card/account-card.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { AccountSettingsComponent } from '../../settings/account-settings/account-settings.component';

/**
 * Account & Settings › Password (#6080): Change Password, Account Recovery and Two-Factor Authentication cards. It keeps the
 * settings page's password change, strength rules, reset link and Flow C round trips by extending it, and reports the reset
 * link as a toast.
 */
@Component({
  selector: 'lfx-account-password',
  imports: [NgTemplateOutlet, ReactiveFormsModule, AccountCardComponent, UiBadgeComponent, UiButtonComponent, UiInputComponent, UiNoteComponent],
  // The settings page opens its token dialogs through PrimeNG's, which this page never shows; toasts go to the app's own.
  providers: [DialogService],
  templateUrl: './account-password.component.html',
})
export class AccountPasswordComponent extends AccountSettingsComponent {
  private readonly toasts = inject(MessageService);
  private readonly sessionUser = inject(UserService).user;

  protected readonly copy = ACCOUNT_PASSWORD_COPY;
  protected readonly strengthTone: Signal<UiBadgeTone> = computed(() => ACCOUNT_PASSWORD_STRENGTH_TONES[this.passwordStrength().label]);
  protected readonly criteria: Signal<AccountPasswordCriterion[]> = this.initCriteria();

  /** Shows or hides one of the three password fields. */
  protected togglePassword(field: 'current' | 'new' | 'confirm'): void {
    if (field === 'current') this.toggleCurrentPasswordVisibility();
    else if (field === 'new') this.toggleNewPasswordVisibility();
    else this.toggleConfirmPasswordVisibility();
  }

  protected override showPasswordResetResult(success: boolean, message: string): void {
    if (!success) {
      this.toasts.add({ severity: 'error', summary: 'Error', detail: message });
      return;
    }
    // The link goes to the primary address, which is the one the session signed in with.
    const email = this.sessionUser()?.email || this.copy.resetSentFallbackEmail;
    this.toasts.add({ severity: 'success', summary: this.copy.resetSentSummary.replace('{email}', email), detail: this.copy.resetSentDetail });
  }

  private initCriteria(): Signal<AccountPasswordCriterion[]> {
    return computed(() => {
      const met = this.passwordStrength().requirements;
      return [
        { label: 'At least 8 characters', met: met.minLength },
        { label: 'Lowercase letter (a-z)', met: met.hasLowercase },
        { label: 'Uppercase letter (A-Z)', met: met.hasUppercase },
        { label: 'Number (0-9)', met: met.hasNumbers },
        { label: 'Special character (!@#$%^&*)', met: met.hasSpecialChars },
      ];
    });
  }
}
