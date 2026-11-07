// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BrandKitLogoFiles, MktgLogoPngSize, MktgLogoRecolourInk, MktgLogoVariantSource, MktgLogoVariantSources } from '@lfx-one/shared/interfaces';
import { brandKitSvgIsMonochrome, brandKitSvgWithViewBox } from '@lfx-one/shared/utils';

/** The id of the recolouring filter in the SVG the server writes; fixed, so the derived SVG, and its content-addressed PNG, are stable. */
const RECOLOUR_FILTER_ID = 'lfx-one-recolour';
/** The PNG signature, then the IHDR chunk: its width and height are the big-endian 32-bit integers at offsets 16 and 20. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR_WIDTH_OFFSET = 16;
const PNG_IHDR_HEIGHT_OFFSET = 20;

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

/** The pixel size of a PNG, from its header; null when the bytes are not a PNG. */
export function logoPngSize(png: Uint8Array): MktgLogoPngSize | null {
  if (png.length < PNG_IHDR_HEIGHT_OFFSET + 4 || PNG_SIGNATURE.some((byte, index) => png[index] !== byte)) {
    return null;
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(PNG_IHDR_WIDTH_OFFSET);
  const height = view.getUint32(PNG_IHDR_HEIGHT_OFFSET);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * An SVG the server writes itself, which draws an already-drawn logo PNG
 * recoloured to one ink: every painted pixel becomes the ink and keeps its
 * alpha (fills, strokes, gradients and anti-aliased edges alike), the
 * background stays transparent. The PNG is embedded as a data URL (which
 * `isRasterizableLogoSvg` allows) and filtered through an `feColorMatrix`
 * whose region is exactly the image, in user units, so the rasterizer's
 * canvas, the filter region and the picture are one and the same rectangle.
 *
 * Nothing of the logo's own markup is read or rewritten here: the input is
 * the rasterizer's output. That is the point. The server never reads the
 * logo's root (its viewBox, its size, its attributes): a second reading
 * could only disagree with the rasterizer's, and every such disagreement
 * moved the filter region off the canvas. The one markup edit the server
 * still makes is the shared `brandKitSvgWithViewBox` crop for the symbol,
 * which sets the root viewBox and drops the root width and height, nothing
 * else of the markup; the rasterizer draws it in a child
 * process, so a crop the rasterizer aborts on is dropped, not fatal. Null
 * when the bytes are not a PNG with a size.
 */
export function recolourLogoPngSvg(png: Uint8Array, ink: MktgLogoRecolourInk): string | null {
  const size = logoPngSize(png);
  if (!size) {
    return null;
  }
  const { width, height } = size;
  const filter =
    `<defs><filter id="${RECOLOUR_FILTER_ID}" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="${recolourMatrix(ink)}"/></filter></defs>`;
  const image = `<image href="data:image/png;base64,${Buffer.from(png).toString('base64')}" x="0" y="0" width="${width}" height="${height}" style="filter:url(#${RECOLOUR_FILTER_ID})"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${filter}${image}</svg>`;
}

/**
 * What each logo variant a deck places is drawn from, derived from the kit's
 * logo files the way the web view draws them, so the deck matches the page:
 *
 * - `symbol`: the uploaded symbol file when it is an SVG, else the primary
 *   lockup cropped to `symbol_viewbox` through the shared
 *   `brandKitSvgWithViewBox`; absent without either.
 * - `reversed`: the uploaded reversed file when it is an SVG, else the drawn
 *   primary recoloured white.
 * - `one_color`: the drawn primary recoloured black (no uploaded variant
 *   exists).
 * - `symbol_reversed`: the drawn symbol recoloured white — never a crop of
 *   an uploaded reversed file, whose geometry need not match
 *   `symbol_viewbox` (the web view says the same of its tiles); absent
 *   whenever the symbol is.
 *
 * A recolour is derived only from single-colour artwork, by the one rule the
 * web view applies to its tiles (`brandKitSvgIsMonochrome`): a lockup drawn
 * in two inks, or over a background, flattens to one shape under the filter,
 * so the deck gets no reversed or one-colour lockup from a multi-colour
 * primary, and no reversed symbol from a multi-colour symbol (a crop of the
 * primary inherits the primary's verdict); a painted background the size
 * of the canvas is a second ink by that rule, since a filter would set the
 * mark in a box. The primary itself is still sent, and an uploaded reversed
 * or symbol file is sent as it came, whatever its colours; the variants
 * that are not derived are simply absent, which the caller publishes as
 * nothing.
 *
 * An SVG source says whether it is an upload as it came or the server's
 * crop (`derived`), so a failure to draw it can be told apart; a recolour
 * is always the server's, made from the PNG of the image it names once
 * that image is drawn. Empty without a primary SVG: there are no variants
 * of a logo that is not there. The caller decides what a placeholder kit
 * sends, as `publishLogo` does for the primary.
 */
export function logoVariantSources(files: BrandKitLogoFiles, symbolViewBox: string | null): MktgLogoVariantSources {
  const primary = files.primary?.svg;
  if (!primary) {
    return {};
  }
  const sources: MktgLogoVariantSources = {};
  const primaryDerivable = brandKitSvgIsMonochrome(primary);
  let symbol: MktgLogoVariantSource | null = null;
  let symbolDerivable = false;
  if (files.symbol?.svg) {
    symbol = { kind: 'svg', svg: files.symbol.svg, derived: false };
    symbolDerivable = brandKitSvgIsMonochrome(files.symbol.svg);
  } else if (symbolViewBox) {
    symbol = { kind: 'svg', svg: brandKitSvgWithViewBox(primary, symbolViewBox), derived: true };
    symbolDerivable = primaryDerivable;
  }
  if (symbol) {
    sources.symbol = symbol;
    if (symbolDerivable) {
      sources.symbol_reversed = { kind: 'recolour', of: 'symbol', ink: 'white' };
    }
  }
  if (files.reversed?.svg) {
    sources.reversed = { kind: 'svg', svg: files.reversed.svg, derived: false };
  } else if (primaryDerivable) {
    sources.reversed = { kind: 'recolour', of: 'primary', ink: 'white' };
  }
  if (primaryDerivable) {
    sources.one_color = { kind: 'recolour', of: 'primary', ink: 'black' };
  }
  return sources;
}
