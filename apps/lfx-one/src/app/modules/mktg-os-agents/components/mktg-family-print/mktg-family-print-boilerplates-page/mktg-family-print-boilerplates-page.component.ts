// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import {
  MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES,
  MKTG_FAMILY_PRINT_COPY,
  MKTG_FAMILY_PRINT_LABELS,
  MKTG_FAMILY_PRINT_WARN_INK,
  MKTG_PORTRAIT_COLUMNS,
  MKTG_PORTRAIT_PAGE,
} from '@lfx-one/shared/constants';
import { BoilerplatesLengthRow, MktgFamilyPrintBoilerplateCard } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintFill } from '@lfx-one/shared/utils';
import { MktgPortraitRectDirective } from '../../mktg-portrait/mktg-portrait-rect.directive';

/**
 * The boilerplates as the family book prints them: one card per approved
 * length, longest last, each with its label, word count against the limit
 * and a fill bar; under them the run's notes and the sources it read, both
 * or neither (the cards keep the page). A length with no text is not a card.
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
  /** The run's notes, one line each; [] omits the block. */
  public readonly notes = input<string[]>([]);
  /** The sources the run read; [] omits the block. */
  public readonly sources = input<string[]>([]);

  public readonly labels = MKTG_FAMILY_PRINT_LABELS;
  public readonly intro = MKTG_FAMILY_PRINT_COPY.boilerplatesIntro;
  public readonly geometry = MKTG_PORTRAIT_PAGE;
  public readonly columns = MKTG_PORTRAIT_COLUMNS;
  public readonly column: readonly [number, number] = [MKTG_PORTRAIT_PAGE.margin, MKTG_PORTRAIT_PAGE.contentWidth];
  public readonly warnInk = MKTG_FAMILY_PRINT_WARN_INK;

  public readonly cards: Signal<MktgFamilyPrintBoilerplateCard[]> = this.initCards();
  /** Both run blocks print, or neither: a record with only one of them prints the cards alone. */
  public readonly runBlocks: Signal<boolean> = this.initRunBlocks();

  private initRunBlocks(): Signal<boolean> {
    return computed(() => this.notes().length > 0 && this.sources().length > 0);
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
            percent,
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
