// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  BRAND_KIT_HEX_REGEX,
  BRAND_KIT_ICON_STROKE_LINECAP,
  BRAND_KIT_ICON_STROKE_LINEJOIN,
  BRAND_KIT_ICON_STROKE_WIDTH,
  BRAND_KIT_ICON_VIEWBOX_SIZE,
} from '@lfx-one/shared/constants';
import { BrandKitIconShape } from '@lfx-one/shared/interfaces';

/** One shape as SVG markup: the primitive's own element, every value a number or path data from the shared constant. */
function shapeMarkup(shape: BrandKitIconShape): string {
  switch (shape.kind) {
    case 'path':
      return `<path d="${shape.d}"/>`;
    case 'circle':
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}"/>`;
    case 'rect':
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.rx}"/>`;
  }
}

/**
 * One iconography sample as the SVG the server rasterises for a deck: the
 * shared constant's shapes on the 24-unit grid, stroked in one colour, no
 * fill, round caps and joins (the frame every renderer draws). The ONE
 * writer of the icon markup on the server, and it writes only its own
 * values: the shapes are the shared constant's, and the stroke is a kit
 * colour that must be a `#RRGGBB` (`BRAND_KIT_HEX_REGEX`), so no text of
 * the kit's own ever reaches the markup. Null for a stroke that is not
 * such a colour: the caller drops the icons. The root carries no size
 * beyond its grid; the rasterizer fits it to the drawing side.
 */
export function brandKitIconSvg(shapes: readonly BrandKitIconShape[], strokeHex: string): string | null {
  if (!BRAND_KIT_HEX_REGEX.test(strokeHex)) {
    return null;
  }
  const size = BRAND_KIT_ICON_VIEWBOX_SIZE;
  const open =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" stroke="${strokeHex}"` +
    ` stroke-width="${BRAND_KIT_ICON_STROKE_WIDTH}" stroke-linecap="${BRAND_KIT_ICON_STROKE_LINECAP}" stroke-linejoin="${BRAND_KIT_ICON_STROKE_LINEJOIN}">`;
  return `${open}${shapes.map(shapeMarkup).join('')}</svg>`;
}
