// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

/**
 * Clipboard sharing utility — copies a URL to the clipboard and shows toast feedback.
 * Centralizes the copy-link+toast pattern used across multiple components.
 */
@Injectable({ providedIn: 'root' })
export class ClipboardShareService {
  private readonly clipboard = inject(Clipboard);
  private readonly messageService = inject(MessageService);

  /**
   * Copy a URL to the clipboard and display success/error toast feedback.
   * @param url The URL to copy
   * @param detail Optional custom detail text for the success toast (default: "Link copied to clipboard.")
   */
  public copyLink(url: string, detail: string = 'Link copied to clipboard.'): void {
    if (!url) {
      this.messageService.add({
        severity: 'warn',
        summary: 'No Link',
        detail: 'No link available to copy.',
      });
      return;
    }

    const success = this.clipboard.copy(url);
    if (success) {
      this.messageService.add({
        severity: 'success',
        summary: 'Link Copied',
        detail,
      });
    } else {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy Failed',
        detail: 'Failed to copy link. Please try again.',
      });
    }
  }
}
