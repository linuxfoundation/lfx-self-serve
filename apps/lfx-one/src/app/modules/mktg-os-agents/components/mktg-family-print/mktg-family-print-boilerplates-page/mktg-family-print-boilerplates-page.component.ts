// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { MKTG_FAMILY_PRINT_BOILERPLATE_CARD_SIZES, MKTG_FAMILY_PRINT_COPY, MKTG_FAMILY_PRINT_LABELS } from '@lfx-one/shared/constants';
import { BoilerplatesLengthRow, MktgFamilyPrintBoilerplateCard } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintFill } from '@lfx-one/shared/utils';

/**
 * The boilerplates as the family book prints them: one card per approved
 * length, longest last, each with its label, word count against the limit
 * and a fill bar; under them the run's notes and the sources it read, when
 * the revision carries them. A length with no text is not a card.
 */
@Component({
  selector: 'lfx-mktg-family-print-boilerplates-page',
  templateUrl: './mktg-family-print-boilerplates-page.component.html',
  styleUrl: './mktg-family-print-boilerplates-page.component.scss',
})
export class MktgFamilyPrintBoilerplatesPageComponent {
  public readonly lengths = input.required<BoilerplatesLengthRow[]>();
  /** The run's notes, one line each; [] omits the block. */
  public readonly notes = input<string[]>([]);
  /** The sources the run read; [] omits the block. */
  public readonly sources = input<string[]>([]);

  public readonly labels = MKTG_FAMILY_PRINT_LABELS;
  public readonly intro = MKTG_FAMILY_PRINT_COPY.boilerplatesIntro;

  public readonly cards: Signal<MktgFamilyPrintBoilerplateCard[]> = this.initCards();

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
