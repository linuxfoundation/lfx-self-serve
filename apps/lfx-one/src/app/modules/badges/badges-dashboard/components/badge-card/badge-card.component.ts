// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { EnrichedBadge } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'lfx-badge-card',
  imports: [CardComponent, DatePipe],
  templateUrl: './badge-card.component.html',
  styleUrl: './badge-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BadgeCardComponent {
  // === Services ===
  private readonly messageService = inject(MessageService);

  // === Inputs ===
  public readonly badge = input.required<EnrichedBadge>();

  protected async shareBadge(shareUrl: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy not supported',
        detail: 'Clipboard access is unavailable in this browser.',
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      this.messageService.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'Badge URL copied to clipboard',
      });
    } catch (error) {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy failed',
        detail: 'Unable to copy link to clipboard',
        data: error,
      });
    }
  }
}
