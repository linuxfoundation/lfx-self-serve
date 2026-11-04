// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BrandKitLogoFiles, MktgLogoRecolourInk, MktgLogoSvgRoot, MktgLogoUserSpace, MktgLogoVariantSvgSources } from '@lfx-one/shared/interfaces';
import { brandKitSvgWithViewBox } from '@lfx-one/shared/utils';

/** Where the root tag starts, as `brandKitSvgWithViewBox` finds it. */
const SVG_ROOT_START = /<svg(?=[\s/>])/;
/**
 * One attribute of the root tag, read the way the XML parser reads it: a
 * name, `=`, and a value in either quote, consumed whole so nothing written
 * inside a value is ever read as an attribute. Sticky, so the tag is read
 * token by token from just after `<svg`; a token that is not an attribute
 * ends the read. Every quantifier here covers a class that excludes its
 * neighbour's, so the match is linear in the tag's length.
 */
const ROOT_ATTRIBUTE = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
/** The end of the root tag, after its attributes: `>` or `/>`. */
const ROOT_TAG_END = /\s*(\/?)>/y;
/** The root's closing tag; the last one in the text closes the root. */
const SVG_CLOSE_TAG = '</svg>';
/** Any spelling of a viewBox attribute: the parser takes only `viewBox` exactly, so another spelling says the tag is not what it looks like. */
const VIEW_BOX_NAME = /^viewbox$/i;
/** One plain number, as a viewBox or a size carries it. No quantifier overlaps its neighbour's, so the match is linear. */
const PLAIN_NUMBER = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/;
/** A root width or height in user units: a plain non-negative number, bare or in px; any other unit says nothing about user space. */
const USER_UNIT_SIZE = /^\+?((?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?)(?:px)?$/;
/** The longest viewBox or size value worth parsing: four numbers, or one, with room to spare. Anything longer is refused before any pattern runs. */
const MAX_VIEW_BOX_CHARS = 64;
const MAX_SIZE_CHARS = 32;
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

/**
 * The root tag read token by token, as the XML parser reads it: where it
 * starts and ends, whether it closes itself, and its attributes by exact
 * name. Null when there is no root, or when the tag holds anything that is
 * not a quoted attribute before its `>` (a valueless attribute, a stray
 * character): a tag the server cannot read whole is one it must not place a
 * filter region in.
 */
export function logoSvgRoot(svg: string): MktgLogoSvgRoot | null {
  const start = SVG_ROOT_START.exec(svg);
  if (!start) {
    return null;
  }
  const attributes = new Map<string, string[]>();
  let index = start.index + start[0].length;
  for (;;) {
    ROOT_ATTRIBUTE.lastIndex = index;
    const attribute = ROOT_ATTRIBUTE.exec(svg);
    if (!attribute) {
      break;
    }
    const [token, name, doubleQuoted, singleQuoted] = attribute;
    attributes.set(name, [...(attributes.get(name) ?? []), doubleQuoted ?? singleQuoted ?? '']);
    index += token.length;
  }
  ROOT_TAG_END.lastIndex = index;
  const end = ROOT_TAG_END.exec(svg);
  if (!end) {
    return null;
  }
  return { start: start.index, end: index + end[0].length, selfClosing: end[1] === '/', attributes };
}

/** The one value of an attribute, or null when it is absent, repeated (which the parser refuses), or carries a reference the server does not decode. */
function singleAttribute(root: MktgLogoSvgRoot, name: string): string | null {
  const values = root.attributes.get(name);
  return values?.length === 1 && !values[0].includes('&') ? values[0] : null;
}

/**
 * The root's user space: its viewBox, else its width and height from the
 * origin, or null when it declares neither, declares them in a way the
 * server does not read exactly as the parser does, or declares them in units
 * that say nothing about user space. This is the space the filter region is
 * set in, and the region must cover the canvas the parser draws: so a
 * viewBox the server cannot read exactly (another spelling of the name, a
 * repeat, a character reference, anything but four plain finite numbers with
 * a positive size) is null rather than a guess, and the size is read only
 * when no viewBox-like attribute exists at all.
 */
export function logoSvgUserSpace(svg: string): MktgLogoUserSpace | null {
  const root = logoSvgRoot(svg);
  if (!root) {
    return null;
  }
  const viewBoxNames = [...root.attributes.keys()].filter((name) => VIEW_BOX_NAME.test(name));
  if (viewBoxNames.length > 0) {
    if (viewBoxNames.length > 1 || viewBoxNames[0] !== 'viewBox') {
      return null;
    }
    const value = singleAttribute(root, 'viewBox');
    if (value === null || value.length > MAX_VIEW_BOX_CHARS) {
      return null;
    }
    const parts = value.trim().split(/[\s,]+/);
    if (parts.length !== 4 || !parts.every((part) => PLAIN_NUMBER.test(part))) {
      return null;
    }
    const [minX, minY, width, height] = parts.map(Number);
    return [minX, minY, width, height].every(Number.isFinite) && width > 0 && height > 0 ? { minX, minY, width, height } : null;
  }
  const size = (['width', 'height'] as const).map((name) => {
    const value = singleAttribute(root, name);
    const match = value !== null && value.length <= MAX_SIZE_CHARS ? USER_UNIT_SIZE.exec(value.trim()) : null;
    return match ? Number(match[1]) : NaN;
  });
  const [width, height] = size;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { minX: 0, minY: 0, width, height } : null;
}

/** A region coordinate, as the attribute carries it: 12 significant digits, enough for any viewBox, without float noise. */
function coordinate(value: number): string {
  return String(Number(value.toPrecision(12)));
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
 * a lockup, an offset upload) would be clipped or lost. The region must
 * cover the canvas the parser draws (a region that misses it aborts the
 * rasterizer), which is why the user space is read from the root tag
 * exactly as the parser reads it (`logoSvgUserSpace`) and never guessed.
 * The filter is applied through the wrapper's inline style, which a
 * stylesheet rule of the logo's own cannot override short of `!important`;
 * a logo declaring `!important` filters is out of scope.
 *
 * Null when the recolour cannot be made safely: no root tag the server can
 * read whole, no closing `</svg>` after it to wrap up to (a `</svg >` or a
 * prefixed root), or no user space to set the region in; the caller treats
 * null as a variant it cannot derive. A root that closes itself, with no
 * `</svg>` after it, paints nothing to recolour and is returned as it is.
 * Nothing injected is an href or an entity, so `isRasterizableLogoSvg`
 * reads the result as it read the source.
 */
export function recolourLogoSvg(svg: string, ink: MktgLogoRecolourInk): string | null {
  const root = logoSvgRoot(svg);
  if (!root) {
    return null;
  }
  const close = svg.lastIndexOf(SVG_CLOSE_TAG);
  if (root.selfClosing) {
    return close < 0 ? svg : null;
  }
  const space = logoSvgUserSpace(svg);
  if (close < root.end || !space) {
    return null;
  }
  const region =
    `x="${coordinate(space.minX - FILTER_REGION_MARGIN * space.width)}" y="${coordinate(space.minY - FILTER_REGION_MARGIN * space.height)}" ` +
    `width="${coordinate((1 + 2 * FILTER_REGION_MARGIN) * space.width)}" height="${coordinate((1 + 2 * FILTER_REGION_MARGIN) * space.height)}"`;
  const filter =
    `<defs><filter id="${RECOLOUR_FILTER_ID}" filterUnits="userSpaceOnUse" ${region} color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="${recolourMatrix(ink)}"/></filter></defs>`;
  return `${svg.slice(0, root.end)}${filter}<g style="filter:url(#${RECOLOUR_FILTER_ID})">${svg.slice(root.end, close)}</g>${svg.slice(close)}`;
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
