// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

/**
 * One row of an `lfx-mktg-print-sheet`: one block of the print, kept whole
 * across a page break, so the break falls between blocks in Chromium and
 * WebKit alike. The projected block keeps its own layout inside the row's
 * cell. A block that may run longer than a page (the framework's goals table,
 * which breaks between its own row pairs) sets `flows`, and the row lets the
 * block's own break rules decide.
 */
@Component({
  selector: 'lfx-mktg-print-sheet-row',
  templateUrl: './mktg-print-sheet-row.component.html',
  styleUrl: './mktg-print-sheet-row.component.scss',
  host: { class: 'lfx-print-sheet-row', '[class.lfx-print-sheet-row-flows]': 'flows()' },
})
export class MktgPrintSheetRowComponent {
  public readonly flows = input(false);
}
