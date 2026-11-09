// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import { MktgPortraitLook, MktgPortraitBook } from '@lfx-one/shared/interfaces';
import { MktgPortraitPageComponent } from '../mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../mktg-portrait-rect.directive';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../mktg-portrait-host';

/**
 * A chapter opener, the family's (a standalone document has none: its
 * chapters live in the running head): a bare dark frame with the chapter
 * number 200 px in the accent at (72, 120), the title 60/1.05 white at
 * y 420 with its one-sentence purpose 18/1.5 22 px under it, and the
 * version · approved · pages row (30/1.1 white under accent labels, the
 * approver's name on a body-size line under the date when the store holds
 * it) over a 2 px 35 % white rule at y 836. A value the live store does not hold is left out with its
 * column: nothing is drawn in its place.
 */
@Component({
  selector: 'lfx-mktg-portrait-opener',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-portrait-opener.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgPortraitOpenerComponent {
  public readonly look = input.required<MktgPortraitLook>();
  public readonly book = input.required<MktgPortraitBook>();
  public readonly page = input.required<number>();
  /** The opener's plan id (`opener-brand-kit`); the frame's `data-page-id`. */
  public readonly pageId = input.required<string>();
  /** `01`. */
  public readonly number = input.required<string>();
  public readonly title = input.required<string>();
  public readonly purpose = input('');
  /** `V4.0`; '' leaves the column out. */
  public readonly version = input('');
  /** `6 Nov 2026`; '' leaves the column out. */
  public readonly approved = input('');
  /** Who approved, `by Synthetic Approver`, on its own body-size line under the date; null leaves the line out. */
  public readonly approver = input<string | null>(null);
  /** `17–30`; '' leaves the column out. */
  public readonly pages = input('');
  protected readonly geometry = MKTG_PORTRAIT_PAGE;
  protected readonly section = computed(() => `${this.number()} ${this.title()}`);
  protected readonly numberRect = computed((): readonly [number, number, number] => [
    this.geometry.coverInset,
    120,
    this.geometry.width - 2 * this.geometry.coverInset,
  ]);
  protected readonly titleRect = computed((): readonly [number, number, number] => [
    this.geometry.coverInset,
    420,
    this.geometry.width - 2 * this.geometry.coverInset,
  ]);
  protected readonly metaRect = computed((): readonly [number, number, number] => [
    this.geometry.coverInset,
    836,
    this.geometry.width - 2 * this.geometry.coverInset,
  ]);
  protected readonly meta = computed(() =>
    [
      { label: 'Version', value: this.version(), note: null },
      { label: 'Approved', value: this.approved(), note: this.approver()?.trim() || null },
      { label: 'Pages', value: this.pages(), note: null },
    ].filter((cell) => cell.value !== '')
  );
}
