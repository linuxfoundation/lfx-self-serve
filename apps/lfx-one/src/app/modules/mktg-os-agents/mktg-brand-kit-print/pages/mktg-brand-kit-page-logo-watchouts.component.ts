// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { BrandKitWatchoutView } from '@lfx-one/shared/interfaces';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/**
 * The Watchouts page (mock 08): the one-line rule, six 190 px tiles each showing a distortion of the lockup under a red cross (stretched, recoloured, rotated, with a shadow, on a busy gradient, retyped), and the safe default in a mist call-out.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-watchouts',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-logo-watchouts.component.html',
})
export class MktgBrandKitPageLogoWatchoutsComponent extends MktgBrandKitPageBase {
  /** The six tiles: the kit's watchout lines with the mock's distortions (the view's draws, its shadow in px). */
  protected readonly tiles = computed((): (BrandKitWatchoutView & { ground: string })[] =>
    this.view()
      .watchouts.slice(0, 6)
      .map((tile) => ({
        ...tile,
        filter: tile.filter.startsWith('drop-shadow') ? 'drop-shadow(4px 5px 3px rgba(0, 0, 0, 0.45))' : tile.filter,
        ground: tile.ground || '#fff',
      }))
  );
  protected readonly minimum = computed(() => this.view().logo.minimum_size.screen_px);
}
