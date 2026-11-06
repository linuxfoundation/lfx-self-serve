// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
  BRAND_KIT_ICON_HIGHLIGHT_INDEX,
  BRAND_KIT_ICON_IDS,
  BRAND_KIT_ICON_SAMPLES,
  BRAND_KIT_ICON_STRIP_INK,
  BRAND_KIT_ICON_STROKE_WIDTH,
  BRAND_KIT_ICON_VIEWBOX_SIZE,
} from '../constants/brand-kit-icons.constants';
import { BRAND_KIT_HEX_REGEX } from '../constants/brand-kit.constants';
import type { BrandKitIconShape } from '../interfaces/brand-kit-icons.interface';
import { brandKitTestRevision } from './__fixtures__/brand-kit-revision.fixture';
import { brandKitIconColours } from './brand-kit-icons.utils';

/** A path's data as the board writes it: absolute and relative move, line, curve, arc and close commands with plain numbers. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.\s,-]+$/;

describe('BRAND_KIT_ICON_SAMPLES', () => {
  it('holds the board’s eight icons in its order, each with its label as text', () => {
    expect(BRAND_KIT_ICON_SAMPLES.map((icon) => icon.id)).toEqual([...BRAND_KIT_ICON_IDS]);
    expect(BRAND_KIT_ICON_SAMPLES.map((icon) => icon.label)).toEqual([
      'Documents',
      'Community',
      'Global',
      'Code',
      'Events',
      'Metrics',
      'Verified',
      'Newsletter',
    ]);
    expect(BRAND_KIT_ICON_IDS).toHaveLength(8);
  });

  it('draws every shape inside the 24-unit grid with a 2-unit stroke', () => {
    expect(BRAND_KIT_ICON_VIEWBOX_SIZE).toBe(24);
    expect(BRAND_KIT_ICON_STROKE_WIDTH).toBe(2);
    const within = (value: number): boolean => value >= 0 && value <= BRAND_KIT_ICON_VIEWBOX_SIZE;
    for (const icon of BRAND_KIT_ICON_SAMPLES) {
      expect(icon.shapes.length).toBeGreaterThan(0);
      for (const shape of icon.shapes as readonly BrandKitIconShape[]) {
        switch (shape.kind) {
          case 'path':
            expect(shape.d).toMatch(PATH_DATA);
            break;
          case 'circle':
            expect(within(shape.cx - shape.r) && within(shape.cx + shape.r) && within(shape.cy - shape.r) && within(shape.cy + shape.r)).toBe(true);
            break;
          case 'rect':
            expect(within(shape.x) && within(shape.x + shape.width) && within(shape.y) && within(shape.y + shape.height)).toBe(true);
            expect(shape.rx).toBeGreaterThanOrEqual(0);
            break;
        }
      }
    }
  });

  it('highlights the third strip icon, Global, and inks the rest white', () => {
    expect(BRAND_KIT_ICON_HIGHLIGHT_INDEX).toBe(2);
    expect(BRAND_KIT_ICON_SAMPLES[BRAND_KIT_ICON_HIGHLIGHT_INDEX].id).toBe('global');
    expect(BRAND_KIT_ICON_STRIP_INK).toBe('#FFFFFF');
  });
});

describe('brandKitIconColours', () => {
  it('inks the tiles and grounds the strip in the kit’s dark, and highlights in the palette colour the Iconography rules name, over the spark', () => {
    // A kit whose spark is one colour while its own rule reserves another for the active state: the rule's colour shows.
    const kit = brandKitTestRevision();
    kit.kit.spark = '#FF702D';
    kit.chapters.color.palette = [
      ...kit.chapters.color.palette,
      { name: 'Lilac', hex: '#B6B0D0', rgb: [182, 176, 208], role: 'Active state', found_in: { kind: 'page', source: 'the page' } },
    ];
    kit.chapters.visual.icons.rules = ['Line icons on a 24 px grid.', 'One color: Charcoal on light, white on dark. Lilac only for a single active state.'];
    expect(brandKitIconColours(kit)).toEqual({ tileInk: kit.kit.dark, stripGround: kit.kit.dark, highlight: '#B6B0D0' });
    expect(BRAND_KIT_HEX_REGEX.test(brandKitIconColours(kit).highlight)).toBe(true);
  });

  it('takes the last palette colour the rules name, as a whole word, in palette order', () => {
    const kit = brandKitTestRevision();
    kit.kit.spark = '#00AEEF';
    kit.chapters.visual.icons.rules = ['Line icons on a 24 px grid.', 'One color: Charcoal on light, white on dark. Orange only for a single active state.'];
    expect(brandKitIconColours(kit).highlight).toBe('#F37625');
    // The last named entry in palette order wins, whatever order the rule names them in; a name inside a longer word does not match.
    kit.chapters.visual.icons.rules = ['Mid gray or Charcoal for a single active state; never Oranges.'];
    expect(brandKitIconColours(kit).highlight).toBe('#767576');
    kit.chapters.visual.icons.rules = ['charcoal only, in lower case'];
    expect(brandKitIconColours(kit).highlight).toBe('#4D4E4E');
  });

  it('falls back to the spark when the rules name no palette colour, and to the accent when the spark is not a colour either', () => {
    const kit = brandKitTestRevision();
    kit.kit.spark = '#00AEEF';
    kit.chapters.visual.icons.rules = ['Line icons.', 'Pair every icon with a text label.'];
    expect(brandKitIconColours(kit)).toEqual({ tileInk: '#4D4E4E', stripGround: '#4D4E4E', highlight: '#00AEEF' });
    kit.kit.spark = 'spark';
    expect(brandKitIconColours(kit)).toEqual({ tileInk: '#4D4E4E', stripGround: '#4D4E4E', highlight: '#F37625' });
  });
});
