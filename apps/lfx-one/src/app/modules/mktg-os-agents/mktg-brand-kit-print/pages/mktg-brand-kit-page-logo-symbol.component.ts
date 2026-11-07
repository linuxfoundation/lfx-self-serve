// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { brandKitPortraitRatioLabel, brandKitPortraitWhiteContrast } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/**
 * The Symbol & symbol in shape page (mock 06): the rule, the three variants (full colour, reversed, one-colour black), the four shapes (a circle and a rounded square reversed, a rounded square on the tint and on white), and the padding demonstration with its rule (the AA figure for white on the accent only when it fails there). Without a symbol the page keeps its text alone.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-symbol',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-logo-symbol.component.html',
})
export class MktgBrandKitPageLogoSymbolComponent extends MktgBrandKitPageBase {
  protected readonly hasSymbol = computed(() => !!this.view().symbol?.src);
  protected readonly shapes = computed(() => {
    const dark = this.view().dark;
    return [
      { ground: dark, radius: '50%', mode: 'reversed' as const, caption: 'Circle · reversed', onWhite: false },
      { ground: dark, radius: '24px', mode: 'reversed' as const, caption: 'Rounded square · reversed', onWhite: false },
      { ground: this.inks.mist, radius: '24px', mode: 'full' as const, caption: 'Rounded square · light tint', onWhite: false },
      { ground: this.inks.white, radius: '24px', mode: 'full' as const, caption: 'Rounded square · white', onWhite: true },
    ];
  });
  /** The accent's AA clause: only when white on it fails (the unrounded ratio under 4.5:1), as the mock's does for its coral; the figure cut to one decimal. */
  protected readonly accentClause = computed(() => {
    const ratio = brandKitPortraitWhiteContrast(this.view().accent);
    return ratio < 4.5
      ? ` Never put the symbol on the accent: accent colors are not logo colors, and white on ${this.view().accentName} fails AA (${brandKitPortraitRatioLabel(ratio)}:1).`
      : ' Never put the symbol on the accent: accent colors are not logo colors.';
  });
}
