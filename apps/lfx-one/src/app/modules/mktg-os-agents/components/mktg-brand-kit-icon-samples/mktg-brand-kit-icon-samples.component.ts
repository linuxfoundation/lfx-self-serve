// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import {
  BRAND_KIT_ICON_HIGHLIGHT_INDEX,
  BRAND_KIT_ICON_PRINT_STRIP_SIZE_PX,
  BRAND_KIT_ICON_SAMPLES,
  BRAND_KIT_ICON_STRIP_INK,
  BRAND_KIT_ICON_STRIP_SIZE_PX,
  BRAND_KIT_ICON_TILE_COLUMNS,
  BRAND_KIT_ICON_STROKE_LINECAP,
  BRAND_KIT_ICON_STROKE_LINEJOIN,
  BRAND_KIT_ICON_STROKE_WIDTH,
  BRAND_KIT_ICON_TILE_SIZE_PX,
  BRAND_KIT_ICON_VIEWBOX_SIZE,
} from '@lfx-one/shared/constants';
import { BrandKitIconColours, BrandKitIconSample, BrandKitIconStripItem } from '@lfx-one/shared/interfaces';

/**
 * The Brand Kit's iconography samples as the design board draws them: the
 * eight line icons in a 4 × 2 grid of labelled tiles, inked in the kit's
 * dark, then a strip on the kit's dark with the eight icons in white and the
 * third in the highlight colour. The one renderer for the web view's Visual
 * tab and the print sheet (`print`: the board's proportions on the sheet's
 * own Iconography page, drawn with table and table-cell boxes only, since
 * Chromium fragments grid and flex contents away from their boxes inside a
 * paginated table), so the two never drift: the shapes come from the shared
 * constant, drawn inline as SVG primitives (no markup string, no
 * `innerHTML`), the labels are text beside the icons, never inside them.
 * Print-safe: solid colours only, no filter, gradient or shadow. The host is
 * a block, so the sheet's `break-inside: avoid` holds it whole.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-icon-samples',
  imports: [NgTemplateOutlet],
  templateUrl: './mktg-brand-kit-icon-samples.component.html',
  // `@container`: the web strip queries the host's width to choose one row of eight or 4 + 4.
  host: { class: '@container block', 'data-testid': 'brand-kit-icon-samples' },
})
export class MktgBrandKitIconSamplesComponent {
  // === Inputs ===
  /** The kit's three colour roles (`brandKitIconColours`): the tiles' ink, the strip's ground and the highlight. */
  public readonly colours = input.required<BrandKitIconColours>();
  /** The print sheet's variant: the board's sizes in table boxes, beside the rules on the sheet's Iconography page. */
  public readonly print = input(false);

  // === The shared drawing frame ===
  protected readonly icons = BRAND_KIT_ICON_SAMPLES;
  protected readonly viewBox = `0 0 ${BRAND_KIT_ICON_VIEWBOX_SIZE} ${BRAND_KIT_ICON_VIEWBOX_SIZE}`;
  protected readonly strokeWidth = BRAND_KIT_ICON_STROKE_WIDTH;
  protected readonly linecap = BRAND_KIT_ICON_STROKE_LINECAP;
  protected readonly linejoin = BRAND_KIT_ICON_STROKE_LINEJOIN;
  protected readonly tileIconSize = BRAND_KIT_ICON_TILE_SIZE_PX;
  /** The board's 4 × 2 tiles as rows, for the print sheet's table. */
  protected readonly tileRows: readonly (readonly BrandKitIconSample[])[] = Array.from(
    { length: Math.ceil(BRAND_KIT_ICON_SAMPLES.length / BRAND_KIT_ICON_TILE_COLUMNS) },
    (_, row) => BRAND_KIT_ICON_SAMPLES.slice(row * BRAND_KIT_ICON_TILE_COLUMNS, (row + 1) * BRAND_KIT_ICON_TILE_COLUMNS)
  );
  /** The strip in words, for assistive technology: its icons are decorative, the ground and the highlight are the point. */
  protected readonly stripLabel = `The ${BRAND_KIT_ICON_SAMPLES.length} icons in white on the kit's dark ground; ${BRAND_KIT_ICON_SAMPLES[BRAND_KIT_ICON_HIGHLIGHT_INDEX].label} in the highlight colour`;

  // === Computed ===
  /** The strip's icons in the board's order, each with its ink: white, except the highlighted one in the kit's highlight. */
  protected readonly strip: Signal<BrandKitIconStripItem[]> = this.initStrip();
  /** The strip icons' side: the board's 30 px in print; 24 px on the web, where the strip must hold one row in the half-width card. */
  protected readonly stripIconSize = computed(() => (this.print() ? BRAND_KIT_ICON_PRINT_STRIP_SIZE_PX : BRAND_KIT_ICON_STRIP_SIZE_PX));

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
