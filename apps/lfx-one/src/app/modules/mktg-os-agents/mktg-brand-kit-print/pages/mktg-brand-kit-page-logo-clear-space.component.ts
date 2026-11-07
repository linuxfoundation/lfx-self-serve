// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { brandKitPortraitIntro, mktgPortraitMeasure, mktgPortraitMeasuresInText } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Clear space & minimum size page (mock 05): the rule, the lockup inside its dashed X box on the mist stage with the four X badges, the scaling row (48, 40, 32 px lockups and the symbol at its minimum), and the three minimum-size cards (screen, print, symbol).
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-clear-space',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-logo-clear-space.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageLogoClearSpaceComponent extends MktgBrandKitPageBase {
  protected readonly minimum = computed(() => this.view().logo.minimum_size);
  protected readonly intro = computed(() =>
    mktgPortraitMeasuresInText(brandKitPortraitIntro([this.view().logo.clear_space, this.minimum().rule].filter((part) => part.trim() !== '').join(' ')))
  );
  /** A measure in the pages' one format (`32 px`, `10 mm`), for the scaling labels and the cards alike. */
  protected readonly measure = mktgPortraitMeasure;
  protected readonly steps = [48, 40, 32];
  protected readonly cards = computed(() => {
    const size = this.minimum();
    return [
      { figure: mktgPortraitMeasure(size.screen_px, 'px'), label: 'Minimum height on screen' },
      { figure: mktgPortraitMeasure(size.print_mm, 'mm'), label: 'Minimum height in print' },
      { figure: mktgPortraitMeasure(size.symbol_px, 'px'), label: 'Minimum symbol, below that nothing' },
    ];
  });
}
