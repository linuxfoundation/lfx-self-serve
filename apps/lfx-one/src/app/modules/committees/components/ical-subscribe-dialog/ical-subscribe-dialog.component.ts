// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { IcalSubscribeDialogData } from '@lfx-one/shared/interfaces';
import { getCalendarSubscribeUrls } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';

const COPIED_STATE_RESET_MS = 2000;

@Component({
  selector: 'lfx-ical-subscribe-dialog',
  imports: [ButtonComponent],
  templateUrl: './ical-subscribe-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IcalSubscribeDialogComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly messageService = inject(MessageService);
  private readonly dialogConfig = inject<DynamicDialogConfig<IcalSubscribeDialogData>>(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);

  public readonly feedUrl = this.dialogConfig.data?.feedUrl ?? '';
  public readonly name = this.dialogConfig.data?.name ?? 'Calendar';

  private readonly urls = this.feedUrl ? getCalendarSubscribeUrls(this.feedUrl, this.name) : null;
  public readonly googleCalendarUrl = this.urls?.google ?? '';
  public readonly outlookLiveUrl = this.urls?.outlookLive ?? '';
  public readonly outlook365Url = this.urls?.outlook365 ?? '';
  public readonly webcalUrl = this.urls?.apple ?? '';

  public copied = signal(false);

  private copiedResetTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.copiedResetTimer !== null) {
        clearTimeout(this.copiedResetTimer);
      }
    });
  }

  public copyFeedUrl(): void {
    const success = this.clipboard.copy(this.feedUrl);
    if (success) {
      this.copied.set(true);
      this.messageService.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'Calendar feed URL copied to clipboard',
      });
      if (this.copiedResetTimer !== null) {
        clearTimeout(this.copiedResetTimer);
      }
      this.copiedResetTimer = setTimeout(() => {
        this.copied.set(false);
        this.copiedResetTimer = null;
      }, COPIED_STATE_RESET_MS);
    } else {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to copy URL to clipboard',
      });
    }
  }
}
