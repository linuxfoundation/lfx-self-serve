// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { BrandKitBookView } from '@lfx-one/shared/interfaces';
import { BrandKitPortraitArtworkMode } from '@lfx-one/shared/interfaces';
import { brandKitPortraitArtwork, mktgPortraitPlateFit } from '@lfx-one/shared/utils';

/**
 * The kit's artwork at a height, as the mock's `lockup(h, mode)` and
 * `mark(h, mode)` draw it: the horizontal lockup, the symbol or the stacked
 * lockup, full colour, reversed or one-colour black. Nothing is drawn when
 * the kit has no file for the slot. Reversed artwork the book cannot derive
 * (no reversed file, more than one ink) is drawn in full colour on the white
 * plate (`.pp-plate`), padded by half the drawn height, the plate's outer box
 * fitted to `height` (the artwork is drawn smaller): it never spills out of
 * the tile, circle or stage the page sizes for the bare artwork.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-artwork',
  templateUrl: './mktg-brand-kit-artwork.component.html',
  host: { class: 'inline-block align-middle' },
})
export class MktgBrandKitArtworkComponent {
  public readonly view = input.required<BrandKitBookView>();
  public readonly kind = input<'lockup' | 'symbol' | 'stacked'>('lockup');
  public readonly mode = input<BrandKitPortraitArtworkMode>('full');
  /** The box's height in px: the artwork's, or the plate's outer box when the artwork sits on one. */
  public readonly height = input.required<number>();
  protected readonly image = computed(() => brandKitPortraitArtwork(this.view(), this.kind(), this.mode()));
  /** The drawn height and the plate's padding: the bare height, or the plate fitted to it. */
  protected readonly fit = computed(() => (this.image()?.plate ? mktgPortraitPlateFit(this.height()) : { height: this.height(), padding: 0 }));
}
