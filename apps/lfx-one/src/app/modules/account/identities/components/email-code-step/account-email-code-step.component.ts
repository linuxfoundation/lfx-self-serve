// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, viewChild } from '@angular/core';
import {
  EMAIL_CODE_NOT_RECEIVED_HINT,
  EMAIL_CODE_NOT_RECEIVED_TITLE,
  EMAIL_RESEND_SUPPORT_MESSAGE,
  EMAIL_RESEND_SUPPORT_TITLE,
} from '@lfx-one/shared/constants';
import { buildLinkedEmailSupportMessage } from '@lfx-one/shared/utils';
import { EmailCodeVerificationService } from '@services/email-code-verification.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';

/**
 * The code step of an Account & Settings email identity dialog (#6074): where the code went, the code field, the error and the
 * support notes. It reads the dialog's `EmailCodeVerificationService`.
 */
@Component({
  selector: 'lfx-account-email-code-step',
  imports: [UiInputComponent, UiNoteComponent, UiButtonComponent, OpenIntercomDirective],
  templateUrl: './account-email-code-step.component.html',
  host: { class: 'flex flex-col gap-[16px]' },
})
export class AccountEmailCodeStepComponent {
  protected readonly verification = inject(EmailCodeVerificationService);
  private readonly codeInput = viewChild.required(UiInputComponent);

  /** The address the code was sent to. */
  public readonly email = input.required<string>();

  protected readonly notReceivedTitle = EMAIL_CODE_NOT_RECEIVED_TITLE;
  protected readonly notReceivedHint = EMAIL_CODE_NOT_RECEIVED_HINT;
  protected readonly resendSupportTitle = EMAIL_RESEND_SUPPORT_TITLE;
  protected readonly resendSupportMessage = EMAIL_RESEND_SUPPORT_MESSAGE;
  protected readonly linkedSupportMessage = computed(() => buildLinkedEmailSupportMessage(this.email()));

  // Digits only, at most six, as typed or pasted. The field is set back too, so a stray letter does not stay on screen.
  protected onCode(value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    this.verification.code.set(digits);
    if (digits !== value) this.codeInput().value.set(digits);
  }
}
