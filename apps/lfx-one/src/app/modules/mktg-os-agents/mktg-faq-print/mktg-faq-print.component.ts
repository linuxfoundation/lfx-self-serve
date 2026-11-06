// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import {
  MKTG_FAQ_PRINT_UNANSWERED,
  MKTG_PRINT_APPENDIX_LAYOUT,
  MKTG_PRINT_LANDSCAPE_CLASS,
  MKTG_PRINT_SECTION_TITLES,
  MKTG_PRINT_SOURCE_LEAD,
} from '@lfx-one/shared/constants';
import { FaqPrintView, MktgFaqPrintPage } from '@lfx-one/shared/interfaces';
import { mktgPagePt, mktgPrintPageChrome, mktgPrintPageLook, mktgPrintPageNumber, paginateFaqPairs } from '@lfx-one/shared/utils';
import { MktgPrintPageComponent } from '../components/mktg-print-page/mktg-print-page.component';

/**
 * The FAQ as the family deck prints it: pages of a two-column grid, the
 * question bold over its answer (the agent's restricted Markdown through the
 * shared renderer, so a list prints real bullets), the pairs flowing row by
 * row, paginated in TypeScript from the data by the shell's measure (as many
 * rows to a page as fit at 100, 95 or 90 % of the sizes, as the Slides
 * exporter paginates), one landscape page per page of the grid.
 */
@Component({
  selector: 'lfx-mktg-faq-print',
  imports: [MarkdownRendererComponent, MktgPrintPageComponent],
  templateUrl: './mktg-faq-print.component.html',
  styleUrl: './mktg-faq-print.component.scss',
  host: { class: `block ${MKTG_PRINT_LANDSCAPE_CLASS}` },
})
export class MktgFaqPrintComponent {
  public readonly view = input.required<FaqPrintView>();
  /** The part's two-digit number in the family order. */
  public readonly number = input.required<string>();
  public readonly projectName = input.required<string>();
  public readonly familyName = input.required<string>();
  /** The deck-wide number of the first grid page. */
  public readonly firstPage = input(1);
  protected readonly unansweredLabel = MKTG_FAQ_PRINT_UNANSWERED;
  protected readonly sourceLead = MKTG_PRINT_SOURCE_LEAD;
  /** The deck's gaps between an answer's paragraphs, as shares of the answer size (em), as the pagination measured them. */
  protected readonly bulletGap = `${MKTG_PRINT_APPENDIX_LAYOUT.faqBulletGapEm}em`;
  protected readonly plainAfterBulletGap = `${MKTG_PRINT_APPENDIX_LAYOUT.faqPlainAfterBulletEm}em`;
  protected readonly bulletAfterPlainGap = `${MKTG_PRINT_APPENDIX_LAYOUT.faqBulletAfterPlainEm}em`;
  protected readonly chrome = computed(() => mktgPrintPageChrome(this.projectName(), this.familyName(), this.number(), MKTG_PRINT_SECTION_TITLES.faq));
  protected readonly look = computed(() => mktgPrintPageLook(this.view().brand));
  protected readonly pages = computed<MktgFaqPrintPage[]>(() =>
    paginateFaqPairs(this.view().groups).map((page, index) => ({
      ...page,
      number: mktgPrintPageNumber(this.firstPage() + index),
      rowsTemplate: page.rows.map((row) => `minmax(${mktgPagePt(row.height)}, auto)`).join(' '),
      sourceSizePt: mktgPagePt(page.sourceSize),
      rows: page.rows.map((row) => ({
        entries: row.entries.map((entry) => ({ ...entry, questionSizePt: mktgPagePt(entry.questionSize), answerSizePt: mktgPagePt(entry.answerSize) })),
      })),
    }))
  );
}
