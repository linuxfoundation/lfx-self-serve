// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractBrandScales, findPaletteDrift, findScopeDrift, PALETTE_BINDINGS, UNBOUND_PROPERTIES, readPaletteDeclarations } from './lib/check-gw-embed-palette.mjs';
import { SCOPE } from './lib/contain-gw-embed-css.mjs';

const THEME_PATH = resolve(import.meta.dirname, '../src/styles/gw-embed-theme.css');
const COLORS_PATH = resolve(import.meta.dirname, '../../../packages/shared/src/constants/colors.constants.ts');

const theme = readFileSync(THEME_PATH, 'utf8');
const scales = extractBrandScales(readFileSync(COLORS_PATH, 'utf8'));

/**
 * The embed theme maps LFX's brand scale onto Radix's, as literal hex values. Without this check a
 * future `lfxColors` update leaves the embedded module on a stale palette while the rest of LFX
 * moves, and nothing notices.
 */
describe('gw-embed palette binding', () => {
  it('matches lfxColors as shipped', () => {
    expect(findPaletteDrift(theme, scales)).toEqual([]);
  });

  it('fails when the brand scale moves under it', () => {
    // The case the check exists for: someone updates lfxColors and the embed silently keeps the
    // old blue. Every property bound to blue.600 should report, not just the first.
    const moved = structuredClone(scales);
    moved.blue['600'] = '#123456';

    const drift = findPaletteDrift(theme, moved);

    expect(drift.length).toBeGreaterThanOrEqual(3);
    expect(drift.every((line) => line.includes('#123456'))).toBe(true);
  });

  it('fails when the stylesheet is edited away from the scale', () => {
    const edited = theme.replace('--accent-9: #0082d9', '--accent-9: #ff0000');

    expect(findPaletteDrift(edited, scales)).toContainEqual(expect.stringContaining('--accent-9'));
  });

  it('fails when a bound property disappears, rather than passing on silence', () => {
    // A checker that quietly passes on a missing property stops being evidence of anything.
    const removed = theme.replace(/--accent-12:[^;]*;/, '');

    expect(findPaletteDrift(removed, scales)).toContainEqual(expect.stringContaining('--accent-12: expected in the stylesheet'));
  });

  it('accounts for every hard-coded colour in the theme', () => {
    // Guards the binding table itself: a new literal added to the stylesheet and listed in neither
    // table is exactly the drift this is meant to prevent, one level up.
    const declared = Object.keys(readPaletteDeclarations(theme));
    const accounted = new Set([...Object.keys(PALETTE_BINDINGS), ...Object.keys(UNBOUND_PROPERTIES)]);

    expect(declared.filter((property) => !accounted.has(property))).toEqual([]);
  });
});

describe('gw-embed theme scope binding', () => {
  const WIDENED = ':is(#gw-embed-root, #gw-embed-portals, #gw-embed-new-portal, #frame-root, body:has(#frame-root):not(:has(#gw-embed-root)))';

  it('matches SCOPE as shipped', () => {
    expect(findScopeDrift(theme, SCOPE)).toEqual([]);
  });

  it('fails when SCOPE gains a container the theme does not carry', () => {
    // The case the first version of this check missed entirely: it only looked for the
    // :not(:has(#gw-embed-root)) qualifier, so widening SCOPE left it green while the new
    // container rendered with the embed's structural CSS and none of the LFX theme.
    expect(findScopeDrift(theme, WIDENED)).toContainEqual(expect.stringContaining('does not match SCOPE'));
  });

  it('fails when the theme loses the guard', () => {
    const unguarded = theme.replace(/:not\(:has\(#gw-embed-root\)\)/g, '');

    expect(findScopeDrift(unguarded, SCOPE)).toContainEqual(expect.stringContaining('does not match SCOPE'));
  });

  it('fails when the theme has no scopes at all, rather than passing on silence', () => {
    expect(findScopeDrift('.card { color: red }', SCOPE)).toContainEqual(expect.stringContaining('no scope selectors found'));
  });
});

describe('extractBrandScales', () => {
  it('reads the scales the theme depends on', () => {
    expect(scales.blue['600']).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(scales.gray['900']).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('throws rather than returning an empty scale, which would make every check vacuous', () => {
    expect(() => extractBrandScales('export const lfxColors = {};', ['blue'])).toThrow(/could not find/);
  });
});
