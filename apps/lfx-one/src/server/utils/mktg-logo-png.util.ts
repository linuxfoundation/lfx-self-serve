// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_SLIDES_EXPORT_LOGO_MAX_BYTES, MKTG_SLIDES_EXPORT_LOGO_SIDE_PX } from '@lfx-one/shared/constants';
import { MktgLogoPngOptions, MktgLogoPngResult } from '@lfx-one/shared/interfaces';
import { renderAsync, Resvg, ResvgRenderOptions } from '@resvg/resvg-js';

/**
 * Every `href=` in the source (`xlink:href` and any other prefix included), found without consuming
 * the value: the scan resumes right after the `=`, so a decoy `href=` written inside another
 * attribute's value cannot swallow the real attribute that follows it.
 */
const HREF_ASSIGNMENT = /href\s*=/gi;
/** What may follow `href=`: a quote, then a fragment in the same SVG or an image embedded as a data URL. */
const SAFE_HREF_VALUE = /^\s*(["'])(?:#|data:image\/(?:png|jpeg|gif|webp);)/i;
/** Where every entity declaration starts. */
const ENTITY_START = /<!ENTITY/gi;
/** One whole entity declaration, read quote by quote so a `>` inside a quoted value does not end it early. */
const ENTITY_DECLARATION = /^<!ENTITY((?:[^>"']|"[^"]*"|'[^']*')*)>/i;
/** An external or parameter entity, or one whose text carries markup or references. */
const UNSAFE_ENTITY = /\b(?:SYSTEM|PUBLIC)\b|[<&%]/i;
/** A text element (`<text>`, `<tspan>`, `<textPath>`, namespace prefix or not): live text needs a font to draw. */
const LIVE_TEXT = /<(?:[\w.-]+:)?(?:text|tspan|textPath)[\s>/]/i;

/**
 * Whether an SVG may be rasterized on this server. The rasterizer reads an
 * `<image>` / `<feImage>` href that names a local path from the server's own
 * disk, so every `href=` in the text (in a comment or another attribute's
 * value too) must be followed by a same-document fragment or an embedded data
 * URL — a raw value that starts with anything else, an entity or character
 * reference included, is refused. Entity declarations that could build markup
 * or an href the scan does not see are refused too, and so is one that does
 * not close.
 */
export function isRasterizableLogoSvg(svg: string): boolean {
  for (const start of svg.matchAll(ENTITY_START)) {
    const declaration = ENTITY_DECLARATION.exec(svg.slice(start.index));
    if (!declaration || UNSAFE_ENTITY.test(declaration[1])) {
      return false;
    }
  }
  for (const assignment of svg.matchAll(HREF_ASSIGNMENT)) {
    if (!SAFE_HREF_VALUE.test(svg.slice(assignment.index + assignment[0].length))) {
      return false;
    }
  }
  return true;
}

/** Whether any pixel of an RGBA pixmap is painted: its alpha byte is not zero. */
function hasInk(pixels: Uint8Array): boolean {
  for (let alpha = 3; alpha < pixels.length; alpha += 4) {
    if (pixels[alpha] !== 0) {
      return true;
    }
  }
  return false;
}

/**
 * The kit's SVG logo as a PNG for the Slides API (which takes PNG, JPEG or
 * GIF only): its longest side at MKTG_SLIDES_EXPORT_LOGO_SIDE_PX, on a
 * transparent background. Answers why not when the SVG is refused, sets
 * live text, cannot be read or drawn, or draws too big.
 *
 * No font is loaded: the runtime image ships none, so live text would draw
 * as nothing while the export reported the logo placed. A logo that sets
 * text is refused instead (`live-text`) and the deck keeps the template's
 * logo; one with its text converted to outlines draws as it is. Without the
 * system font scan, two steps still run on the event loop: the size probe
 * below, a plain parse (about 2 ms for a typical logo, about 25 ms at the
 * 2,000,000-character cap), and the PNG encode (`asPng`, which
 * un-premultiplies and deflates the drawn pixmap). Only the drawing itself
 * runs on libuv's thread pool.
 *
 * With `requireInk`, a drawing in which nothing is painted is refused
 * (`blank`) before it is encoded: the alpha of every pixel is read once,
 * about 1.4 million reads at the drawing size. The variants ask for it, so
 * a crop of empty space or a recolour that lost its content is dropped
 * rather than published as a transparent image; the primary does not, and
 * keeps its failure values as they were.
 */
export async function rasterizeLogoSvg(svg: string, options: MktgLogoPngOptions = {}): Promise<MktgLogoPngResult> {
  if (!isRasterizableLogoSvg(svg)) {
    return { png: null, reason: 'external-reference', detail: 'an href or entity that is not a fragment or an embedded image' };
  }
  if (LIVE_TEXT.test(svg)) {
    return { png: null, reason: 'live-text', detail: 'a text element, which draws as nothing without its font' };
  }
  const base: ResvgRenderOptions = { logLevel: 'off', font: { loadSystemFonts: false } };
  try {
    // Parsing first gives the SVG's own size, so the longest side is the one fitted.
    const { width, height } = new Resvg(svg, base);
    if (!(width > 0 && height > 0)) {
      return { png: null, reason: 'unreadable', detail: `size ${width}x${height}` };
    }
    const fitTo: ResvgRenderOptions['fitTo'] =
      width >= height ? { mode: 'width', value: MKTG_SLIDES_EXPORT_LOGO_SIDE_PX } : { mode: 'height', value: MKTG_SLIDES_EXPORT_LOGO_SIDE_PX };
    const rendered = await renderAsync(svg, { ...base, fitTo });
    if (options.requireInk && !hasInk(rendered.pixels)) {
      return { png: null, reason: 'blank', detail: `${rendered.width}x${rendered.height} with no painted pixel` };
    }
    const png = rendered.asPng();
    if (png.length > MKTG_SLIDES_EXPORT_LOGO_MAX_BYTES) {
      return { png: null, reason: 'too-big', detail: `${png.length} bytes` };
    }
    return { png, reason: null };
  } catch (error) {
    // resvg throws on an SVG it cannot parse or draw; the caller logs the detail.
    return { png: null, reason: 'unreadable', detail: error instanceof Error ? error.message : String(error) };
  }
}
