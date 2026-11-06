// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MKTG_PRINT_APPENDIX_LAYOUT, MKTG_PRINT_LANDSCAPE_CLASS, MKTG_PRINT_SECTION_TITLES } from '@lfx-one/shared/constants';
import { BoilerplatesPrintView, MktgBoilerplatesPrintPage } from '@lfx-one/shared/interfaces';
import { mktgPagePt, mktgPrintPageChrome, mktgPrintPageLook, mktgPrintPageNumber, paginateBoilerplateCards } from '@lfx-one/shared/utils';
import { MktgPrintPageComponent } from '../components/mktg-print-page/mktg-print-page.component';

/**
 * The boilerplates as the family deck prints them: pages of two-column
 * bordered cards, each headed "LABEL · N WORDS", paginated in TypeScript
 * from the data (so many rows to a page by the shell's measure, as the
 * Slides exporter paginates), one landscape page per page of cards.
 */
@Component({
  selector: 'lfx-mktg-boilerplates-print',
  imports: [MktgPrintPageComponent],
  templateUrl: './mktg-boilerplates-print.component.html',
  styleUrl: './mktg-boilerplates-print.component.scss',
  host: { class: `block ${MKTG_PRINT_LANDSCAPE_CLASS}` },
})
export class MktgBoilerplatesPrintComponent {
  public readonly view = input.required<BoilerplatesPrintView>();
  /** The part's two-digit number in the family order. */
  public readonly number = input.required<string>();
  public readonly projectName = input.required<string>();
  public readonly familyName = input.required<string>();
  /** The deck-wide number of the first card page. */
  public readonly firstPage = input(1);
  /** The label's tracking, as the pagination models it. */
  protected readonly headTracking = `${MKTG_PRINT_APPENDIX_LAYOUT.cardLabelTracking}em`;
  protected readonly chrome = computed(() => mktgPrintPageChrome(this.projectName(), this.familyName(), this.number(), MKTG_PRINT_SECTION_TITLES.boilerplates));
  protected readonly look = computed(() => mktgPrintPageLook(this.view().brand));
  protected readonly pages = computed<MktgBoilerplatesPrintPage[]>(() =>
    paginateBoilerplateCards(this.view().lengths).map((page, index) => ({
      ...page,
      number: mktgPrintPageNumber(this.firstPage() + index),
      rowsTemplate: page.rows.map((row) => `minmax(${mktgPagePt(row.height)}, auto)`).join(' '),
      rows: page.rows.map((row) => ({ cards: row.cards.map((card) => ({ ...card, bodySize: mktgPagePt(card.size) })) })),
    }))
  );
}
