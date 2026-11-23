// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import {
  brandKitPortraitArtwork,
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
  protected readonly hasStacked = computed(() => !!this.view().logos.stacked?.src);
  /**
   * The dark tile draws whatever the reversed slot resolves to (`brandKitPortraitArtwork`): the supplied reversed file
   * first, else the primary reversed or plated. So a kit whose only lockup file is the reversed one still has its dark
   * tile, and the tiles row shows only when one of its tiles can draw (never an empty row).
   */
  protected readonly hasReversedTile = computed(() => brandKitPortraitArtwork(this.view(), 'lockup', 'reversed') !== null);
  protected readonly hasTiles = computed(() => this.hasSymbol() || this.hasReversedTile() || this.hasStacked());
  /**
   * The captions name what the tile draws, as `brandKitPortraitArtwork` resolves it: a supplied file only when its own
   * artwork is drawable (an uploaded PNG has no `src`, so the symbol tile crops the lockup and the reversed tile derives
   * from it; the files table still lists the upload).
   */
  protected readonly symbolSupplied = computed(() => !!this.view().logos.symbol?.src);
  protected readonly reversedSupplied = computed(() => !!this.view().logos.reversed?.src);
  /**
   * The dark tile's caption: the supplied reversed file, the one derived by filter from a one-colour lockup, or (a
   * multi-colour lockup, which a filter would flatten) the full-colour lockup drawn on the dark as it is.
   */
  protected readonly reversedCaption = computed(() => {
    if (this.reversedSupplied()) return 'Reversed · supplied file';
    return this.view().derivable.lockup ? 'Reversed · derived from the horizontal file' : 'On the dark · full color on a white plate (no reversed file)';
  });
  /** The intro at most three lines of its 600 px: whole sentences that fit, or the first shortened (`brandKitPortraitIntro`). */
  protected readonly intro = computed(() => brandKitPortraitIntro(this.view().logo.system));
}
