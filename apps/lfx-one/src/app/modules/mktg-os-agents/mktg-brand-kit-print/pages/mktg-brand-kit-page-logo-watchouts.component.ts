// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { BrandKitWatchoutView } from '@lfx-one/shared/interfaces';
import { brandKitPortraitRetypedName, brandKitPortraitWatchoutDraw, mktgPortraitMeasure } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Watchouts page (mock 08): the one-line rule, six 190 px tiles each showing a distortion of the lockup under a
 * red cross (stretched, recoloured, rotated, with a shadow, on a busy gradient, retyped), and the safe default in a
 * mist call-out. Each tile's print draw is keyed by its kind (`brandKitPortraitWatchoutDraw`), never by the
 * on-screen CSS.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-watchouts',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-logo-watchouts.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageLogoWatchoutsComponent extends MktgBrandKitPageBase {
  /** The six tiles: the kit's watchout lines, each drawn as the print draws its kind (the on-screen tile keeps its own draw). */
  protected readonly tiles = computed((): BrandKitWatchoutView[] =>
    this.view()
      .watchouts.slice(0, 6)
      .map((tile) => brandKitPortraitWatchoutDraw(tile, this.view(), this.inks.white))
  );
  protected readonly minimum = computed(() => mktgPortraitMeasure(this.view().logo.minimum_size.screen_px, 'px'));
  /** The retyped sample: the whole name at the size that holds it in four lines clear of its badge (30 px down to 20), else shortened at 20. */
  protected readonly retyped = computed(() => brandKitPortraitRetypedName(this.view().projectName));
}
