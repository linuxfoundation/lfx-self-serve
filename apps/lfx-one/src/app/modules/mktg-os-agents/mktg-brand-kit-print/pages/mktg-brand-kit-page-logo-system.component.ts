// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import {
  brandKitPortraitFiles,
  brandKitPortraitHasLogoFiles,
  brandKitPortraitHasLogoUploads,
  brandKitPortraitIntro,
  brandKitPortraitUndrawableFilesLine,
} from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Logo system page (mock 03): the intro, the primary lockup in a 240 px hero, three 224 × 150 tiles (the symbol, the reversed lockup on the dark, the stacked lockup or the symbol on the mist tint), and the logo files table. A tile whose artwork the kit lacks is left out; file names are never printed. A kit whose uploads the print cannot draw (PNG, a ZIP member without bytes) keeps its files table under one line saying so; only an empty record prints "No logo files uploaded yet".
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-system',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-logo-system.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageLogoSystemComponent extends MktgBrandKitPageBase {
  protected readonly files = computed(() => brandKitPortraitFiles(this.view()));
  /** Artwork a tile can draw (inline SVG, own or cropped). */
  protected readonly hasArtwork = computed(() => brandKitPortraitHasLogoFiles(this.view()));
  /** Any file uploaded, drawable or not: the files table prints what was supplied. */
  protected readonly hasUploads = computed(() => brandKitPortraitHasLogoUploads(this.view()));
  /** Uploads the print cannot draw (PNG, or a ZIP member without bytes): the line in the tiles' place, from the record. */
  protected readonly undrawable = computed(() => brandKitPortraitUndrawableFilesLine(this.view()));
  /** The files table under the tiles, or up where the hero would start when there is nothing to draw above it. */
  protected readonly filesTop = computed(() => (this.hasArtwork() ? 716 : 300));
  protected readonly hasSymbol = computed(() => !!this.view().symbol?.src);
  /**
   * The captions name what the tile draws, as `brandKitPortraitArtwork` resolves it: a supplied file only when its own
   * artwork is drawable (an uploaded PNG has no `src`, so the symbol tile crops the lockup and the reversed tile derives
   * from it; the files table still lists the upload).
   */
  protected readonly symbolSupplied = computed(() => !!this.view().logos.symbol?.src);
  protected readonly reversedSupplied = computed(() => !!this.view().logos.reversed?.src);
  protected readonly hasStacked = computed(() => !!this.view().logos.stacked?.src);
  /** The intro at most three lines of its 600 px: whole sentences that fit, or the first shortened (`brandKitPortraitIntro`). */
  protected readonly intro = computed(() => brandKitPortraitIntro(this.view().logo.system));
}
