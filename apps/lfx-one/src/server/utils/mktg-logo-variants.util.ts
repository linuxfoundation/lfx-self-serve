// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BrandKitLogoFiles, MktgLogoRecolourInk, MktgLogoVariantSvgSources } from '@lfx-one/shared/interfaces';
import { brandKitSvgWithViewBox } from '@lfx-one/shared/utils';

/** The root tag, as `brandKitSvgWithViewBox` finds it. */
const SVG_ROOT_TAG = /<svg\b[^>]*>/i;
/** The root's closing tag; the last one in the text closes the root. */
const SVG_CLOSE_TAG = '</svg>';
/** The id of the recolouring filter: namespaced so a logo's own ids cannot collide with it. */
const RECOLOUR_FILTER_ID = 'lfx-one-recolour';

/**
 * The `feColorMatrix` that sets every painted pixel to the ink and keeps its
 * alpha: the RGB rows take nothing from the source and add the ink (1 for
 * white, 0 for black); the alpha row is the identity. The same transform the
 * web view's CSS filters apply (`brightness(0) invert(1)` for reversed,
 * `brightness(0)` for one-colour), so the deck matches the page.
 */
function recolourMatrix(ink: MktgLogoRecolourInk): string {
  const value = ink === 'white' ? 1 : 0;
  return `0 0 0 0 ${value} 0 0 0 0 ${value} 0 0 0 0 ${value} 0 0 0 1 0`;
}

/**
 * The SVG with everything it paints recoloured to one ink (its fills,
 * strokes and gradients alike, however they were expressed) and its
 * background left transparent: the root's content is wrapped in a group
 * that applies an `feColorMatrix` filter declared in a `<defs>` of its own.
 * The filter region is in user space (`filterUnits="userSpaceOnUse"`, the
 * viewport with the default margin) rather than the default object bounding
 * box, which has no area for a stroke-only line and would drop it.
 *
 * Unchanged when there is no root tag to wrap, or when the root is
 * self-closing (it paints nothing to recolour), the way
 * `brandKitSvgWithViewBox` leaves an SVG without a root. Nothing injected is
 * an href or an entity, so `isRasterizableLogoSvg` reads the result as it
 * read the source.
 */
export function recolourLogoSvg(svg: string, ink: MktgLogoRecolourInk): string {
  const root = SVG_ROOT_TAG.exec(svg);
  const close = svg.lastIndexOf(SVG_CLOSE_TAG);
  if (!root || root[0].endsWith('/>') || close < root.index + root[0].length) {
    return svg;
  }
  const open = root.index + root[0].length;
  const filter =
    `<defs><filter id="${RECOLOUR_FILTER_ID}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="${recolourMatrix(ink)}"/></filter></defs>`;
  return `${svg.slice(0, open)}${filter}<g filter="url(#${RECOLOUR_FILTER_ID})">${svg.slice(open, close)}</g>${svg.slice(close)}`;
}

/**
 * The SVG source of every logo variant a deck places, derived from the kit's
 * logo files the way the web view draws them, so the deck matches the page:
 *
 * - `symbol`: the uploaded symbol file when it is an SVG, else the primary
 *   lockup cropped to `symbol_viewbox` through the shared
 *   `brandKitSvgWithViewBox`; absent without either.
 * - `reversed`: the uploaded reversed file when it is an SVG, else the
 *   primary recoloured white.
 * - `one_color`: the primary recoloured black (no uploaded variant exists).
 * - `symbol_reversed`: the symbol source recoloured white — never a crop of
 *   an uploaded reversed file, whose geometry need not match
 *   `symbol_viewbox` (the web view says the same of its tiles); absent
 *   whenever the symbol is.
 *
 * Empty without a primary SVG: there are no variants of a logo that is not
 * there. The caller decides what a placeholder kit sends, as `publishLogo`
 * does for the primary.
 */
export function logoVariantSvgSources(files: BrandKitLogoFiles, symbolViewBox: string | null): MktgLogoVariantSvgSources {
  const primary = files.primary?.svg;
  if (!primary) {
    return {};
  }
  const symbol = files.symbol?.svg ?? (symbolViewBox ? brandKitSvgWithViewBox(primary, symbolViewBox) : null);
  return {
    ...(symbol && { symbol, symbol_reversed: recolourLogoSvg(symbol, 'white') }),
    reversed: files.reversed?.svg ?? recolourLogoSvg(primary, 'white'),
    one_color: recolourLogoSvg(primary, 'black'),
  };
}
