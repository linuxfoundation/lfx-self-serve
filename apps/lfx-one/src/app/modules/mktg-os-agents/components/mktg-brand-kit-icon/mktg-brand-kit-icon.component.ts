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
 * One Brand Kit sample icon: the shared shapes on the 24-unit grid, one
 * stroke in the current colour, no fill, drawn inline as SVG primitives (no
 * markup string, no `innerHTML`). Decorative: the label beside it is the
 * text. The one drawing for the web view's tiles and strip, the print sheet
 * and the portrait book's Iconography page, so the shapes never drift. The
 * host takes no box of its own (`contents`): the SVG sits in the parent's
 * layout as if drawn there.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-icon',
  templateUrl: './mktg-brand-kit-icon.component.html',
  host: { class: 'contents' },
})
export class MktgBrandKitIconComponent {
  public readonly icon = input.required<BrandKitIconSample>();
  /** The side, in px. */
  public readonly size = input.required<number>();
  protected readonly viewBox = `0 0 ${BRAND_KIT_ICON_VIEWBOX_SIZE} ${BRAND_KIT_ICON_VIEWBOX_SIZE}`;
  protected readonly strokeWidth = BRAND_KIT_ICON_STROKE_WIDTH;
  protected readonly linecap = BRAND_KIT_ICON_STROKE_LINECAP;
  protected readonly linejoin = BRAND_KIT_ICON_STROKE_LINEJOIN;
}
