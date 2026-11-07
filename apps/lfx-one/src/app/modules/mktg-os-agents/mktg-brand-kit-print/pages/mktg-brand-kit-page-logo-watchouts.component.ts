// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { BRAND_KIT_PORTRAIT_RECOLOR_FILTER } from '@lfx-one/shared/constants';
import { BrandKitBookView, BrandKitWatchoutView } from '@lfx-one/shared/interfaces';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/**
 * The Watchouts page (mock 08): the one-line rule, six 190 px tiles each showing a distortion of the lockup under a red cross (stretched, recoloured, rotated, with a shadow, on a busy gradient, retyped), and the safe default in a mist call-out.
 */
/** The view's draw as the print draws it: the shadow in px, the recolor as the portrait filter, the rest as it is. */
function printFilter(filter: string): string {
  if (filter.startsWith('drop-shadow')) return 'drop-shadow(4px 5px 3px rgba(0, 0, 0, 0.45))';
  if (filter.startsWith('hue-rotate')) return BRAND_KIT_PORTRAIT_RECOLOR_FILTER;
  return filter;
}

/**
 * The busy ground as the mock draws it (p08): the accent, through the palette's fourth colour (the spark when the
 * palette has no fourth) at 60%, into the dark, at 120°. The on-screen tile keeps its own gradient.
 */
function printGround(ground: string, view: BrandKitBookView): string {
  if (!ground.startsWith('linear-gradient')) return ground;
  const through = view.palette[3]?.hex ?? view.spark;
  return `linear-gradient(120deg, ${view.accent}, ${through} 60%, ${view.dark})`;
}

@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-watchouts',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-logo-watchouts.component.html',
})
export class MktgBrandKitPageLogoWatchoutsComponent extends MktgBrandKitPageBase {
  /**
   * The six tiles: the kit's watchout lines with the mock's distortions (the view's draws, its shadow in px, its hue
   * rotation as the print's recolor, which also turns a black mark, its busy ground as the mock's gradient; the
   * on-screen tile keeps its own).
   */
  protected readonly tiles = computed((): (BrandKitWatchoutView & { ground: string })[] =>
    this.view()
      .watchouts.slice(0, 6)
      .map((tile) => ({
        ...tile,
        filter: printFilter(tile.filter),
        ground: printGround(tile.ground, this.view()) || this.inks.white,
      }))
  );
  protected readonly minimum = computed(() => this.view().logo.minimum_size.screen_px);
}
