// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it, vi } from 'vitest';

// The shared utils barrel pulls Angular in (form.utils); the helper needs only the real brand-kit crop.
vi.mock('@lfx-one/shared/utils', async () => await vi.importActual('@lfx-one/shared/utils/brand-kit.utils'));

import { isRasterizableLogoSvg, rasterizeLogoSvg } from './mktg-logo-png.util';
import { logoPngSize, logoVariantSources, recolourLogoPngSvg } from './mktg-logo-variants.util';

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
/** A synthetic lockup: a filled mark on the left, a stroke-only rule and an unpainted group on the right. */
const LOCKUP_BODY =
  '<path d="M1 1h8v8H1z" fill="#1f6feb"/><path d="M11 5h8" stroke="#d62" stroke-width="2" fill="none"/><g fill="none"><rect x="12" y="7" width="6" height="2"/></g>';
const LOCKUP = `<svg ${SVG_NS} viewBox="0 0 20 10">${LOCKUP_BODY}</svg>`;
const WHITE_MATRIX = '0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0';
const BLACK_MATRIX = '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0';
const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

type Rgba = [number, number, number, number];

/** The pixels of an image, read back from resvg's pixmap. */
interface Pixels {
  at: (x: number, y: number) => Rgba;
  painted: () => number;
  width: number;
  height: number;
}

/** An SVG drawn at the rasterizer's size, read back as pixels. */
function draw(svg: string): Pixels {
  const image = new Resvg(svg, { logLevel: 'off', font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: 1200 } }).render();
  return pixelsOf(image.pixels, image.width, image.height);
}

/** A PNG read back as pixels, through an SVG that only places it. */
function readPng(png: Uint8Array): Pixels {
  const size = logoPngSize(png) as { width: number; height: number };
  const svg = `<svg ${SVG_NS} viewBox="0 0 ${size.width} ${size.height}"><image href="data:image/png;base64,${Buffer.from(png).toString('base64')}" width="${size.width}" height="${size.height}"/></svg>`;
  const image = new Resvg(svg, { logLevel: 'off', font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: size.width } }).render();
  return pixelsOf(image.pixels, image.width, image.height);
}

function pixelsOf(pixels: Uint8Array, width: number, height: number): Pixels {
  return {
    width,
    height,
    at: (x, y) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)) as Rgba,
    painted: () => pixels.filter((_, index) => index % 4 === 3 && pixels[index] > 0).length,
  };
}

/** The primary drawn as the service draws it, as PNG bytes. */
async function drawnPng(svg: string): Promise<Uint8Array> {
  const drawn = await rasterizeLogoSvg(svg);
  expect(drawn.reason).toBeNull();
  return drawn.png as Uint8Array;
}

describe('logoPngSize', () => {
  it('reads the pixel size from the PNG header, and nothing from bytes that are not a PNG', async () => {
    expect(logoPngSize(await drawnPng(LOCKUP))).toEqual({ width: 1200, height: 600 });
    expect(logoPngSize(new TextEncoder().encode('<svg/>'))).toBeNull();
    expect(logoPngSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe('recolourLogoPngSvg', () => {
  it('writes an SVG of its own that places the PNG under a colour-matrix filter whose region is exactly the image', async () => {
    const png = await drawnPng(LOCKUP);
    const white = recolourLogoPngSvg(png, 'white');
    expect(white).toBe(
      `<svg ${SVG_NS} viewBox="0 0 1200 600" width="1200" height="600">` +
        `<defs><filter id="lfx-one-recolour" filterUnits="userSpaceOnUse" x="0" y="0" width="1200" height="600" color-interpolation-filters="sRGB">` +
        `<feColorMatrix type="matrix" values="${WHITE_MATRIX}"/></filter></defs>` +
        `<image href="data:image/png;base64,${Buffer.from(png).toString('base64')}" x="0" y="0" width="1200" height="600" style="filter:url(#lfx-one-recolour)"/></svg>`
    );
    expect(recolourLogoPngSvg(png, 'black')).toContain(`values="${BLACK_MATRIX}"`);
    expect(recolourLogoPngSvg(new TextEncoder().encode('not a png'), 'white')).toBeNull();
  });

  it('is the same text for the same PNG, so the published variant keeps its content-addressed key', async () => {
    const png = await drawnPng(LOCKUP);
    expect(recolourLogoPngSvg(png, 'white')).toBe(recolourLogoPngSvg(png, 'white'));
  });

  it('draws every painted pixel in the ink, fills and strokes alike, keeps each pixel’s alpha, and leaves the background transparent', async () => {
    const soft = `<svg ${SVG_NS} viewBox="0 0 20 10">${LOCKUP_BODY}<rect x="12" y="1" width="6" height="2" fill="#0a0" fill-opacity="0.5"/></svg>`;
    const original = draw(soft);
    expect(original.at(300, 300)).toEqual([31, 111, 235, 255]);
    expect(original.at(900, 300)).toEqual([221, 102, 34, 255]);
    expect(original.at(900, 120)[3]).toBeGreaterThan(100);
    expect(original.at(900, 120)[3]).toBeLessThan(160);

    const white = draw(recolourLogoPngSvg(await drawnPng(soft), 'white') as string);
    expect(white.at(300, 300)).toEqual(WHITE);
    expect(white.at(900, 300)).toEqual(WHITE);
    // The half-transparent rectangle keeps its alpha and takes the ink (premultiplied in the pixmap: white at half alpha).
    expect(white.at(900, 120)[3]).toBe(original.at(900, 120)[3]);
    expect(white.at(900, 120)[0]).toBe(white.at(900, 120)[3]);
    expect(white.at(0, 0)).toEqual(CLEAR);
    expect(white.at(1199, 599)).toEqual(CLEAR);
    // An unpainted group stays unpainted: the alpha row is the identity.
    expect(white.at(900, 480)).toEqual(CLEAR);
    expect(white.painted()).toBe(original.painted());

    const black = draw(recolourLogoPngSvg(await drawnPng(soft), 'black') as string);
    expect(black.at(300, 300)).toEqual(BLACK);
    expect(black.at(900, 300)).toEqual(BLACK);
    expect(black.at(900, 120)).toEqual([0, 0, 0, original.at(900, 120)[3]]);
    expect(black.at(0, 0)).toEqual(CLEAR);
  });

  it('passes the rasterizer’s own rules and keeps the size rule per drawn PNG', async () => {
    const white = recolourLogoPngSvg(await drawnPng(LOCKUP), 'white') as string;
    expect(isRasterizableLogoSvg(white)).toBe(true);
    const drawn = await rasterizeLogoSvg(white, { requireInk: true });
    expect(drawn.reason).toBeNull();
    expect(logoPngSize(drawn.png as Uint8Array)).toEqual({ width: 1200, height: 600 });
    expect(readPng(drawn.png as Uint8Array).at(300, 300)).toEqual(WHITE);
  });

  it('never reads the logo’s own markup, so every root shape the rasterizer draws recolours whole, and one it draws empty is blank', async () => {
    const mark = (root: string, body = '<path d="M501 501h80v80h-80z" fill="#1f6feb"/>'): string => `<svg ${root}>${body}</svg>`;
    const ns = `xmlns="http://www.w3.org/2000/svg"`;
    const shapes: string[] = [
      mark(`${ns} viewBox='500 500 200 100'`),
      mark(`${ns} viewbox="500 500 200 100" width="200" height="100"`, '<path d="M1 1h80v80H1z" fill="#1f6feb"/>'),
      mark(`${ns} viewBox="&#53;00 500 200 100"`),
      mark(`${ns} aria-label='x viewBox="0 0 20 10"' viewBox="500 500 200 100"`),
      mark(`${ns} viewBox="500-500 200 100"`),
      mark(`${ns} viewBox="500\u00a0500\u3000200\u2003100" width="200" height="100"`, '<path d="M1 1h80v80H1z" fill="#1f6feb"/>'),
      mark(`${ns} viewBox="500,,500,200,100" width="200" height="100"`, '<path d="M1 1h80v80H1z" fill="#1f6feb"/>'),
      mark(`${ns} xmlns:s="http://www.w3.org/2000/svg" s:viewBox="500 500 200 100"`),
      mark(`${ns} viewBox="0 0 200 100" transform="translate(1000 1000)"`, '<path d="M1 1h80v80H1z" fill="#1f6feb"/>'),
      mark(`${ns} viewBox="0 0 200 100" transform="scale(0.5)"`, '<path d="M1 1h80v80H1z" fill="#1f6feb"/>'),
      mark(`${ns} data-x="a/>" data-y="b>c" viewBox="500 500 200 100"`),
      `<!-- <svg viewBox="0 0 1 1"> -->${mark(`${ns} viewBox="500 500 200 100"`)}<!-- </svg> -->`,
      `<svg ${ns} viewBox="500 500 200 100"><path d="M501 501h80v80h-80z" fill="#1f6feb"/></svg >`,
      `<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="500 500 200 100"><svg ${ns} viewBox="500 500 200 100"><path d="M501 501h80v80h-80z" fill="#1f6feb"/></svg></s:svg>`,
      mark(`${ns} viewBox="500 500 200 100" ${Array.from({ length: 100_000 }, () => `data-a="x"`).join(' ')}`),
    ];
    let drawnWhole = 0;
    let blank = 0;
    const started = performance.now();
    for (const svg of shapes) {
      // The primary is drawn as today; a shape the rasterizer refuses has no variants at all.
      const primary = await rasterizeLogoSvg(svg);
      if (primary.png === null) {
        expect(primary.reason, svg.slice(0, 80)).toBe('unreadable');
        continue;
      }
      const plain = readPng(primary.png);
      const white = await rasterizeLogoSvg(recolourLogoPngSvg(primary.png, 'white') as string, { requireInk: true });
      if (plain.painted() === 0) {
        expect(white, svg.slice(0, 80)).toMatchObject({ png: null, reason: 'blank' });
        blank += 1;
        continue;
      }
      expect(white.reason, svg.slice(0, 80)).toBeNull();
      const recoloured = readPng(white.png as Uint8Array);
      expect(recoloured.painted(), svg.slice(0, 80)).toBe(plain.painted());
      expect(recoloured.painted(), svg.slice(0, 80)).toBeGreaterThan(0);
      drawnWhole += 1;
    }
    // Most shapes draw; the translated root draws off its canvas and is blank; the rest never reach a variant.
    expect(drawnWhole).toBeGreaterThanOrEqual(8);
    expect(blank).toBeGreaterThanOrEqual(1);
    expect(drawnWhole + blank).toBeLessThanOrEqual(shapes.length);
    // Nothing here parses the root: the shapes cost the rasterizer's draws and no more.
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it('settles a root with a hundred thousand repeated attributes in bounded time: nothing of the server’s reads the root', async () => {
    const svg = `<svg ${SVG_NS} viewBox="0 0 20 10" ${Array.from({ length: 100_000 }, () => `data-a="x"`).join(' ')}>${LOCKUP_BODY}</svg>`;
    const files = { primary: { ref: 'logo.svg', svg }, stacked: null, symbol: { ref: 'symbol.svg', svg }, reversed: null };
    const started = performance.now();
    // The sources name the uploads and the recolours without reading them; the rasterizer refuses the repeat at once.
    const sources = logoVariantSources(files, null);
    expect(sources.symbol).toEqual({ kind: 'svg', svg, derived: false });
    expect(await rasterizeLogoSvg(svg)).toMatchObject({ png: null, reason: 'unreadable' });
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('logoVariantSources', () => {
  const none = { primary: null, stacked: null, symbol: null, reversed: null };
  const primary = { ref: 'logo.svg', svg: LOCKUP };
  const crop = { kind: 'svg', svg: `<svg ${SVG_NS} viewBox="0 0 10 10">${LOCKUP_BODY}</svg>`, derived: true };
  const reversedOfPrimary = { kind: 'recolour', of: 'primary', ink: 'white' };
  const oneColour = { kind: 'recolour', of: 'primary', ink: 'black' };
  const reversedSymbol = { kind: 'recolour', of: 'symbol', ink: 'white' };

  it('derives nothing without a primary SVG', () => {
    expect(logoVariantSources(none, '0 0 10 10')).toEqual({});
    expect(logoVariantSources({ ...none, primary: { ref: 'logo.png', svg: null } }, '0 0 10 10')).toEqual({});
  });

  it('recolours the drawn primary for the reversed and one-colour lockups, and names no symbol without a viewBox or a symbol file', () => {
    expect(logoVariantSources({ ...none, primary }, null)).toEqual({ reversed: reversedOfPrimary, one_color: oneColour });
  });

  it('crops the symbol out of the primary with the shared viewBox helper, and recolours that drawn crop for the reversed symbol', async () => {
    const sources = logoVariantSources({ ...none, primary }, '0 0 10 10');
    expect(sources).toEqual({ symbol: crop, symbol_reversed: reversedSymbol, reversed: reversedOfPrimary, one_color: oneColour });
    // The crop is square, so the symbol PNGs are drawn square at the drawing size; the reversed symbol is the crop in white.
    const symbol = await rasterizeLogoSvg(crop.svg, { requireInk: true });
    expect(logoPngSize(symbol.png as Uint8Array)).toEqual({ width: 1200, height: 1200 });
    const reversed = await rasterizeLogoSvg(recolourLogoPngSvg(symbol.png as Uint8Array, 'white') as string, { requireInk: true });
    const pixels = readPng(reversed.png as Uint8Array);
    expect(pixels.width).toBe(pixels.height);
    expect(pixels.at(600, 600)).toEqual(WHITE);
    expect(pixels.at(10, 10)).toEqual(CLEAR);
    expect(pixels.painted()).toBe(readPng(symbol.png as Uint8Array).painted());
  });

  it('crops a symbol out of the right of the lockup whole: the rasterizer, not the server, reads the crop box', async () => {
    const sources = logoVariantSources({ ...none, primary }, '10 0 10 10');
    expect(sources.symbol).toEqual({ kind: 'svg', svg: `<svg ${SVG_NS} viewBox="10 0 10 10">${LOCKUP_BODY}</svg>`, derived: true });
    const symbol = await rasterizeLogoSvg((sources.symbol as { svg: string }).svg, { requireInk: true });
    const reversed = await rasterizeLogoSvg(recolourLogoPngSvg(symbol.png as Uint8Array, 'white') as string, { requireInk: true });
    const pixels = readPng(reversed.png as Uint8Array);
    // The crop holds the stroke-only rule, drawn white across its middle, and no mark.
    expect(pixels.painted()).toBe(readPng(symbol.png as Uint8Array).painted());
    expect(pixels.at(600, 600)).toEqual(WHITE);
    expect(pixels.at(600, 120)).toEqual(CLEAR);
  });

  it('refuses a symbol cropped out of empty space as blank, so it is dropped rather than published transparent', async () => {
    const sources = logoVariantSources({ ...none, primary }, '10 0 10 3');
    expect(await rasterizeLogoSvg((sources.symbol as { svg: string }).svg, { requireInk: true })).toMatchObject({ png: null, reason: 'blank' });
  });

  it('drops a width and height from the cropped root, so the crop fills its box', () => {
    const sized = { ref: 'logo.svg', svg: `<svg ${SVG_NS} width="200" height="100" viewBox="0 0 20 10">${LOCKUP_BODY}</svg>` };
    expect(logoVariantSources({ ...none, primary: sized }, '0 0 10 10').symbol).toEqual(crop);
  });

  it('lets an uploaded symbol or reversed SVG win over derivation, and recolours the symbol, never the reversed file', () => {
    const symbolFile = { ref: 'symbol.svg', svg: `<svg ${SVG_NS} viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="#1f6feb"/></svg>` };
    const reversedFile = { ref: 'reversed.svg', svg: `<svg ${SVG_NS} viewBox="0 0 20 10"><path d="M1 1h8v8H1z" fill="#fff"/></svg>` };
    expect(logoVariantSources({ ...none, primary, symbol: symbolFile, reversed: reversedFile }, '0 0 10 10')).toEqual({
      symbol: { kind: 'svg', svg: symbolFile.svg, derived: false },
      symbol_reversed: reversedSymbol,
      reversed: { kind: 'svg', svg: reversedFile.svg, derived: false },
      one_color: oneColour,
    });
  });

  it('falls back to the crop and the recolour when the uploaded symbol or reversed file is not an SVG', () => {
    const sources = logoVariantSources(
      { ...none, primary, symbol: { ref: 'symbol.png', svg: null }, reversed: { ref: 'reversed.png', svg: null } },
      '0 0 10 10'
    );
    expect(sources.symbol).toEqual(crop);
    expect(sources.reversed).toEqual(reversedOfPrimary);
  });
});
