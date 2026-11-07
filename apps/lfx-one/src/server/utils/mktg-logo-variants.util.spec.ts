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

  it('never reads the logo’s own markup: each root shape the rasterizer draws recolours whole, one it draws empty is blank, one it refuses has no variant', async () => {
    const mark = (root: string, body = '<path d="M501 501h80v80h-80z" fill="#1f6feb"/>'): string => `<svg ${root}>${body}</svg>`;
    const ns = `xmlns="http://www.w3.org/2000/svg"`;
    const nearOrigin = '<path d="M1 1h80v80H1z" fill="#1f6feb"/>';
    // Each shape with the outcome the rasterizer gives it today, pinned: a change in either direction is a change to look at.
    const shapes: { name: string; svg: string; outcome: 'drawn' | 'blank' | 'refused' }[] = [
      { name: 'single-quoted viewBox', svg: mark(`${ns} viewBox='500 500 200 100'`), outcome: 'drawn' },
      { name: 'lowercase viewbox decoy with a size', svg: mark(`${ns} viewbox="500 500 200 100" width="200" height="100"`, nearOrigin), outcome: 'drawn' },
      { name: 'character reference in the viewBox', svg: mark(`${ns} viewBox="&#53;00 500 200 100"`), outcome: 'drawn' },
      { name: 'decoy viewBox inside another value', svg: mark(`${ns} aria-label='x viewBox="0 0 20 10"' viewBox="500 500 200 100"`), outcome: 'drawn' },
      {
        name: 'numbers run together (read as 500 -500 200 100, so the mark is off the canvas)',
        svg: mark(`${ns} viewBox="500-500 200 100"`),
        outcome: 'blank',
      },
      {
        name: 'Unicode whitespace in the viewBox',
        svg: mark(`${ns} viewBox="500\u00a0500\u3000200\u2003100" width="200" height="100"`, nearOrigin),
        outcome: 'drawn',
      },
      { name: 'comma runs in the viewBox', svg: mark(`${ns} viewBox="500,,500,200,100" width="200" height="100"`, nearOrigin), outcome: 'drawn' },
      { name: 'prefixed s:viewBox', svg: mark(`${ns} xmlns:s="http://www.w3.org/2000/svg" s:viewBox="500 500 200 100"`), outcome: 'drawn' },
      { name: 'root transform translate(1000 1000)', svg: mark(`${ns} viewBox="0 0 200 100" transform="translate(1000 1000)"`, nearOrigin), outcome: 'blank' },
      { name: 'root transform scale(0.5)', svg: mark(`${ns} viewBox="0 0 200 100" transform="scale(0.5)"`, nearOrigin), outcome: 'drawn' },
      { name: '/> and > inside values', svg: mark(`${ns} data-x="a/>" data-y="b>c" viewBox="500 500 200 100"`), outcome: 'drawn' },
      {
        name: 'comment decoys around the root',
        svg: `<!-- <svg viewBox="0 0 1 1"> -->${mark(`${ns} viewBox="500 500 200 100"`)}<!-- </svg> -->`,
        outcome: 'drawn',
      },
      { name: 'closing tag with a space', svg: `<svg ${ns} viewBox="500 500 200 100"><path d="M501 501h80v80h-80z" fill="#1f6feb"/></svg >`, outcome: 'drawn' },
      {
        name: 'prefixed root with a nested plain svg (the nested viewport sits at 0 0, off the outer crop box)',
        svg: `<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="500 500 200 100"><svg ${ns} viewBox="500 500 200 100"><path d="M501 501h80v80h-80z" fill="#1f6feb"/></svg></s:svg>`,
        outcome: 'blank',
      },
      {
        name: '100k repeated attributes',
        svg: mark(`${ns} viewBox="500 500 200 100" ${Array.from({ length: 100_000 }, () => `data-a="x"`).join(' ')}`),
        outcome: 'refused',
      },
    ];
    for (const { name, svg, outcome } of shapes) {
      // The primary is drawn as today; a shape the rasterizer refuses has no variants at all.
      const primary = await rasterizeLogoSvg(svg);
      if (outcome === 'refused') {
        expect(primary, name).toMatchObject({ png: null, reason: 'unreadable' });
        continue;
      }
      expect(primary.reason, name).toBeNull();
      const plain = readPng(primary.png as Uint8Array);
      const white = await rasterizeLogoSvg(recolourLogoPngSvg(primary.png as Uint8Array, 'white') as string, { requireInk: true });
      if (outcome === 'blank') {
        expect(plain.painted(), name).toBe(0);
        expect(white, name).toMatchObject({ png: null, reason: 'blank' });
        continue;
      }
      expect(white.reason, name).toBeNull();
      const recoloured = readPng(white.png as Uint8Array);
      expect(recoloured.painted(), name).toBe(plain.painted());
      expect(recoloured.painted(), name).toBeGreaterThan(0);
    }
  }, 60_000);

  it('settles a root with a hundred thousand repeated attributes in bounded time: nothing of the server’s reads the root', async () => {
    const svg = `<svg ${SVG_NS} viewBox="0 0 20 10" ${Array.from({ length: 100_000 }, () => `data-a="x"`).join(' ')}>${LOCKUP_BODY}</svg>`;
    const files = { primary: { ref: 'logo.svg', svg }, stacked: null, symbol: { ref: 'symbol.svg', svg }, reversed: null };
    const started = performance.now();
    // The sources name the uploads and the recolours without reading them, in constant time.
    const sources = logoVariantSources(files, null);
    expect(performance.now() - started).toBeLessThan(50);
    expect(sources.symbol).toEqual({ kind: 'svg', svg, derived: false });
    // The rasterizer, in its child, refuses the repeat; how long its parser takes is its own affair.
    expect(await rasterizeLogoSvg(svg)).toMatchObject({ png: null, reason: 'unreadable' });
  });
});

describe('logoVariantSources', () => {
  const none = { primary: null, stacked: null, symbol: null, reversed: null };
  /** The lockup in one ink (its rule in the mark's blue): single-colour artwork, which the recolours are derived from. */
  const MONO_BODY = LOCKUP_BODY.replace('stroke="#d62"', 'stroke="#1f6feb"');
  const MONO_LOCKUP = `<svg ${SVG_NS} viewBox="0 0 20 10">${MONO_BODY}</svg>`;
  const primary = { ref: 'logo.svg', svg: MONO_LOCKUP };
  const crop = { kind: 'svg', svg: `<svg ${SVG_NS} viewBox="0 0 10 10">${MONO_BODY}</svg>`, derived: true };
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
    expect(sources.symbol).toEqual({ kind: 'svg', svg: `<svg ${SVG_NS} viewBox="10 0 10 10">${MONO_BODY}</svg>`, derived: true });
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
    const sized = { ref: 'logo.svg', svg: `<svg ${SVG_NS} width="200" height="100" viewBox="0 0 20 10">${MONO_BODY}</svg>` };
    expect(logoVariantSources({ ...none, primary: sized }, '0 0 10 10').symbol).toEqual(crop);
  });

  it('derives the recolours from a black-on-transparent lockup, whose unfilled shapes take SVG’s default ink', () => {
    // A mark drawn in the default black, as AAIF’s is: one ink, no background, so every variant is derived as before.
    const black = {
      ref: 'logo.svg',
      svg: `<svg ${SVG_NS} viewBox="0 0 20 10"><path d="M1 1h8v8H1z"/><path d="M11 5h8" stroke="black" stroke-width="2" fill="none"/></svg>`,
    };
    expect(logoVariantSources({ ...none, primary: black }, '0 0 10 10')).toEqual({
      symbol: {
        kind: 'svg',
        svg: `<svg ${SVG_NS} viewBox="0 0 10 10"><path d="M1 1h8v8H1z"/><path d="M11 5h8" stroke="black" stroke-width="2" fill="none"/></svg>`,
        derived: true,
      },
      symbol_reversed: reversedSymbol,
      reversed: reversedOfPrimary,
      one_color: oneColour,
    });
  });

  it('reads one colour spelled two ways as one ink, so a lockup in black and #000 is derived from', () => {
    const spelled = {
      ref: 'logo.svg',
      svg: `<svg ${SVG_NS} viewBox="0 0 20 10"><path d="M1 1h8v8H1z" fill="black"/><path d="M11 1h8v8h-8z" fill="#000"/></svg>`,
    };
    expect(logoVariantSources({ ...none, primary: spelled }, null)).toEqual({ reversed: reversedOfPrimary, one_color: oneColour });
  });

  it('reads a white rect inside a clipPath as never painted, so a black lockup clipped by it is single-colour artwork', () => {
    // AAIF’s shape: black paths under a clip whose rect is white, inside <defs>, which draws nothing; its reversed file is an upload, so only the one-colour lockup is derived.
    const clipped = {
      ref: 'logo.svg',
      svg: `<svg ${SVG_NS} viewBox="0 0 20 10"><defs><clipPath id="c"><rect width="20" height="10" fill="#fff"/></clipPath></defs><g clip-path="url(#c)"><path d="M1 1h8v8H1z"/><path d="M11 1h8v8h-8z" fill="black"/></g></svg>`,
    };
    const reversedFile = { ref: 'reversed.svg', svg: `<svg ${SVG_NS} viewBox="0 0 20 10"><path d="M1 1h8v8H1z" fill="#fff"/></svg>` };
    expect(logoVariantSources({ ...none, primary: clipped, reversed: reversedFile }, null)).toEqual({
      reversed: { kind: 'svg', svg: reversedFile.svg, derived: false },
      one_color: oneColour,
    });
  });

  it('derives nothing from a lockup painted over a white rect the size of its canvas: the ground is a second ink, and a filter would box the mark', () => {
    const grounded = { ref: 'logo.svg', svg: `<svg ${SVG_NS} viewBox="0 0 20 10"><rect width="20" height="10" fill="#fff"/><path d="M1 1h8v8H1z"/></svg>` };
    expect(logoVariantSources({ ...none, primary: grounded }, '0 0 10 10')).toEqual({
      symbol: { kind: 'svg', svg: `<svg ${SVG_NS} viewBox="0 0 10 10"><rect width="20" height="10" fill="#fff"/><path d="M1 1h8v8H1z"/></svg>`, derived: true },
    });
  });

  it('derives nothing from a black rounded tile with a white letter: rendered white is an ink, and a reversal would turn the tile white and lose the letter', () => {
    // The tile and its letter are two inks even though one of them is white: inverting them boxes the letter in a white tile.
    const tile = {
      ref: 'logo.svg',
      svg: `<svg ${SVG_NS} viewBox="0 0 20 10"><rect x="1" y="1" width="8" height="8" rx="2" fill="#000"/><path d="M4 3h2v4H4z" fill="#fff"/><path d="M11 5h8" stroke="#000" stroke-width="2"/></svg>`,
    };
    expect(logoVariantSources({ ...none, primary: tile }, '0 0 10 10')).toEqual({
      symbol: {
        kind: 'svg',
        svg: `<svg ${SVG_NS} viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="2" fill="#000"/><path d="M4 3h2v4H4z" fill="#fff"/><path d="M11 5h8" stroke="#000" stroke-width="2"/></svg>`,
        derived: true,
      },
    });
    expect(logoVariantSources({ ...none, primary: tile }, null)).toEqual({});
  });

  it('derives no reversed, one-colour or reversed-symbol recolour from a multi-colour primary, and still names the symbol crop', () => {
    // LOCKUP paints its mark blue and its rule orange: two inks flatten to one shape under the filter, so nothing is recoloured from it.
    const twoInks = { ref: 'logo.svg', svg: LOCKUP };
    expect(logoVariantSources({ ...none, primary: twoInks }, '0 0 10 10')).toEqual({
      symbol: { kind: 'svg', svg: `<svg ${SVG_NS} viewBox="0 0 10 10">${LOCKUP_BODY}</svg>`, derived: true },
    });
    expect(logoVariantSources({ ...none, primary: twoInks }, null)).toEqual({});
  });

  it('returns the uploaded reversed and symbol SVGs as they came beside a multi-colour primary, and recolours only a single-colour uploaded symbol', () => {
    const twoInks = { ref: 'logo.svg', svg: LOCKUP };
    const reversedFile = { ref: 'reversed.svg', svg: `<svg ${SVG_NS} viewBox="0 0 20 10"><path d="M1 1h8v8H1z" fill="#fff"/></svg>` };
    const monoSymbol = { ref: 'symbol.svg', svg: `<svg ${SVG_NS} viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="#1f6feb"/></svg>` };
    expect(logoVariantSources({ ...none, primary: twoInks, symbol: monoSymbol, reversed: reversedFile }, '0 0 10 10')).toEqual({
      symbol: { kind: 'svg', svg: monoSymbol.svg, derived: false },
      symbol_reversed: reversedSymbol,
      reversed: { kind: 'svg', svg: reversedFile.svg, derived: false },
    });
    // An uploaded symbol in two inks is sent as it came, and no reversed symbol is derived from it, whatever the primary.
    const twoInkSymbol = {
      ref: 'symbol.svg',
      svg: `<svg ${SVG_NS} viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="#1f6feb"/><circle cx="4" cy="4" r="1" fill="#d62"/></svg>`,
    };
    expect(logoVariantSources({ ...none, primary, symbol: twoInkSymbol }, null)).toEqual({
      symbol: { kind: 'svg', svg: twoInkSymbol.svg, derived: false },
      reversed: reversedOfPrimary,
      one_color: oneColour,
    });
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
