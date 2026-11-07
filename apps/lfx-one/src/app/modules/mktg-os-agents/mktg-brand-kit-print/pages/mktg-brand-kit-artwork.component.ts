// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { BrandKitBookView } from '@lfx-one/shared/interfaces';
import { BrandKitPortraitArtworkMode } from '@lfx-one/shared/interfaces';
import { brandKitPortraitArtwork, mktgPortraitPlateFitIn } from '@lfx-one/shared/utils';
import { MktgPortraitPlateDirective } from '../../components/mktg-portrait/mktg-portrait-plate.directive';

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
  imports: [MktgPortraitPlateDirective],
  host: { class: 'inline-block align-middle' },
})
export class MktgBrandKitArtworkComponent {
  public readonly view = input.required<BrandKitBookView>();
  public readonly kind = input<'lockup' | 'symbol' | 'stacked'>('lockup');
  public readonly mode = input<BrandKitPortraitArtworkMode>('full');
  /** The box's height in px: the artwork's, or the plate's outer box when the artwork sits on one. */
  public readonly height = input.required<number>();
  /** The width the plate must fit inside (a shape's inner box, a tile's clear width), or null for no width bound. */
  public readonly innerWidth = input<number | null>(null);
  protected readonly image = computed(() => brandKitPortraitArtwork(this.view(), this.kind(), this.mode()));
  /**
   * The drawn height and the plate's outer height: the bare height, or the artwork fitted inside the plate, which fits
   * the box by height and, when the artwork's aspect is known, `innerWidth` by width (a wide mark is sized down so its
   * plate stays inside the shape); the plate pads and rounds itself from its outer height.
   */
  protected readonly fit = computed(() => {
    const image = this.image();
    if (!image?.plate) return { height: this.height(), padding: 0, plate: null };
    return mktgPortraitPlateFitIn(this.height(), this.innerWidth(), image.aspect ?? null);
  });
}
