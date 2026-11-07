// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/**
 * The Clear space & minimum size page (mock 05): the rule, the lockup inside its dashed X box on the mist stage with the four X badges, the scaling row (48, 40, 32 px lockups and the symbol at its minimum), and the three minimum-size cards (screen, print, symbol).
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-clear-space',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-logo-clear-space.component.html',
})
export class MktgBrandKitPageLogoClearSpaceComponent extends MktgBrandKitPageBase {
  protected readonly minimum = computed(() => this.view().logo.minimum_size);
  protected readonly intro = computed(() => [this.view().logo.clear_space, this.minimum().rule].filter((part) => part.trim() !== '').join(' '));
  protected readonly steps = [48, 40, 32];
  protected readonly cards = computed(() => {
    const size = this.minimum();
    return [
      { figure: `${size.screen_px} px`, label: 'Minimum height on screen' },
      { figure: `${size.print_mm} mm`, label: 'Minimum height in print' },
      { figure: `${size.symbol_px} px`, label: 'Minimum symbol, below that nothing' },
    ];
  });
}
