// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import {
  MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES,
  MKTG_FAMILY_PRINT_BOILERPLATE_CARDS_LAYOUT,
  MKTG_FAMILY_PRINT_COPY,
  MKTG_FAMILY_PRINT_LABELS,
  MKTG_FAMILY_PRINT_RUN_BLOCK_LAYOUT,
  MKTG_FAMILY_PRINT_WARN_INK,
  MKTG_PORTRAIT_COLUMNS,
  MKTG_PORTRAIT_PAGE,
} from '@lfx-one/shared/constants';
import { BoilerplatesLengthRow, MktgFamilyPrintBoilerplateCard, MktgFamilyPrintFitRows } from '@lfx-one/shared/interfaces';
import {
  mktgFamilyPrintCutNote,
  mktgFamilyPrintFill,
  mktgFamilyPrintFitBoilerplateCards,
  mktgFamilyPrintFitRunBlock,
  mktgFamilyPrintBuiltFromLabel,
} from '@lfx-one/shared/utils';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../mktg-portrait/mktg-portrait-host';
import { MktgPortraitRectDirective } from '../../mktg-portrait/mktg-portrait-rect.directive';

/**
 * The boilerplates as the family book prints them: one card per approved
 * length, longest last, each with its label, word count against the limit
 * and a fill bar; under them what the run was built from, each source as a
 * short readable name (a URL by its label or host, no internal id), the
 * whole rows that fit above the footer; the run's notes do not print (the
 * editor's round of 7 Nov 2026). A length with no text is not a card.
 */
@Component({
  selector: 'lfx-mktg-family-print-boilerplates-page',
  imports: [MktgPortraitRectDirective],
  templateUrl: './mktg-family-print-boilerplates-page.component.html',
  styleUrl: './mktg-family-print-boilerplates-page.component.scss',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
  host: { '[style.--fp-warn]': 'warnInk' },
})
export class MktgFamilyPrintBoilerplatesPageComponent {
  public readonly lengths = input.required<BoilerplatesLengthRow[]>();
  /** The sources the run read; [] omits the block. */
  public readonly sources = input<string[]>([]);
  /** The book's font stack (the look's), so the cards' texts are measured in the face they are set in; '' measures in the sans table. */
  public readonly fontStack = input<string>('');

  public readonly labels = MKTG_FAMILY_PRINT_LABELS;
  public readonly intro = MKTG_FAMILY_PRINT_COPY.boilerplatesIntro;
  public readonly geometry = MKTG_PORTRAIT_PAGE;
  public readonly columns = MKTG_PORTRAIT_COLUMNS;
  public readonly column: readonly [number, number] = [MKTG_PORTRAIT_PAGE.margin, MKTG_PORTRAIT_PAGE.contentWidth];
  public readonly warnInk = MKTG_FAMILY_PRINT_WARN_INK;

  public readonly cardsLayout = MKTG_FAMILY_PRINT_BOILERPLATE_CARDS_LAYOUT;
  public readonly runLayout = MKTG_FAMILY_PRINT_RUN_BLOCK_LAYOUT;

  public readonly cards: Signal<MktgFamilyPrintBoilerplateCard[]> = this.initCards();
  /** The sources the page prints, each in plain words once (label and host, no slug, no run term), as many as fit the block, the rest counted; no rows omits the block. */
  public readonly shownSources: Signal<MktgFamilyPrintFitRows<string>> = this.initShownSources();
  /** The Built from block's cut note (`+2 more in LFX One`); '' when every source printed. */
  public readonly sourcesCutNote: Signal<string> = computed(() => mktgFamilyPrintCutNote(this.shownSources().cut));

  private initShownSources(): Signal<MktgFamilyPrintFitRows<string>> {
    return computed(() => mktgFamilyPrintFitRunBlock(this.sources().map(mktgFamilyPrintBuiltFromLabel), MKTG_PORTRAIT_COLUMNS.half));
  }

  private initCards(): Signal<MktgFamilyPrintBoilerplateCard[]> {
    return computed(() => {
      const rows = this.lengths().filter((row) => row.text.trim());
      // Each card's size is its length's contract slot (`row.index`, the one-liner first), not its position among the rows that have
      // text, so a length the record left empty does not hand its size to the next; the fitted and returned arrays stay by position.
      const sizes = rows.map((row) => MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES[Math.min(row.index, MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES.length - 1)]);
      // The texts held to the page's room, measured in the book's face: a text that fits prints whole; one that outgrows it is cut from the end at a sentence and says so.
      const fitted = mktgFamilyPrintFitBoilerplateCards(
        rows.map((row, index) => ({ text: row.text, ...sizes[index] })),
        MKTG_PORTRAIT_PAGE.contentWidth,
        MKTG_FAMILY_PRINT_BOILERPLATE_CARDS_LAYOUT,
        this.fontStack()
      );
      return rows.map((row, index) => {
        const size = sizes[index];
        const percent = row.max > 0 ? Math.round((row.words / row.max) * 100) : 0;
        return {
          label: row.label,
          text: fitted[index].text,
          cutNote: fitted[index].cutWords > 0 ? mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.cutWords, { Count: fitted[index].cutWords }) : '',
          count: row.max > 0 ? mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.words, { Words: row.words, Max: row.max }) : `${row.words} words`,
          fill: Math.min(100, percent),
          percentLabel: row.max > 0 ? mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.ofTheLimit, { Percent: percent }) : '',
          overLabel: row.over ? mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.overBy, { Over: row.words - row.max }) : '',
          fontSize: size.fontSize,
          minHeight: size.minHeight,
        };
      });
    });
  }
}
