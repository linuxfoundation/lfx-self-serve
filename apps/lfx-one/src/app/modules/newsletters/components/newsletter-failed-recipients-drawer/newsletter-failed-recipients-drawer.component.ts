// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, model, PLATFORM_ID, Signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';

@Component({
  selector: 'lfx-newsletter-failed-recipients-drawer',
  imports: [DrawerModule, ButtonComponent, InputTextComponent],
  templateUrl: './newsletter-failed-recipients-drawer.component.html',
})
export class NewsletterFailedRecipientsDrawerComponent {
  // === Services ===
  private readonly platformId = inject(PLATFORM_ID);
  private readonly messageService = inject(MessageService);

  // === Inputs ===
  public readonly failedRecipients = input<string[]>([]);
  public readonly failedCount = input<number>(0);

  // === Model Signals (two-way) ===
  public readonly visible = model<boolean>(false);

  // === Forms ===
  protected readonly searchForm = new FormGroup({ search: new FormControl('') });

  // === Computed (complex bodies extracted to private init* methods) ===
  private readonly searchTerm = toSignal(this.searchForm.controls.search.valueChanges, { initialValue: '' });
  protected readonly filteredRecipients: Signal<string[]> = this.initFilteredRecipients();

  public onClose(): void {
    this.visible.set(false);
  }

  protected copyAll(): void {
    // Clipboard is browser-only — guard so SSR never touches `navigator`.
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const emails = this.failedRecipients();
    if (!emails.length) {
      return;
    }

    navigator.clipboard
      .writeText(emails.join('\n'))
      .then(() => {
        this.messageService.add({
          severity: 'success',
          summary: 'Copied',
          detail: `${emails.length} email${emails.length === 1 ? '' : 's'} copied to clipboard.`,
        });
      })
      .catch(() => {
        this.messageService.add({
          severity: 'error',
          summary: 'Copy failed',
          detail: 'Could not copy emails to the clipboard.',
        });
      });
  }

  private initFilteredRecipients(): Signal<string[]> {
    return computed(() => {
      const term = (this.searchTerm() ?? '').trim().toLowerCase();
      const emails = this.failedRecipients();
      if (!term) {
        return emails;
      }
      return emails.filter((email) => email.toLowerCase().includes(term));
    });
  }
}
