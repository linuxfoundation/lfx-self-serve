// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { EMAIL_LINKED_SUPPORT_TOAST_KEY } from '@lfx-one/shared/constants';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { ToastModule } from 'primeng/toast';

import { ToastMessageComponent } from '../toast-message/toast-message.component';

/**
 * The sticky "email already linked" notice with its Contact support action, raised by ProfileAuthReturnService on an
 * email-verification return. Rendered by each shell that provides that service.
 */
@Component({
  selector: 'lfx-linked-email-support-toast',
  imports: [ToastModule, ToastMessageComponent, OpenIntercomDirective],
  templateUrl: './linked-email-support-toast.component.html',
})
export class LinkedEmailSupportToastComponent {
  protected readonly toastKey = EMAIL_LINKED_SUPPORT_TOAST_KEY;
}
