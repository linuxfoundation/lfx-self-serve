// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import {
  BRAND_KIT_ICON_STROKE_LINECAP,
  BRAND_KIT_ICON_STROKE_LINEJOIN,
  BRAND_KIT_ICON_STROKE_WIDTH,
  BRAND_KIT_ICON_VIEWBOX_SIZE,
} from '@lfx-one/shared/constants';
import { BrandKitIconSample } from '@lfx-one/shared/interfaces';

/**
 * One of the Brand Kit's sample icons: the shared shapes on the 24-unit grid
 * (`BRAND_KIT_ICON_SAMPLES`), one stroke in the current colour, no fill,
 * drawn inline as SVG primitives (no markup string, no `innerHTML`). The one
 * drawing of an icon, for the samples card and strip (web and portrait sheet)
 * and for the landscape print's Iconography page, which places each icon in
 * its own box. Decorative: the label beside it is the text. The host is
 * `display: contents`, so the SVG lays out as its parent's own child.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-icon',
  templateUrl: './mktg-brand-kit-icon.component.html',
  host: { class: 'contents' },
})
export class MktgBrandKitIconComponent {
  // === Inputs ===
  /** The icon to draw. */
  public readonly icon = input.required<BrandKitIconSample>();
  /** The SVG's side: a px number, or a CSS length such as `100%` to fill the parent's box. */
  public readonly size = input.required<number | string>();

  // === The shared drawing frame ===
  protected readonly viewBox = `0 0 ${BRAND_KIT_ICON_VIEWBOX_SIZE} ${BRAND_KIT_ICON_VIEWBOX_SIZE}`;
  protected readonly strokeWidth = BRAND_KIT_ICON_STROKE_WIDTH;
  protected readonly linecap = BRAND_KIT_ICON_STROKE_LINECAP;
  protected readonly linejoin = BRAND_KIT_ICON_STROKE_LINEJOIN;
}
