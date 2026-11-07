// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { BrandKitBookView } from '@lfx-one/shared/interfaces';
import { brandKitPortraitArtwork, BrandKitPortraitArtworkMode } from '@lfx-one/shared/utils';

/**
 * The kit's artwork at a height, as the mock's `lockup(h, mode)` and
 * `mark(h, mode)` draw it: the horizontal lockup, the symbol or the stacked
 * lockup, full colour, reversed or one-colour black. Nothing is drawn when
 * the kit has no file for the slot.
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
  /** Height in px. */
  public readonly height = input.required<number>();
  protected readonly image = computed(() => brandKitPortraitArtwork(this.view(), this.kind(), this.mode()));
}
