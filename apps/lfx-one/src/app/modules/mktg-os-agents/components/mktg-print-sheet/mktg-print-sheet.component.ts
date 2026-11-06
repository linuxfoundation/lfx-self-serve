// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, input, TemplateRef } from '@angular/core';

/**
 * One sheet of a Marketing OS print: a CSS table whose head group repeats the
 * page's top room on every page, whose last row carries the bottom room once
 * (a repeating footer group makes Chromium emit an empty page per table), and
 * whose body holds the projected `lfx-mktg-print-sheet-row`s, one per block,
 * so a page break falls only between blocks in Chromium and WebKit alike
 * (WebKit pushes a row whole and never splits it), as the kit's chapter
 * tables paginate. In Chromium the pages print with no `@page` margin, which
 * keeps the browser's header and footer off the PDF (it draws them only in
 * the margin area: `MKTG_PRINT_PAGE_SETUPS`), so the room lives in the
 * document instead; in WebKit, which prints a table's head once, the pages
 * keep their margins and this room collapses (`MKTG_PRINT_PAGE_MARGINS_CLASS`).
 * The sides are the print root's padding (`.lfx-framework-print`); the kit's
 * chapter tables carry their own head, with the same room in their stylesheet.
 * A caller whose print runs over several pages in one flowing row (the AEO/GEO
 * report) gives `head` a template, and the head group repeats it under the
 * room on every page Chromium prints (a running head), once in WebKit.
 */
@Component({
  selector: 'lfx-mktg-print-sheet',
  imports: [NgTemplateOutlet],
  templateUrl: './mktg-print-sheet.component.html',
  styleUrl: './mktg-print-sheet.component.scss',
  host: { class: 'lfx-print-sheet' },
})
export class MktgPrintSheetComponent {
  /** An optional row of the head group, under the room: the print's running head, repeated per page by Chromium. */
  public readonly head = input<TemplateRef<unknown> | null>(null);
}
