// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import {
  MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES,
  MKTG_FAMILY_PRINT_COPY,
  MKTG_FAMILY_PRINT_LABELS,
  MKTG_FAMILY_PRINT_RUN_BLOCK_LAYOUT,
  MKTG_FAMILY_PRINT_WARN_INK,
  MKTG_PORTRAIT_COLUMNS,
  MKTG_PORTRAIT_PAGE,
} from '@lfx-one/shared/constants';
import { BoilerplatesLengthRow, MktgFamilyPrintBoilerplateCard, MktgFamilyPrintFitRows } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintCutNote, mktgFamilyPrintFill, mktgFamilyPrintFitRunBlock, mktgFamilyPrintSourceLabel } from '@lfx-one/shared/utils';
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
  host: { '[style.--fp-warn]': 'warnInk' },
})
export class MktgFamilyPrintBoilerplatesPageComponent {
  public readonly lengths = input.required<BoilerplatesLengthRow[]>();
  /** The sources the run read; [] omits the block. */
  public readonly sources = input<string[]>([]);

  public readonly labels = MKTG_FAMILY_PRINT_LABELS;
  public readonly intro = MKTG_FAMILY_PRINT_COPY.boilerplatesIntro;
  public readonly geometry = MKTG_PORTRAIT_PAGE;
  public readonly columns = MKTG_PORTRAIT_COLUMNS;
  public readonly column: readonly [number, number] = [MKTG_PORTRAIT_PAGE.margin, MKTG_PORTRAIT_PAGE.contentWidth];
  public readonly warnInk = MKTG_FAMILY_PRINT_WARN_INK;

  public readonly runLayout = MKTG_FAMILY_PRINT_RUN_BLOCK_LAYOUT;

  public readonly cards: Signal<MktgFamilyPrintBoilerplateCard[]> = this.initCards();
  /** The sources the page prints, each as its short readable name once, as many as fit the block, the rest counted; no rows omits the block. */
  public readonly shownSources: Signal<MktgFamilyPrintFitRows<string>> = this.initShownSources();
  /** The Built from block's cut note (`+2 more in LFX One`); '' when every source printed. */
  public readonly sourcesCutNote: Signal<string> = computed(() => mktgFamilyPrintCutNote(this.shownSources().cut));

  private initShownSources(): Signal<MktgFamilyPrintFitRows<string>> {
    return computed(() => mktgFamilyPrintFitRunBlock(this.sources().map(mktgFamilyPrintSourceLabel), MKTG_PORTRAIT_COLUMNS.half));
  }

  private initCards(): Signal<MktgFamilyPrintBoilerplateCard[]> {
    return computed(() =>
      this.lengths()
        .filter((row) => row.text.trim())
        .map((row, index) => {
          const size = MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES[Math.min(index, MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES.length - 1)];
          const percent = row.max > 0 ? Math.round((row.words / row.max) * 100) : 0;
          return {
            label: row.label,
            text: row.text,
            count: row.max > 0 ? mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.words, { Words: row.words, Max: row.max }) : `${row.words} words`,
            fill: Math.min(100, percent),
            percentLabel: row.max > 0 ? mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.ofTheLimit, { Percent: percent }) : '',
            overLabel: row.over ? mktgFamilyPrintFill(MKTG_FAMILY_PRINT_COPY.overBy, { Over: row.words - row.max }) : '',
            fontSize: size.fontSize,
            minHeight: size.minHeight,
          };
        })
    );
  }
}
