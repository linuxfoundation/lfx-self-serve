// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { brandKitPortraitPaletteSource, brandKitPortraitShare } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Color palette page (mock 09): the summary, one 344 px swatch per colour (its name in the ink that reads on it, HEX, RGB, share, role and where it was found, never a file name or URL), and the proportion bar with its legend. Five colours shorten the swatches so the page still fits.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-color-palette',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-color-palette.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageColorPaletteComponent extends MktgBrandKitPageBase {
  protected readonly swatches = computed(() => {
    const view = this.view();
    return view.palette.map((card, index) => ({
      ...card,
      hexUpper: card.hex.toUpperCase(),
      share: brandKitPortraitShare(view, card.hex),
      source: view.color.palette[index] ? brandKitPortraitPaletteSource(view.color.palette[index]) : '',
    }));
  });
  protected readonly short = computed(() => this.view().palette.length > 4);
}
