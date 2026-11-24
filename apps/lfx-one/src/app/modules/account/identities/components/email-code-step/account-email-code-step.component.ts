// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, ElementRef, inject, input, viewChild } from '@angular/core';
import {
  EMAIL_CODE_NOT_RECEIVED_HINT,
  EMAIL_CODE_NOT_RECEIVED_TITLE,
  EMAIL_RESEND_SUPPORT_MESSAGE,
  EMAIL_RESEND_SUPPORT_TITLE,
  EMAIL_VERIFICATION_CODE_LENGTH,
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly codeInput = viewChild.required(UiInputComponent);

  /** The address the code was sent to. */
  public readonly email = input.required<string>();

  protected readonly notReceivedTitle = EMAIL_CODE_NOT_RECEIVED_TITLE;
  protected readonly notReceivedHint = EMAIL_CODE_NOT_RECEIVED_HINT;
  protected readonly resendSupportTitle = EMAIL_RESEND_SUPPORT_TITLE;
  protected readonly resendSupportMessage = EMAIL_RESEND_SUPPORT_MESSAGE;
  protected readonly linkedSupportMessage = computed(() => buildLinkedEmailSupportMessage(this.email()));

  // Digits only, at most six, as typed or pasted (a pasted "123 456" counts). The field's own value is set back, and the native
  // input too: after a letter typed past five digits the value it last rendered is unchanged, so no binding would rewrite it.
  protected onCode(value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, EMAIL_VERIFICATION_CODE_LENGTH);
    this.verification.code.set(digits);
    if (digits === value) return;
    this.codeInput().value.set(digits);
    const field = this.host.querySelector<HTMLInputElement>('[data-testid="account-email-code-input"] input');
    if (field) field.value = digits;
  }
}
