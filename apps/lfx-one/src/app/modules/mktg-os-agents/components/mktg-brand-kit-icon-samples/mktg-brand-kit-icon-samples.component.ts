// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import {
  BRAND_KIT_ICON_HIGHLIGHT_INDEX,
  BRAND_KIT_ICON_SAMPLES,
  BRAND_KIT_ICON_STRIP_INK,
  BRAND_KIT_ICON_STRIP_SIZE_PX,
  BRAND_KIT_ICON_TILE_SIZE_PX,
} from '@lfx-one/shared/constants';
import { BrandKitIconColours, BrandKitIconStripItem } from '@lfx-one/shared/interfaces';
import { MktgBrandKitIconComponent } from '../mktg-brand-kit-icon/mktg-brand-kit-icon.component';

/**
 * The Brand Kit's iconography samples as the design board draws them: the
 * eight line icons in a 4 × 2 grid of labelled tiles, inked in the kit's
 * dark, then a strip on the kit's dark with the eight icons in white and the
 * third in the highlight colour. The web view's Visual tab's card; each icon
 * is the one shared drawing (`lfx-mktg-brand-kit-icon`, which the PDF's
 * Iconography page places box by box), the shapes from the shared constant,
 * inline SVG primitives (no markup string, no `innerHTML`), the labels text
 * beside the icons, never inside them, so the card and the page never drift.
 * Print-safe: solid colours only, no filter, gradient or shadow. The host is
 * a block.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-icon-samples',
  imports: [NgTemplateOutlet, MktgBrandKitIconComponent],
  templateUrl: './mktg-brand-kit-icon-samples.component.html',
  // `@container`: the web strip queries the host's width to choose one row of eight or 4 + 4.
  host: { class: '@container block', 'data-testid': 'brand-kit-icon-samples' },
})
export class MktgBrandKitIconSamplesComponent {
  // === Inputs ===
  /** The kit's three colour roles (`brandKitIconColours`): the tiles' ink, the strip's ground and the highlight. */
  public readonly colours = input.required<BrandKitIconColours>();

  // === The shared drawing frame ===
  protected readonly icons = BRAND_KIT_ICON_SAMPLES;
  protected readonly tileIconSize = BRAND_KIT_ICON_TILE_SIZE_PX;
  /** The strip icons' side: 24 px, so the strip holds one row of eight in the half-width card. */
  protected readonly stripIconSize = BRAND_KIT_ICON_STRIP_SIZE_PX;
  /** The strip in words, for assistive technology: its icons are decorative, the ground and the highlight are the point. */
  protected readonly stripLabel = `The ${BRAND_KIT_ICON_SAMPLES.length} icons in white on the kit's dark ground; ${BRAND_KIT_ICON_SAMPLES[BRAND_KIT_ICON_HIGHLIGHT_INDEX].label} in the highlight colour`;

  // === Computed ===
  /** The strip's icons in the board's order, each with its ink: white, except the highlighted one in the kit's highlight. */
  protected readonly strip: Signal<BrandKitIconStripItem[]> = this.initStrip();

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
