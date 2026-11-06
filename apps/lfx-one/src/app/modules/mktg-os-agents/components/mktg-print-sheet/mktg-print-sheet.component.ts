// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';

/**
 * One sheet of a Marketing OS print: a table whose head and foot groups repeat
 * the page's top and bottom room on every page the projected section runs to.
 * The pages print with no `@page` margin, which keeps the browser's header and
 * footer off the PDF (it draws them only in the margin area:
 * `MKTG_PRINT_PAGE_SETUPS`), so the room lives in the document instead. The
 * sides are the print root's padding (`.lfx-framework-print`); the kit's
 * chapter tables carry their own head, with the same room in their stylesheet.
 */
@Component({
  selector: 'lfx-mktg-print-sheet',
  templateUrl: './mktg-print-sheet.component.html',
  styleUrl: './mktg-print-sheet.component.scss',
  host: { class: 'block' },
})
export class MktgPrintSheetComponent {}
