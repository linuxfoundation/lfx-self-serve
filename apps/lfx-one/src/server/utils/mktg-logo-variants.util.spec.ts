// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it, vi } from 'vitest';

// The shared utils barrel pulls Angular in (form.utils); the helper needs only the real brand-kit crop.
vi.mock('@lfx-one/shared/utils', async () => await vi.importActual('@lfx-one/shared/utils/brand-kit.utils'));

import { isRasterizableLogoSvg, rasterizeLogoSvg } from './mktg-logo-png.util';
import { logoVariantSvgSources, recolourLogoSvg } from './mktg-logo-variants.util';

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
/** A synthetic lockup: a filled mark on the left, a stroke-only rule and an unpainted group on the right. */
const LOCKUP_BODY =
  '<path d="M1 1h8v8H1z" fill="#1f6feb"/><path d="M11 5h8" stroke="#d62" stroke-width="2" fill="none"/><g fill="none"><rect x="12" y="7" width="6" height="2"/></g>';
const LOCKUP = `<svg ${SVG_NS} viewBox="0 0 20 10">${LOCKUP_BODY}</svg>`;
const WHITE_MATRIX = '0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0';
const BLACK_MATRIX = '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0';

type Rgba = [number, number, number, number];

/** The drawn pixels of an SVG at 200px wide, read back from resvg's pixmap. */
function draw(svg: string): { at: (x: number, y: number) => Rgba; width: number; height: number } {
  const image = new Resvg(svg, { logLevel: 'off', font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: 200 } }).render();
  const pixels = image.pixels;
  return {
    width: image.width,
    height: image.height,
    at: (x, y) => Array.from(pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)) as Rgba,
  };
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = Buffer.from(bytes);
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}

describe('recolourLogoSvg', () => {
  it('declares one colour-matrix filter after the root tag and wraps the root’s content in a group that applies it', () => {
    const white = recolourLogoSvg(LOCKUP, 'white');
    expect(white).toBe(
      `<svg ${SVG_NS} viewBox="0 0 20 10">` +
        `<defs><filter id="lfx-one-recolour" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
        `<feColorMatrix type="matrix" values="${WHITE_MATRIX}"/></filter></defs>` +
        `<g filter="url(#lfx-one-recolour)">${LOCKUP_BODY}</g></svg>`
    );
    expect(recolourLogoSvg(LOCKUP, 'black')).toContain(`values="${BLACK_MATRIX}"`);
  });

  it('leaves an SVG without a root to wrap, or with a self-closing root that paints nothing, as it is', () => {
    expect(recolourLogoSvg('not an svg', 'white')).toBe('not an svg');
    expect(recolourLogoSvg(`<svg ${SVG_NS} viewBox="0 0 10 3"/>`, 'white')).toBe(`<svg ${SVG_NS} viewBox="0 0 10 3"/>`);
    expect(recolourLogoSvg(`<svg ${SVG_NS}><path d="M0 0h1v1z"/>`, 'white')).toBe(`<svg ${SVG_NS}><path d="M0 0h1v1z"/>`);
  });

  it('draws every painted pixel in the ink, fills and strokes alike, on a transparent background', () => {
    const original = draw(LOCKUP);
    expect(original.at(50, 50)).toEqual([31, 111, 235, 255]);
    expect(original.at(150, 50)).toEqual([221, 102, 34, 255]);

    const white = draw(recolourLogoSvg(LOCKUP, 'white'));
    expect(white.at(50, 50)).toEqual([255, 255, 255, 255]);
    expect(white.at(150, 50)).toEqual([255, 255, 255, 255]);
    expect(white.at(0, 0)).toEqual([0, 0, 0, 0]);
    expect(white.at(199, 99)).toEqual([0, 0, 0, 0]);
    // An unpainted group stays unpainted: the alpha row is the identity.
    expect(white.at(150, 80)).toEqual([0, 0, 0, 0]);

    const black = draw(recolourLogoSvg(LOCKUP, 'black'));
    expect(black.at(50, 50)).toEqual([0, 0, 0, 255]);
    expect(black.at(150, 50)).toEqual([0, 0, 0, 255]);
    expect(black.at(0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('keeps a stroke-only line, whose bounding box has no area, by filtering in user space', () => {
    const rule = `<svg ${SVG_NS} viewBox="0 0 20 10"><path d="M1 5h18" stroke="#d62" stroke-width="2" fill="none"/></svg>`;
    expect(draw(recolourLogoSvg(rule, 'white')).at(100, 50)).toEqual([255, 255, 255, 255]);
  });

  it('adds nothing the rasterizer refuses, and keeps the size rule per drawn PNG', async () => {
    const white = recolourLogoSvg(LOCKUP, 'white');
    expect(isRasterizableLogoSvg(white)).toBe(true);
    const drawn = await rasterizeLogoSvg(white);
    expect(drawn.reason).toBeNull();
    expect(pngSize(drawn.png as Uint8Array)).toEqual({ width: 1200, height: 600 });
  });
});

describe('logoVariantSvgSources', () => {
  const none = { primary: null, stacked: null, symbol: null, reversed: null };
  const primary = { ref: 'logo.svg', svg: LOCKUP };

  it('derives nothing without a primary SVG', () => {
    expect(logoVariantSvgSources(none, '0 0 10 10')).toEqual({});
    expect(logoVariantSvgSources({ ...none, primary: { ref: 'logo.png', svg: null } }, '0 0 10 10')).toEqual({});
  });

  it('derives the reversed and one-colour lockups from the primary, and no symbol without a viewBox or a symbol file', () => {
    const sources = logoVariantSvgSources({ ...none, primary }, null);
    expect(Object.keys(sources).sort()).toEqual(['one_color', 'reversed']);
    expect(sources.reversed).toBe(recolourLogoSvg(LOCKUP, 'white'));
    expect(sources.one_color).toBe(recolourLogoSvg(LOCKUP, 'black'));
  });

  it('crops the symbol out of the primary with the shared viewBox helper, and reverses that crop for the reversed symbol', async () => {
    const sources = logoVariantSvgSources({ ...none, primary }, '0 0 10 10');
    expect(Object.keys(sources).sort()).toEqual(['one_color', 'reversed', 'symbol', 'symbol_reversed']);
    // The crop box becomes the root viewBox; the content is untouched.
    expect(sources.symbol).toBe(`<svg ${SVG_NS} viewBox="0 0 10 10">${LOCKUP_BODY}</svg>`);
    expect(sources.symbol_reversed).toBe(recolourLogoSvg(sources.symbol as string, 'white'));
    // The crop is square, so each symbol PNG is drawn square at the drawing size; the lockups keep their 2:1.
    expect(pngSize((await rasterizeLogoSvg(sources.symbol as string)).png as Uint8Array)).toEqual({ width: 1200, height: 1200 });
    expect(pngSize((await rasterizeLogoSvg(sources.symbol_reversed as string)).png as Uint8Array)).toEqual({ width: 1200, height: 1200 });
    expect(pngSize((await rasterizeLogoSvg(sources.reversed as string)).png as Uint8Array)).toEqual({ width: 1200, height: 600 });
    expect(pngSize((await rasterizeLogoSvg(sources.one_color as string)).png as Uint8Array)).toEqual({ width: 1200, height: 600 });
    // The reversed symbol is the crop in white: the mark is drawn white, the rule to the right of the crop is gone.
    const reversedSymbol = draw(sources.symbol_reversed as string);
    expect(reversedSymbol.width).toBe(reversedSymbol.height);
    expect(reversedSymbol.at(100, 100)).toEqual([255, 255, 255, 255]);
    expect(reversedSymbol.at(2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('drops a width and height from the cropped root, so the crop fills its box', () => {
    const sized = { ref: 'logo.svg', svg: `<svg ${SVG_NS} width="200" height="100" viewBox="0 0 20 10">${LOCKUP_BODY}</svg>` };
    expect(logoVariantSvgSources({ ...none, primary: sized }, '0 0 10 10').symbol).toBe(`<svg ${SVG_NS} viewBox="0 0 10 10">${LOCKUP_BODY}</svg>`);
  });

  it('lets an uploaded symbol or reversed SVG win over derivation, and reverses the symbol file, never the reversed file', () => {
    const symbolFile = { ref: 'symbol.svg', svg: `<svg ${SVG_NS} viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="#1f6feb"/></svg>` };
    const reversedFile = { ref: 'reversed.svg', svg: `<svg ${SVG_NS} viewBox="0 0 20 10"><path d="M1 1h8v8H1z" fill="#fff"/></svg>` };
    const sources = logoVariantSvgSources({ ...none, primary, symbol: symbolFile, reversed: reversedFile }, '0 0 10 10');
    expect(sources.symbol).toBe(symbolFile.svg);
    expect(sources.reversed).toBe(reversedFile.svg);
    expect(sources.symbol_reversed).toBe(recolourLogoSvg(symbolFile.svg, 'white'));
    expect(sources.one_color).toBe(recolourLogoSvg(LOCKUP, 'black'));
  });

  it('falls back to the crop when the uploaded symbol or reversed file is not an SVG', () => {
    const sources = logoVariantSvgSources(
      { ...none, primary, symbol: { ref: 'symbol.png', svg: null }, reversed: { ref: 'reversed.png', svg: null } },
      '0 0 10 10'
    );
    expect(sources.symbol).toBe(`<svg ${SVG_NS} viewBox="0 0 10 10">${LOCKUP_BODY}</svg>`);
    expect(sources.reversed).toBe(recolourLogoSvg(LOCKUP, 'white'));
  });
});
