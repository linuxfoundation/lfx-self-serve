// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';

@Component({
  selector: 'lfx-newsletter-send-step',
  imports: [ButtonComponent],
  templateUrl: './newsletter-send-step.component.html',
})
export class NewsletterSendStepComponent {
  public readonly subject = input<string>('');
  public readonly recipientCount = input<number | null>(null);
  public readonly committeeCount = input<number>(0);
  public readonly edName = input<string>('');
  public readonly displayName = input<string>('');
  public readonly edReplyEmail = input<string>('');
  public readonly edEmail = input<string>('');
  public readonly canSend = input<boolean>(false);
  public readonly sending = input<boolean>(false);
  public readonly canSendTest = input<boolean>(false);
  public readonly testSending = input<boolean>(false);

  public readonly send = output<void>();
  public readonly sendTest = output<void>();
}
