// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { Component, computed, inject, input, model, Signal } from '@angular/core';
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
  private readonly clipboard = inject(Clipboard);
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
    const emails = this.failedRecipients();
    if (!emails.length) {
      return;
    }

    // Angular CDK's Clipboard is SSR-safe and feature-detects support, returning
    // false (instead of throwing) when the platform can't copy — e.g. an insecure
    // context or an older browser without the async clipboard API.
    if (this.clipboard.copy(emails.join('\n'))) {
      this.messageService.add({
        severity: 'success',
        summary: 'Copied',
        detail: `${emails.length} email${emails.length === 1 ? '' : 's'} copied to clipboard.`,
      });
      return;
    }

    this.messageService.add({
      severity: 'warn',
      summary: 'Copy unavailable',
      detail: 'Could not copy emails. Please copy them manually.',
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
