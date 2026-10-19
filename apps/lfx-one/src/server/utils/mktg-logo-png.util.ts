// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_SLIDES_EXPORT_LOGO_MAX_BYTES, MKTG_SLIDES_EXPORT_LOGO_SIDE_PX } from '@lfx-one/shared/constants';
import { MktgLogoPngResult } from '@lfx-one/shared/interfaces';
import { renderAsync, Resvg, ResvgRenderOptions } from '@resvg/resvg-js';

/** Every `href` / `xlink:href` value as written in the source, before the XML parser resolves it. */
const HREF_ATTRIBUTE = /\bhref\s*=\s*(["'])([\s\S]*?)\1/gi;
/** The only references the rasterizer may follow: a fragment in the same SVG, or an image embedded as a data URL. */
const SAFE_HREF = /^(?:#|data:image\/(?:png|jpeg|gif|webp);)/i;
/** Entity declarations: an external one, a parameter one, or one whose text carries markup or references. */
const ENTITY_DECLARATION = /<!ENTITY\b[^>]*>/gi;
const UNSAFE_ENTITY = /\b(?:SYSTEM|PUBLIC)\b|[<&%]/i;

/**
 * Whether an SVG may be rasterized on this server. The rasterizer reads an
 * `<image>` / `<feImage>` href that names a local path from the server's own
 * disk, so anything but a same-document fragment or an embedded data URL is
 * refused (a raw value that does not start with one of those — an entity or
 * character reference included — is refused too), and so are entity
 * declarations that could build markup or an href the check above did not see.
 */
export function isRasterizableLogoSvg(svg: string): boolean {
  for (const declaration of svg.match(ENTITY_DECLARATION) ?? []) {
    if (UNSAFE_ENTITY.test(declaration.slice('<!ENTITY'.length))) {
      return false;
    }
  }
  for (const match of svg.matchAll(HREF_ATTRIBUTE)) {
    if (!SAFE_HREF.test(match[2])) {
      return false;
    }
  }
  return true;
}

/**
 * The kit's SVG logo as a PNG for the Slides API (which takes PNG, JPEG or
 * GIF only): its longest side at MKTG_SLIDES_EXPORT_LOGO_SIDE_PX, on a
 * transparent background. Rendered off the event loop. Answers why not when
 * the SVG is refused, cannot be read or drawn, or draws too big.
 */
export async function rasterizeLogoSvg(svg: string): Promise<MktgLogoPngResult> {
  if (!isRasterizableLogoSvg(svg)) {
    return { png: null, reason: 'external-reference', detail: 'an href or entity that is not a fragment or an embedded image' };
  }
  const base: ResvgRenderOptions = { logLevel: 'off' };
  try {
    // Parsing first gives the SVG's own size, so the longest side is the one fitted.
    const { width, height } = new Resvg(svg, base);
    if (!(width > 0 && height > 0)) {
      return { png: null, reason: 'unreadable', detail: `size ${width}x${height}` };
    }
    const fitTo: ResvgRenderOptions['fitTo'] =
      width >= height ? { mode: 'width', value: MKTG_SLIDES_EXPORT_LOGO_SIDE_PX } : { mode: 'height', value: MKTG_SLIDES_EXPORT_LOGO_SIDE_PX };
    const png = (await renderAsync(svg, { ...base, fitTo })).asPng();
    if (png.length > MKTG_SLIDES_EXPORT_LOGO_MAX_BYTES) {
      return { png: null, reason: 'too-big', detail: `${png.length} bytes` };
    }
    return { png, reason: null };
  } catch (error) {
    // resvg throws on an SVG it cannot parse or draw; the caller logs the detail.
    return { png: null, reason: 'unreadable', detail: error instanceof Error ? error.message : String(error) };
  }
}
