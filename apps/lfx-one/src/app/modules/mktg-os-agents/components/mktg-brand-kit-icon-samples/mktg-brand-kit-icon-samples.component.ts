// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import {
  BRAND_KIT_ICON_COMPACT_SIZE_PX,
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
 * tab and the print sheet (`compact`: the sheet's small rows beside the
 * rules, in plain block flow, since Chromium fragments grid and flex
 * contents away from their boxes inside a paginated table), so the two
 * never drift: the shapes come from the shared constant, drawn inline as
 * SVG primitives (no markup string, no `innerHTML`), the labels are text
 * beside the icons, never inside them. Print-safe: solid colours only, no
 * filter, gradient or shadow. The host is a block, so the sheet's
 * `break-inside: avoid` holds it whole.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-icon-samples',
  imports: [NgTemplateOutlet],
  templateUrl: './mktg-brand-kit-icon-samples.component.html',
  host: { class: 'block', 'data-testid': 'brand-kit-icon-samples' },
})
export class MktgBrandKitIconSamplesComponent {
  // === Inputs ===
  /** The kit's three colour roles (`brandKitIconColours`): the tiles' ink, the strip's ground and the highlight. */
  public readonly colours = input.required<BrandKitIconColours>();
  /** The print sheet's compact rows beside the rules: small tiles and strip in block flow, the same icons and labels. */
  public readonly compact = input(false);

  // === The shared drawing frame ===
  protected readonly icons = BRAND_KIT_ICON_SAMPLES;
  protected readonly viewBox = `0 0 ${BRAND_KIT_ICON_VIEWBOX_SIZE} ${BRAND_KIT_ICON_VIEWBOX_SIZE}`;
  protected readonly strokeWidth = BRAND_KIT_ICON_STROKE_WIDTH;
  protected readonly linecap = BRAND_KIT_ICON_STROKE_LINECAP;
  protected readonly linejoin = BRAND_KIT_ICON_STROKE_LINEJOIN;
  protected readonly stripIconSize = BRAND_KIT_ICON_STRIP_SIZE_PX;
  /** The strip in words, for assistive technology: its icons are decorative, the ground and the highlight are the point. */
  protected readonly stripLabel = `The ${BRAND_KIT_ICON_SAMPLES.length} icons in white on the kit's dark ground; ${BRAND_KIT_ICON_SAMPLES[BRAND_KIT_ICON_HIGHLIGHT_INDEX].label} in the highlight colour`;

  // === Computed ===
  /** The strip's icons in the board's order, each with its ink: white, except the highlighted one in the kit's highlight. */
  protected readonly strip: Signal<BrandKitIconStripItem[]> = this.initStrip();
  /** The tiles' icon side: the board's 32 px on the web, 18 px in the sheet's compact rows (the strip there uses the same). */
  protected readonly iconSize = computed(() => (this.compact() ? BRAND_KIT_ICON_COMPACT_SIZE_PX : BRAND_KIT_ICON_TILE_SIZE_PX));

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
