// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, formatDate, isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { MktgActiveRunGuardOptions } from '@lfx-one/shared/interfaces';
import { mktgActiveRunConflictHeading } from '@lfx-one/shared/utils/mktg-run-active.utils';
import { Confirmation, ConfirmationService, ConfirmEventType, MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';
import { watchMktgActiveRun } from '../utils/mktg-active-run-recheck.util';

/** One dialog/recheck policy for catalog and dedicated one-off starts. */
@Injectable({ providedIn: 'root' })
export class MktgActiveRunGuardService {
  private readonly doc = inject(DOCUMENT);
  private readonly platform = inject(PLATFORM_ID);
  private readonly messages = inject(MessageService);
  private readonly watches = new WeakMap<ConfirmationService, Subscription>();

  public open<T>(confirmation: ConfirmationService, options: MktgActiveRunGuardOptions<T>, destroyRef: DestroyRef, key?: string): void {
    if (!isPlatformBrowser(this.platform) || !options.current()) return;
    this.watches.get(confirmation)?.unsubscribe();
    const watch = new Subscription();
    this.watches.set(confirmation, watch);
    let conflict = options.conflict;
    let decided = false;
    let checking = true;
    const dialog: Confirmation = {
      key,
      header: 'Checking the active run…',
      message: 'Checking its latest state before you choose.',
      acceptLabel: 'Discard and start over',
      rejectLabel: 'Open it',
      acceptButtonProps: { disabled: true },
      rejectButtonProps: { text: true, disabled: true },
      closable: false,
      closeOnEscape: false,
      accept: () => {
        if (decided || checking || !options.current()) return;
        decided = true;
        watch.unsubscribe();
        options.onDiscard(conflict);
      },
      reject: (reason: ConfirmEventType) => {
        if (decided || checking || !options.current()) return;
        decided = true;
        watch.unsubscribe();
        if (reason === ConfirmEventType.REJECT) options.onOpen(conflict);
      },
    };
    // Re-emitting this same object updates an already-visible PrimeNG dialog; never close/remount it for a fresh 409.
    confirmation.confirm(dialog);
    watch.add(
      watchMktgActiveRun(this.doc, options)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe((event) => {
          if (!options.current()) return;
          if (event.type === 'checking') {
            checking = true;
          } else if (event.type === 'conflict') {
            checking = false;
            conflict = event.conflict;
            dialog.header = mktgActiveRunConflictHeading(conflict);
            dialog.message = `Started ${formatDate(conflict.startedAt, 'd MMM y, HH:mm', 'en-US')}. Its questions and progress will be lost.`;
          } else if (event.type === 'accepted') {
            decided = true;
            confirmation.close();
            this.messages.add({ severity: 'info', detail: 'The earlier run has finished — yours started.' });
            return;
          } else if (event.type === 'value') {
            options.onValue(event.value);
            return;
          } else {
            decided = true;
            confirmation.close();
            options.onError(event.error);
            return;
          }
          dialog.acceptButtonProps = { disabled: checking };
          dialog.rejectButtonProps = { text: true, disabled: checking };
          dialog.closable = !checking;
          dialog.closeOnEscape = !checking;
          confirmation.confirm(dialog);
        })
    );
  }
}
