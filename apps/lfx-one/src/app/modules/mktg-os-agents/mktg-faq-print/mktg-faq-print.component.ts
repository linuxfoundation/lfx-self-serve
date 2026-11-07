// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { MKTG_FAQ_PRINT_UNANSWERED } from '@lfx-one/shared/constants';
import { FaqPrintView } from '@lfx-one/shared/interfaces';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MktgPrintRunningHeadComponent } from '../components/mktg-print-running-head/mktg-print-running-head.component';
import { MktgPrintChapterHeaderComponent } from '../components/mktg-print-chapter-header/mktg-print-chapter-header.component';
import { MktgPrintSheetComponent } from '../components/mktg-print-sheet/mktg-print-sheet.component';
import { MktgPrintSheetRowComponent } from '../components/mktg-print-sheet-row/mktg-print-sheet-row.component';

@Component({
  selector: 'lfx-mktg-faq-print',
  imports: [
    NgTemplateOutlet,
    MarkdownRendererComponent,
    MktgPrintRunningHeadComponent,
    MktgPrintChapterHeaderComponent,
    MktgPrintSheetComponent,
    MktgPrintSheetRowComponent,
  ],
  templateUrl: './mktg-faq-print.component.html',
  styleUrl: '../mktg-flow-print/mktg-flow-print.scss',
})
export class MktgFaqPrintComponent {
  public readonly view = input.required<FaqPrintView>();
  public readonly number = input.required<string>();
  public readonly projectName = input.required<string>();
  protected readonly unansweredLabel = MKTG_FAQ_PRINT_UNANSWERED;
}
