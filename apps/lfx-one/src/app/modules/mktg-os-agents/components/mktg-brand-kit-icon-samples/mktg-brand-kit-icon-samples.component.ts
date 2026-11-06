// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import {
  BRAND_KIT_ICON_HIGHLIGHT_INDEX,
  BRAND_KIT_ICON_SAMPLES,
  BRAND_KIT_ICON_STRIP_INK,
  BRAND_KIT_ICON_STRIP_SIZE_PX,
  BRAND_KIT_ICON_STROKE_LINECAP,
  BRAND_KIT_ICON_STROKE_LINEJOIN,
  BRAND_KIT_ICON_STROKE_WIDTH,
  BRAND_KIT_ICON_TILE_SIZE_PX,
  BRAND_KIT_ICON_VIEWBOX_SIZE,
} from '@lfx-one/shared/constants';
import { BrandKitIconColours, BrandKitIconStripItem } from '@lfx-one/shared/interfaces';

/**
 * The Brand Kit's iconography samples as the design board draws them: the
 * eight line icons in a 4 × 2 grid of labelled tiles, inked in the kit's
 * dark, then a strip on the kit's dark with the eight icons in white and the
 * third in the highlight colour. The one renderer for the web view's Visual
 * tab and the print sheet (`compact` for the sheet's tighter rows), so the
 * two never drift: the shapes come from the shared constant, drawn inline
 * as SVG primitives (no markup string, no `innerHTML`), the labels are text
 * beside the icons, never inside them. Print-safe: solid colours only, no
 * filter, gradient or shadow.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-icon-samples',
  imports: [NgTemplateOutlet],
  templateUrl: './mktg-brand-kit-icon-samples.component.html',
  // The board's 14 px between the grid and the strip (exact px: the root font is 14 px, so the rem scale would not land on it).
  host: { class: 'flex flex-col gap-[14px]', 'data-testid': 'brand-kit-icon-samples' },
})
export class MktgBrandKitIconSamplesComponent {
  // === Inputs ===
  /** The kit's three colour roles (`brandKitIconColours`): the tiles' ink, the strip's ground and the highlight. */
  public readonly colours = input.required<BrandKitIconColours>();
  /** The print sheet's tighter rows: shorter tiles and strip, the same icons and labels. */
  public readonly compact = input(false);

  // === The shared drawing frame ===
  protected readonly icons = BRAND_KIT_ICON_SAMPLES;
  protected readonly viewBox = `0 0 ${BRAND_KIT_ICON_VIEWBOX_SIZE} ${BRAND_KIT_ICON_VIEWBOX_SIZE}`;
  protected readonly strokeWidth = BRAND_KIT_ICON_STROKE_WIDTH;
  protected readonly linecap = BRAND_KIT_ICON_STROKE_LINECAP;
  protected readonly linejoin = BRAND_KIT_ICON_STROKE_LINEJOIN;
  protected readonly tileIconSize = BRAND_KIT_ICON_TILE_SIZE_PX;
  protected readonly stripIconSize = BRAND_KIT_ICON_STRIP_SIZE_PX;
  /** The strip in words, for assistive technology: its icons are decorative, the ground and the highlight are the point. */
  protected readonly stripLabel = `The ${BRAND_KIT_ICON_SAMPLES.length} icons in white on the kit's dark ground; ${BRAND_KIT_ICON_SAMPLES[BRAND_KIT_ICON_HIGHLIGHT_INDEX].label} in the highlight colour`;

  // === Computed ===
  /** The strip's icons in the board's order, each with its ink: white, except the highlighted one in the kit's highlight. */
  protected readonly strip: Signal<BrandKitIconStripItem[]> = this.initStrip();
  // Exact px from the board (tile 110 px, strip 110 px; the sheet's compact rows 88 px and 72 px): the rem scale would not land on them.
  protected readonly tileClass = computed(() => (this.compact() ? 'h-[88px]' : 'h-[110px]'));
  protected readonly stripClass = computed(() => (this.compact() ? 'min-h-[72px] py-2' : 'min-h-[110px] py-4'));

  // === Private initializers ===
  private initStrip(): Signal<BrandKitIconStripItem[]> {
    return computed(() =>
      this.icons.map((icon, index) => {
        const highlight = index === BRAND_KIT_ICON_HIGHLIGHT_INDEX;
        return { icon, highlight, ink: highlight ? this.colours().highlight : BRAND_KIT_ICON_STRIP_INK };
      })
    );
  }
}
