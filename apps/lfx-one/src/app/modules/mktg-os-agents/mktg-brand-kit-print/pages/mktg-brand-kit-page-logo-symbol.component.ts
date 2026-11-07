// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { BRAND_KIT_CONTRAST_AA, BRAND_KIT_PORTRAIT_WIDE_SYMBOL_NOTE } from '@lfx-one/shared/constants';
import {
  brandKitPortraitIntro,
  brandKitPortraitRatioLabel,
  brandKitPortraitSymbolIsWide,
  brandKitPortraitWhiteContrast,
  mktgPortraitShapeInnerWidth,
} from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Symbol & symbol in shape page (mock 06): the rule, the three variants (full colour, reversed, one-colour black), the four shapes (a circle and a rounded square reversed, a rounded square on the tint and on white), and the padding demonstration with its rule (the AA figure for white on the accent only when it fails there). Without a symbol the page keeps its text alone.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-symbol',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-logo-symbol.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageLogoSymbolComponent extends MktgBrandKitPageBase {
  protected readonly hasSymbol = computed(() => !!this.view().symbol?.src);
  /** A wide symbol (aspect over 1.5): shown in the rounded squares only, with the note under the row. */
  protected readonly wide = computed(() => brandKitPortraitSymbolIsWide(this.view()));
  protected readonly wideNote = BRAND_KIT_PORTRAIT_WIDE_SYMBOL_NOTE;
  /**
   * The four shapes; the dark ones captioned by what they draw: the reversed symbol when the slot derives one, else the
   * full-colour symbol on the white plate (a "reversed" caption over a plate would be a false label). Each shape names
   * the box its artwork takes (76 in the 158 shapes, 60 in the 126 white one) and the width a plate may fill inside it
   * (the circle's inscribed square, a rounded square's side less its inset), so a wide mark's plate stays inside.
   */
  protected readonly shapes = computed(() => {
    const dark = this.view().dark;
    const onDark = this.view().derivable.symbol ? 'reversed' : 'full color on a plate';
    const large = { side: 158, box: 76, onWhite: false };
    const small = { side: 126, box: 60, onWhite: true };
    const circle = {
      ...large,
      ground: dark,
      radius: '50%',
      mode: 'reversed' as const,
      caption: `Circle · ${onDark}`,
      innerWidth: mktgPortraitShapeInnerWidth(158, 'circle'),
    };
    return [
      // A wide symbol skips the circle, which would cut it: rounded squares only, and the note under the row says so.
      ...(this.wide() ? [] : [circle]),
      {
        ...large,
        ground: dark,
        radius: '24px',
        mode: 'reversed' as const,
        caption: `Rounded square · ${onDark}`,
        innerWidth: mktgPortraitShapeInnerWidth(158, 'square'),
      },
      {
        ...large,
        ground: this.inks.mist,
        radius: '24px',
        mode: 'full' as const,
        caption: 'Rounded square · light tint',
        innerWidth: mktgPortraitShapeInnerWidth(158, 'square'),
      },
      {
        ...small,
        ground: this.inks.white,
        radius: '24px',
        mode: 'full' as const,
        caption: 'Rounded square · white',
        innerWidth: mktgPortraitShapeInnerWidth(126, 'square'),
      },
    ];
  });
  /** The padding demo's dashed box: the 200 px shape less its inset each side, the width the plate may fill. */
  protected readonly demoInnerWidth = mktgPortraitShapeInnerWidth(200, 'square');
  /** The accent's AA clause: only when white on it fails (the unrounded ratio under 4.5:1), as the mock's does for its coral; the figure cut to one decimal. */
  protected readonly accentClause = computed(() => {
    const ratio = brandKitPortraitWhiteContrast(this.view().accent);
    return ratio < BRAND_KIT_CONTRAST_AA
      ? ` Never put the symbol on the accent: accent colors are not logo colors, and white on ${this.view().accentName} fails AA (${brandKitPortraitRatioLabel(ratio)}:1).`
      : ' Never put the symbol on the accent: accent colors are not logo colors.';
  });
  /** The intro at most three lines of its 600 px: whole sentences that fit, or the first shortened (`brandKitPortraitIntro`). */
  protected readonly intro = computed(() => brandKitPortraitIntro(this.view().logo.symbol));
}
