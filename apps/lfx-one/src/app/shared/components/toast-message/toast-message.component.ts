// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import type { ToastMessageOptions } from 'primeng/api';

@Component({
  selector: 'lfx-toast-message',
  templateUrl: './toast-message.component.html',
  styleUrl: './toast-message.component.scss',
})
export class ToastMessageComponent {
  public readonly message = input.required<ToastMessageOptions>();
}
