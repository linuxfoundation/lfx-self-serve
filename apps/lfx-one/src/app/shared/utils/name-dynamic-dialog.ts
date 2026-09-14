// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Names a headless DynamicDialog from its body's heading.
 *
 * `DynamicDialogConfig.ariaLabelledBy` is inert in PrimeNG 20.4.0 — the config field is never
 * bound onto `<p-dialog>`. The host `pt` input is: DynamicDialog forwards `[pt]="ptm('pcDialog')"`
 * and Dialog's root `pBind` writes those attributes onto the `role="dialog"` node.
 */
export function nameDynamicDialog(dialogService: DialogService, ref: DynamicDialogRef, labelledBy: string): void {
  const host = dialogService.dialogComponentRefMap.get(ref);
  host?.setInput('pt', { pcDialog: { root: { 'aria-labelledby': labelledBy } } });
  host?.changeDetectorRef.detectChanges();
}
