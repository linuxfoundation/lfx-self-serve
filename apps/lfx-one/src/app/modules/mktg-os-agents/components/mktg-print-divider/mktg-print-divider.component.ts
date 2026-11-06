// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MKTG_PRINT_DIVIDER_NOUNS, MKTG_PRINT_LANDSCAPE_CLASS } from '@lfx-one/shared/constants';
import { MktgPrintBrand } from '@lfx-one/shared/interfaces';
import { mktgPrintDivider, mktgPrintDividerPage, mktgPrintPageLook } from '@lfx-one/shared/utils';
import { MktgPrintPageComponent } from '../mktg-print-page/mktg-print-page.component';

/**
 * A section divider of the family PDF, one before each appendix part that
 * has no cover of its own (the boilerplates, the FAQ): the deck's dark
 * section page on the landscape shell, built by `mktgPrintDividerPage`;
 * counted in the deck-wide numbering, but showing no number and no footer.
 */
@Component({
  selector: 'lfx-mktg-print-divider',
  imports: [MktgPrintPageComponent],
  templateUrl: './mktg-print-divider.component.html',
  host: { class: `block ${MKTG_PRINT_LANDSCAPE_CLASS}` },
})
export class MktgPrintDividerComponent {
  public readonly brand = input.required<MktgPrintBrand>();
  public readonly part = input.required<keyof typeof MKTG_PRINT_DIVIDER_NOUNS>();
  /** The part's two-digit number in the family order. */
  public readonly partNumber = input.required<string>();
  /** How many items the part prints. */
  public readonly count = input.required<number>();
  public readonly familyName = input.required<string>();
  protected readonly look = computed(() => mktgPrintPageLook(this.brand()));
  protected readonly page = computed(() =>
    mktgPrintDividerPage(this.look(), mktgPrintDivider(this.part(), this.partNumber(), this.count(), this.familyName()), this.brand().logoOnDark)
  );
}
