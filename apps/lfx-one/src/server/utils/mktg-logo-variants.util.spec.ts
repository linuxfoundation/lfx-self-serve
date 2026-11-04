// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it, vi } from 'vitest';

// The shared utils barrel pulls Angular in (form.utils); the helper needs only the real brand-kit crop.
vi.mock('@lfx-one/shared/utils', async () => await vi.importActual('@lfx-one/shared/utils/brand-kit.utils'));

import { isRasterizableLogoSvg, rasterizeLogoSvg } from './mktg-logo-png.util';
import { logoSvgUserSpace, logoVariantSvgSources, recolourLogoSvg } from './mktg-logo-variants.util';

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
/** A synthetic lockup: a filled mark on the left, a stroke-only rule and an unpainted group on the right. */
const LOCKUP_BODY =
  '<path d="M1 1h8v8H1z" fill="#1f6feb"/><path d="M11 5h8" stroke="#d62" stroke-width="2" fill="none"/><g fill="none"><rect x="12" y="7" width="6" height="2"/></g>';
const LOCKUP = `<svg ${SVG_NS} viewBox="0 0 20 10">${LOCKUP_BODY}</svg>`;
const WHITE_MATRIX = '0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0';
const BLACK_MATRIX = '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0';
const WHITE: Rgba = [255, 255, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

type Rgba = [number, number, number, number];

/** The drawn pixels of an SVG at 200px wide, read back from resvg's pixmap. */
function draw(svg: string): { at: (x: number, y: number) => Rgba; painted: () => number; width: number; height: number } {
  const image = new Resvg(svg, { logLevel: 'off', font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: 200 } }).render();
  const pixels = image.pixels;
  return {
    width: image.width,
    height: image.height,
    at: (x, y) => Array.from(pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)) as Rgba,
    painted: () => pixels.filter((_, index) => index % 4 === 3 && pixels[index] > 0).length,
  };
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = Buffer.from(bytes);
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}

/** A mark drawn inside a viewBox that starts away from the origin. */
function offsetMark(viewBox: string): string {
  const [minX, minY] = viewBox.split(' ').map(Number);
  return `<svg ${SVG_NS} viewBox="${viewBox}"><path d="M${minX + 1} ${minY + 1}h8v8h-8z" fill="#1f6feb"/></svg>`;
}

describe('logoSvgUserSpace', () => {
  it('reads the root viewBox, with commas or exponents, as the user space', () => {
    expect(logoSvgUserSpace(LOCKUP)).toEqual({ minX: 0, minY: 0, width: 20, height: 10 });
    expect(logoSvgUserSpace(`<svg ${SVG_NS} viewBox="-50,-50, 3e2 300"/>`)).toEqual({ minX: -50, minY: -50, width: 300, height: 300 });
  });

  it('falls back to a width and height in user units from the origin, and to nothing otherwise', () => {
    expect(logoSvgUserSpace(`<svg ${SVG_NS} width="200" height="100px"/>`)).toEqual({ minX: 0, minY: 0, width: 200, height: 100 });
    expect(logoSvgUserSpace(`<svg ${SVG_NS} width="100%" height="100"/>`)).toBeNull();
    expect(logoSvgUserSpace(`<svg ${SVG_NS} width="200"/>`)).toBeNull();
    expect(logoSvgUserSpace(`<svg ${SVG_NS} viewBox="0 0 0 10"/>`)).toBeNull();
    expect(logoSvgUserSpace(`<svg ${SVG_NS}/>`)).toBeNull();
    expect(logoSvgUserSpace('not an svg')).toBeNull();
  });
});

describe('recolourLogoSvg', () => {
  it('declares one colour-matrix filter over the root’s user space after the root tag and wraps the root’s content in a group that applies it inline', () => {
    const white = recolourLogoSvg(LOCKUP, 'white');
    expect(white).toBe(
      `<svg ${SVG_NS} viewBox="0 0 20 10">` +
        `<defs><filter id="lfx-one-recolour" filterUnits="userSpaceOnUse" x="-2" y="-1" width="24" height="12" color-interpolation-filters="sRGB">` +
        `<feColorMatrix type="matrix" values="${WHITE_MATRIX}"/></filter></defs>` +
        `<g style="filter:url(#lfx-one-recolour)">${LOCKUP_BODY}</g></svg>`
    );
    expect(recolourLogoSvg(LOCKUP, 'black')).toContain(`values="${BLACK_MATRIX}"`);
  });

  it('sets the region from the root’s own viewBox, or from its size when it has none', () => {
    expect(recolourLogoSvg(offsetMark('300 0 100 100'), 'white')).toContain('x="290" y="-10" width="120" height="120"');
    expect(recolourLogoSvg(offsetMark('-50 -50 300 300'), 'white')).toContain('x="-80" y="-80" width="360" height="360"');
    expect(recolourLogoSvg(`<svg ${SVG_NS} width="20" height="10">${LOCKUP_BODY}</svg>`, 'white')).toContain('x="-2" y="-1" width="24" height="12"');
  });

  it('is the same transform for the same input, so the published PNG keeps its content-addressed key', () => {
    expect(recolourLogoSvg(LOCKUP, 'white')).toBe(recolourLogoSvg(LOCKUP, 'white'));
  });

  it('leaves a self-closing root, which paints nothing, as it is', () => {
    expect(recolourLogoSvg(`<svg ${SVG_NS} viewBox="0 0 10 3"/>`, 'white')).toBe(`<svg ${SVG_NS} viewBox="0 0 10 3"/>`);
  });

  it('refuses, with null, an SVG it cannot wrap or place a region in, rather than hand back the colour original', () => {
    expect(recolourLogoSvg('not an svg', 'white')).toBeNull();
    // No closing tag after the root.
    expect(recolourLogoSvg(`<svg ${SVG_NS} viewBox="0 0 10 10"><path d="M0 0h1v1z"/>`, 'white')).toBeNull();
    // A closing tag spelled with a space, which the wrapper does not match.
    expect(recolourLogoSvg(`<svg ${SVG_NS} viewBox="0 0 10 10"><path d="M0 0h1v1z"/></svg >`, 'white')).toBeNull();
    // A prefixed root.
    expect(recolourLogoSvg(`<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><svg:path d="M0 0h1v1z"/></svg:svg>`, 'white')).toBeNull();
    // No user space to set the region in.
    expect(recolourLogoSvg(`<svg ${SVG_NS}><path d="M0 0h1v1z"/></svg>`, 'white')).toBeNull();
    expect(recolourLogoSvg(`<svg ${SVG_NS} width="100%" height="100%"><path d="M0 0h1v1z"/></svg>`, 'white')).toBeNull();
  });

  it('draws every painted pixel in the ink, fills and strokes alike, on a transparent background', () => {
    const original = draw(LOCKUP);
    expect(original.at(50, 50)).toEqual([31, 111, 235, 255]);
    expect(original.at(150, 50)).toEqual([221, 102, 34, 255]);

    const white = draw(recolourLogoSvg(LOCKUP, 'white') as string);
    expect(white.at(50, 50)).toEqual(WHITE);
    expect(white.at(150, 50)).toEqual(WHITE);
    expect(white.at(0, 0)).toEqual(CLEAR);
    expect(white.at(199, 99)).toEqual(CLEAR);
    // An unpainted group stays unpainted: the alpha row is the identity.
    expect(white.at(150, 80)).toEqual(CLEAR);

    const black = draw(recolourLogoSvg(LOCKUP, 'black') as string);
    expect(black.at(50, 50)).toEqual([0, 0, 0, 255]);
    expect(black.at(150, 50)).toEqual([0, 0, 0, 255]);
    expect(black.at(0, 0)).toEqual(CLEAR);
  });

  it('keeps a stroke-only line, whose bounding box has no area, by filtering in user space', () => {
    const rule = `<svg ${SVG_NS} viewBox="0 0 20 10"><path d="M1 5h18" stroke="#d62" stroke-width="2" fill="none"/></svg>`;
    expect(draw(recolourLogoSvg(rule, 'white') as string).at(100, 50)).toEqual(WHITE);
  });

  it('draws the whole mark when the viewBox starts away from the origin, on either side of it', () => {
    for (const viewBox of ['300 0 100 100', '500 500 200 100', '-50 -50 300 300']) {
      const original = draw(offsetMark(viewBox));
      const white = draw(recolourLogoSvg(offsetMark(viewBox), 'white') as string);
      expect(white.painted(), viewBox).toBe(original.painted());
      expect(white.painted(), viewBox).toBeGreaterThan(0);
      // The mark sits one unit in from the viewBox's corner: its first pixels are the ink, the far corner is clear.
      const unit = 200 / Number(viewBox.split(' ')[2]);
      expect(white.at(Math.ceil(unit * 2), Math.ceil(unit * 2)), viewBox).toEqual(WHITE);
      expect(white.at(white.width - 1, white.height - 1), viewBox).toEqual(CLEAR);
    }
  });

  it('is not overridden by a filter the logo’s own stylesheet sets on groups', () => {
    const styled = `<svg ${SVG_NS} viewBox="0 0 20 10"><style>g{filter:none}</style>${LOCKUP_BODY}</svg>`;
    expect(draw(recolourLogoSvg(styled, 'white') as string).at(50, 50)).toEqual(WHITE);
  });

  it('adds nothing the rasterizer refuses, and keeps the size rule per drawn PNG', async () => {
    const white = recolourLogoSvg(LOCKUP, 'white') as string;
    expect(isRasterizableLogoSvg(white)).toBe(true);
    const drawn = await rasterizeLogoSvg(white);
    expect(drawn.reason).toBeNull();
    expect(pngSize(drawn.png as Uint8Array)).toEqual({ width: 1200, height: 600 });
  });
});

describe('logoVariantSvgSources', () => {
  const none = { primary: null, stacked: null, symbol: null, reversed: null };
  const primary = { ref: 'logo.svg', svg: LOCKUP };
  const derived = (svg: string | null | undefined) => ({ svg, derived: true });
  const uploaded = (svg: string | null | undefined) => ({ svg, derived: false });

  it('derives nothing without a primary SVG', () => {
    expect(logoVariantSvgSources(none, '0 0 10 10')).toEqual({});
    expect(logoVariantSvgSources({ ...none, primary: { ref: 'logo.png', svg: null } }, '0 0 10 10')).toEqual({});
  });

  it('derives the reversed and one-colour lockups from the primary, and no symbol without a viewBox or a symbol file', () => {
    const sources = logoVariantSvgSources({ ...none, primary }, null);
    expect(Object.keys(sources).sort()).toEqual(['one_color', 'reversed']);
    expect(sources.reversed).toEqual(derived(recolourLogoSvg(LOCKUP, 'white')));
    expect(sources.one_color).toEqual(derived(recolourLogoSvg(LOCKUP, 'black')));
  });

  it('crops the symbol out of the primary with the shared viewBox helper, and reverses that crop for the reversed symbol', async () => {
    const sources = logoVariantSvgSources({ ...none, primary }, '0 0 10 10');
    expect(Object.keys(sources).sort()).toEqual(['one_color', 'reversed', 'symbol', 'symbol_reversed']);
    // The crop box becomes the root viewBox; the content is untouched.
    expect(sources.symbol).toEqual(derived(`<svg ${SVG_NS} viewBox="0 0 10 10">${LOCKUP_BODY}</svg>`));
    expect(sources.symbol_reversed).toEqual(derived(recolourLogoSvg(sources.symbol?.svg as string, 'white')));
    // The crop is square, so each symbol PNG is drawn square at the drawing size; the lockups keep their 2:1.
    expect(pngSize((await rasterizeLogoSvg(sources.symbol?.svg as string)).png as Uint8Array)).toEqual({ width: 1200, height: 1200 });
    expect(pngSize((await rasterizeLogoSvg(sources.symbol_reversed?.svg as string)).png as Uint8Array)).toEqual({ width: 1200, height: 1200 });
    expect(pngSize((await rasterizeLogoSvg(sources.reversed?.svg as string)).png as Uint8Array)).toEqual({ width: 1200, height: 600 });
    expect(pngSize((await rasterizeLogoSvg(sources.one_color?.svg as string)).png as Uint8Array)).toEqual({ width: 1200, height: 600 });
    // The reversed symbol is the crop in white: the mark is drawn white, the rule to the right of the crop is gone.
    const reversedSymbol = draw(sources.symbol_reversed?.svg as string);
    expect(reversedSymbol.width).toBe(reversedSymbol.height);
    expect(reversedSymbol.at(100, 100)).toEqual(WHITE);
    expect(reversedSymbol.at(2, 2)).toEqual(CLEAR);
  });

  it('reverses a symbol cropped out of the right of the lockup whole: the region follows the crop box', () => {
    const sources = logoVariantSvgSources({ ...none, primary }, '10 0 10 10');
    expect(sources.symbol?.svg).toBe(`<svg ${SVG_NS} viewBox="10 0 10 10">${LOCKUP_BODY}</svg>`);
    const reversedSymbol = draw(sources.symbol_reversed?.svg as string);
    // The crop holds the stroke-only rule, drawn white across its middle, and no mark.
    expect(reversedSymbol.painted()).toBe(draw(sources.symbol?.svg as string).painted());
    expect(reversedSymbol.at(100, 100)).toEqual(WHITE);
    expect(reversedSymbol.at(100, 20)).toEqual(CLEAR);
  });

  it('drops a width and height from the cropped root, so the crop fills its box', () => {
    const sized = { ref: 'logo.svg', svg: `<svg ${SVG_NS} width="200" height="100" viewBox="0 0 20 10">${LOCKUP_BODY}</svg>` };
    expect(logoVariantSvgSources({ ...none, primary: sized }, '0 0 10 10').symbol).toEqual(derived(`<svg ${SVG_NS} viewBox="0 0 10 10">${LOCKUP_BODY}</svg>`));
  });

  it('lets an uploaded symbol or reversed SVG win over derivation, and reverses the symbol file, never the reversed file', () => {
    const symbolFile = { ref: 'symbol.svg', svg: `<svg ${SVG_NS} viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="#1f6feb"/></svg>` };
    const reversedFile = { ref: 'reversed.svg', svg: `<svg ${SVG_NS} viewBox="0 0 20 10"><path d="M1 1h8v8H1z" fill="#fff"/></svg>` };
    const sources = logoVariantSvgSources({ ...none, primary, symbol: symbolFile, reversed: reversedFile }, '0 0 10 10');
    expect(sources.symbol).toEqual(uploaded(symbolFile.svg));
    expect(sources.reversed).toEqual(uploaded(reversedFile.svg));
    expect(sources.symbol_reversed).toEqual(derived(recolourLogoSvg(symbolFile.svg, 'white')));
    expect(sources.one_color).toEqual(derived(recolourLogoSvg(LOCKUP, 'black')));
  });

  it('falls back to the crop when the uploaded symbol or reversed file is not an SVG', () => {
    const sources = logoVariantSvgSources(
      { ...none, primary, symbol: { ref: 'symbol.png', svg: null }, reversed: { ref: 'reversed.png', svg: null } },
      '0 0 10 10'
    );
    expect(sources.symbol).toEqual(derived(`<svg ${SVG_NS} viewBox="0 0 10 10">${LOCKUP_BODY}</svg>`));
    expect(sources.reversed).toEqual(derived(recolourLogoSvg(LOCKUP, 'white')));
  });

  it('leaves a recoloured variant with no source, so the caller can say so, when the primary cannot be recoloured, and keeps the ones it can', () => {
    const unspaced = { ref: 'logo.svg', svg: `<svg ${SVG_NS}>${LOCKUP_BODY}</svg>` };
    const symbolFile = { ref: 'symbol.svg', svg: `<svg ${SVG_NS} viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="#1f6feb"/></svg>` };
    expect(logoVariantSvgSources({ ...none, primary: unspaced }, null)).toEqual({ reversed: derived(null), one_color: derived(null) });
    const sources = logoVariantSvgSources({ ...none, primary: unspaced, symbol: symbolFile }, null);
    expect(sources.symbol).toEqual(uploaded(symbolFile.svg));
    expect(sources.symbol_reversed).toEqual(derived(recolourLogoSvg(symbolFile.svg, 'white')));
    expect(sources.reversed).toEqual(derived(null));
  });
});
