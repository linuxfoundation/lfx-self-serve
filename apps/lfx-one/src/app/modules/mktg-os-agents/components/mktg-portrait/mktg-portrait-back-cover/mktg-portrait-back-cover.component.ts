// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import { mktgPortraitPlatePadding } from '@lfx-one/shared/utils';
import { MktgPortraitLogo, MktgPortraitLook, MktgPortraitBook } from '@lfx-one/shared/interfaces';
import { MktgPortraitPageComponent } from '../mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitPlateDirective } from '../mktg-portrait-plate.directive';
import { MktgPortraitRectDirective } from '../mktg-portrait-rect.directive';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../mktg-portrait-host';

/**
 * A portrait document's back cover: a bare dark frame, the reversed lockup
 * 72 px tall centred at y 420, the brand line (13 px caps, +0.16em, in the
 * accent where it reads on the dark, else the ink on the dark), the url and
 * the version line (`V4.0 · November 2026`, the ruling's second and last
 * place for it after the cover) at y 560 inside the margins, and the
 * copyright and trademark notice (9.5/1.5) over a 20 % white rule at y 964.
 * Without a reversed logo the lockup's slot stays empty.
 */
@Component({
  selector: 'lfx-mktg-portrait-back-cover',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgPortraitPlateDirective],
  templateUrl: './mktg-portrait-back-cover.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgPortraitBackCoverComponent {
  public readonly look = input.required<MktgPortraitLook>();
  public readonly book = input.required<MktgPortraitBook>();
  public readonly page = input.required<number>();
  public readonly logo = input<MktgPortraitLogo | null>(null);
  /** The lockup's drawn height, and the white plate's padding under a lockup the kit cannot reverse: half of it. */
  protected readonly lockupHeight = 72;
  protected readonly platePadding = mktgPortraitPlatePadding(this.lockupHeight);
  /** The plate's outer height: the lockup in its padding above and below. */
  protected readonly plateHeight = this.lockupHeight + 2 * this.platePadding;
  /** The brand line; '' draws none. */
  public readonly line = input('');
  /** `aaif.io`; '' draws none. */
  public readonly url = input('');
  /** `V4.0 · November 2026`; '' draws none. */
  public readonly version = input('');
  /** The copyright and trademark notice. */
  public readonly notice = input('');
  protected readonly geometry = MKTG_PORTRAIT_PAGE;
  /** The lockup's block at y 420; a plated lockup's block starts a padding higher, so the artwork stays at y 420 and the plate ends at 528, clear of the brand line at 560. */
  protected readonly lockupRect = computed((): readonly [number, number, number] => [
    0,
    420 - (this.logo()?.plate ? this.platePadding : 0),
    this.geometry.width,
  ]);
  /** The brand line, url and version inside the frame's margins: a long line wraps within the content width, never to the edges. */
  protected readonly lineRect = computed((): readonly [number, number, number] => [this.geometry.margin, 560, this.geometry.contentWidth]);
  protected readonly noticeRect = computed((): readonly [number, number, number] => [
    this.geometry.coverInset,
    964,
    this.geometry.width - 2 * this.geometry.coverInset,
  ]);
}
