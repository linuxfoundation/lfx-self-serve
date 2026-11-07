// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { BoilerplatesPrintView } from '@lfx-one/shared/interfaces';
import { MktgPrintRunningHeadComponent } from '../components/mktg-print-running-head/mktg-print-running-head.component';
import { MktgPrintChapterHeaderComponent } from '../components/mktg-print-chapter-header/mktg-print-chapter-header.component';
import { MktgPrintSheetComponent } from '../components/mktg-print-sheet/mktg-print-sheet.component';
import { MktgPrintSheetRowComponent } from '../components/mktg-print-sheet-row/mktg-print-sheet-row.component';

@Component({
  selector: 'lfx-mktg-boilerplates-print',
  imports: [NgTemplateOutlet, MktgPrintRunningHeadComponent, MktgPrintChapterHeaderComponent, MktgPrintSheetComponent, MktgPrintSheetRowComponent],
  templateUrl: './mktg-boilerplates-print.component.html',
  // Shared brand typography and exact print colour handling, not a second style path.
  styleUrl: '../mktg-flow-print/mktg-flow-print.scss',
})
export class MktgBoilerplatesPrintComponent {
  public readonly view = input.required<BoilerplatesPrintView>();
  public readonly number = input.required<string>();
  public readonly projectName = input.required<string>();
}
