// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BrandKitLogoFiles, MktgLogoRecolourInk, MktgLogoUserSpace, MktgLogoVariantSvgSources } from '@lfx-one/shared/interfaces';
import { brandKitSvgWithViewBox } from '@lfx-one/shared/utils';

/** The root tag, as `brandKitSvgWithViewBox` finds it. */
const SVG_ROOT_TAG = /<svg\b[^>]*>/i;
/** The root's closing tag; the last one in the text closes the root. */
const SVG_CLOSE_TAG = '</svg>';
/** The root's viewBox: four numbers, separated by whitespace or commas. */
const VIEW_BOX_ATTRIBUTE = /\sviewBox\s*=\s*"\s*([-+\d.eE]+)[\s,]+([-+\d.eE]+)[\s,]+([-+\d.eE]+)[\s,]+([-+\d.eE]+)\s*"/i;
/** A root width or height in user units (a bare number, or one in px); any other unit says nothing about user space. */
const USER_UNIT_SIZE = /^\s*([+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(?:px)?\s*$/;
/** The id of the recolouring filter: namespaced so a logo's own ids are unlikely to collide with it, and fixed so the derived SVG, and its content-addressed PNG, are stable. */
const RECOLOUR_FILTER_ID = 'lfx-one-recolour';
/** The margin the filter region takes around the root's user space, as the SVG default region does around a bounding box (10% a side). */
const FILTER_REGION_MARGIN = 0.1;

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

/** One attribute value of the root tag, or null. */
function rootAttribute(rootTag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(rootTag);
  return match ? match[1] : null;
}

/**
 * The root's user space: its viewBox, else its width and height from the
 * origin, or null when it declares neither (or declares them in units that
 * say nothing about user space). This is the space the filter region is set
 * in: percentages in user space are measured from the origin, not from the
 * viewBox's corner, so a viewBox off the origin needs the region spelled out.
 */
export function logoSvgUserSpace(svg: string): MktgLogoUserSpace | null {
  const root = SVG_ROOT_TAG.exec(svg);
  if (!root) {
    return null;
  }
  const viewBox = VIEW_BOX_ATTRIBUTE.exec(root[0]);
  if (viewBox) {
    const [minX, minY, width, height] = viewBox.slice(1, 5).map(Number);
    return [minX, minY, width, height].every(Number.isFinite) && width > 0 && height > 0 ? { minX, minY, width, height } : null;
  }
  const width = USER_UNIT_SIZE.exec(rootAttribute(root[0], 'width') ?? '');
  const height = USER_UNIT_SIZE.exec(rootAttribute(root[0], 'height') ?? '');
  if (!width || !height) {
    return null;
  }
  const size = { width: Number(width[1]), height: Number(height[1]) };
  return size.width > 0 && size.height > 0 ? { minX: 0, minY: 0, ...size } : null;
}

/** A region coordinate, as the attribute carries it: without float noise. */
function coordinate(value: number): string {
  return String(Number(value.toFixed(6)));
}

/**
 * The SVG with everything it paints recoloured to one ink (its fills,
 * strokes and gradients alike, however they were expressed) and its
 * background left transparent: the root's content is wrapped in a group
 * that applies an `feColorMatrix` filter declared in a `<defs>` of its own.
 *
 * The filter region is spelled out in user units around the root's own
 * user space (its viewBox, else its size), with the usual 10% margin a
 * side. Two reasons: the default region is the filtered element's bounding
 * box, which has no area for a stroke-only line and would drop it; and a
 * user-space region left to its percentage defaults is measured from the
 * origin, so a viewBox off the origin (a symbol cropped out of the right of
 * a lockup, an offset upload) would be clipped or lost. A region that
 * covers the viewBox always overlaps the canvas, which the rasterizer
 * requires (a disjoint one aborts it). The filter is applied through the
 * wrapper's inline style, which a stylesheet rule of the logo's own cannot
 * override short of `!important`; a logo declaring `!important` filters is
 * out of scope.
 *
 * Null when the recolour cannot be made safely: no root tag, no closing
 * `</svg>` after it to wrap up to (a `</svg >` or a prefixed root), or no
 * user space to set the region in; the caller treats null as a variant it
 * cannot derive. A self-closing root paints nothing to recolour and is
 * returned as it is. Nothing injected is an href or an entity, so
 * `isRasterizableLogoSvg` reads the result as it read the source.
 */
export function recolourLogoSvg(svg: string, ink: MktgLogoRecolourInk): string | null {
  const root = SVG_ROOT_TAG.exec(svg);
  if (!root) {
    return null;
  }
  if (root[0].endsWith('/>')) {
    return svg;
  }
  const open = root.index + root[0].length;
  const close = svg.lastIndexOf(SVG_CLOSE_TAG);
  const space = logoSvgUserSpace(svg);
  if (close < open || !space) {
    return null;
  }
  const region =
    `x="${coordinate(space.minX - FILTER_REGION_MARGIN * space.width)}" y="${coordinate(space.minY - FILTER_REGION_MARGIN * space.height)}" ` +
    `width="${coordinate((1 + 2 * FILTER_REGION_MARGIN) * space.width)}" height="${coordinate((1 + 2 * FILTER_REGION_MARGIN) * space.height)}"`;
  const filter =
    `<defs><filter id="${RECOLOUR_FILTER_ID}" filterUnits="userSpaceOnUse" ${region} color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="${recolourMatrix(ink)}"/></filter></defs>`;
  return `${svg.slice(0, open)}${filter}<g style="filter:url(#${RECOLOUR_FILTER_ID})">${svg.slice(open, close)}</g>${svg.slice(close)}`;
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
 * Each source says whether it was derived here (a crop or a recolour) or is
 * an upload as it came, so a failure to draw it can be told apart. A
 * recolour that cannot be made (`recolourLogoSvg` null) leaves its variant
 * with a null source, so the caller can say so; a variant that does not
 * apply (no symbol) is absent. Empty without a primary SVG: there are no
 * variants of a logo that is not there. The caller decides what a
 * placeholder kit sends, as `publishLogo` does for the primary.
 */
export function logoVariantSvgSources(files: BrandKitLogoFiles, symbolViewBox: string | null): MktgLogoVariantSvgSources {
  const primary = files.primary?.svg;
  if (!primary) {
    return {};
  }
  const sources: MktgLogoVariantSvgSources = {};
  const symbol = files.symbol?.svg
    ? { svg: files.symbol.svg, derived: false }
    : symbolViewBox
      ? { svg: brandKitSvgWithViewBox(primary, symbolViewBox), derived: true }
      : null;
  if (symbol) {
    sources.symbol = symbol;
    sources.symbol_reversed = { svg: recolourLogoSvg(symbol.svg, 'white'), derived: true };
  }
  sources.reversed = files.reversed?.svg ? { svg: files.reversed.svg, derived: false } : { svg: recolourLogoSvg(primary, 'white'), derived: true };
  sources.one_color = { svg: recolourLogoSvg(primary, 'black'), derived: true };
  return sources;
}
