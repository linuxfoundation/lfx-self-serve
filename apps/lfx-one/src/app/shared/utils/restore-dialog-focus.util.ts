// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

/**
 * Hands focus back to what opened a DynamicDialog once the dialog is gone (WCAG 2.4.3, #3260).
 *
 * PrimeNG 20.4's dialog traps focus while open and focuses its content on show, but does not restore
 * focus on close: it is left on `<body>`. Capture the trigger (`document.activeElement`) before
 * `DialogService.open` and pass it here with the returned ref. Focus returns on the ref's `onDestroy`,
 * after the dialog has left the DOM, and only while the trigger is still on the page: a dialog whose
 * outcome replaced its trigger (e.g. a completed registration) leaves focus where the page put it.
 */
export function restoreFocusOnDialogClose(ref: DynamicDialogRef | null | undefined, trigger: Element | null | undefined): void {
  if (!ref || !(trigger instanceof HTMLElement)) {
    return;
  }
  ref.onDestroy.pipe(take(1)).subscribe(() => {
    if (trigger.isConnected) {
      trigger.focus();
    }
  });
}
