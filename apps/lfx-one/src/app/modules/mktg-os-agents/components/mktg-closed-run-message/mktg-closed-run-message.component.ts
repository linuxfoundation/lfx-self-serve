// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DATE_PIPE_DEFAULT_OPTIONS, formatDate } from '@angular/common';
import { Component, computed, inject, input, LOCALE_ID, Signal } from '@angular/core';
import type { MktgDocumentRunProgress } from '@lfx-one/shared/interfaces';

/** One server-fact-only closure sentence for document and run pages. */
@Component({
  selector: 'lfx-mktg-closed-run-message',
  templateUrl: './mktg-closed-run-message.component.html',
})
export class MktgClosedRunMessageComponent {
  private readonly locale = inject(LOCALE_ID);
  private readonly dateOptions = inject(DATE_PIPE_DEFAULT_OPTIONS, { optional: true });

  public readonly run = input.required<MktgDocumentRunProgress>();
  public readonly messageTestId = input('mktg-run-progress-closed-message');
  protected readonly message: Signal<string> = this.initMessage();

  private initMessage(): Signal<string> {
    return computed(() => {
      const run = this.run();
      if (run.state === 'superseded') return 'A newer run replaced this one.';
      let text = 'This run was discarded';
      if (run.closedBy) text += ` by ${run.closedBy}`;
      if (run.closedAt) text += ` at ${formatDate(run.closedAt, 'd MMM y, HH:mm', this.locale, this.dateOptions?.timezone)}`;
      return text + (run.replacedBy ? '; a newer run was started.' : '.');
    });
  }
}
