// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import {
  BRAND_KIT_ICON_COMPACT_SIZE_PX,
  BRAND_KIT_ICON_HIGHLIGHT_INDEX,
  BRAND_KIT_ICON_SAMPLES,
  BRAND_KIT_ICON_STRIP_INK,
  BRAND_KIT_ICON_STRIP_SIZE_PX,
  BRAND_KIT_ICON_TILE_SIZE_PX,
} from '@lfx-one/shared/constants';
import { BrandKitIconColours } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';
import { MktgBrandKitIconSamplesComponent } from './mktg-brand-kit-icon-samples.component';

const COLOURS: BrandKitIconColours = { tileInk: '#003B5C', stripGround: '#003B5C', highlight: '#FF702D' };

async function setup(colours: BrandKitIconColours = COLOURS, compact = false) {
  const fixture = TestBed.createComponent(MktgBrandKitIconSamplesComponent);
  fixture.componentRef.setInput('colours', colours);
  fixture.componentRef.setInput('compact', compact);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  return { fixture, root };
}

/** A colour as jsdom normalises it on an element's inline style. */
function cssColour(hex: string): string {
  const probe = document.createElement('span');
  probe.style.color = hex;
  return probe.style.color;
}

describe('MktgBrandKitIconSamplesComponent', () => {
  it('draws the eight tiles in the board’s order, each icon inline as stroked shapes in the kit’s dark, its label as text', async () => {
    const { root } = await setup();
    expect(root.getAttribute('data-testid')).toBe('brand-kit-icon-samples');
    // A block host: the print sheet's `break-inside: avoid` holds it whole (an inline or flex host would not).
    expect(root.classList.contains('block')).toBe(true);
    expect(root.classList.contains('flex')).toBe(false);
    // The board's 4 × 2 grid with its 12 px gap (book.js L91); two to a row below the sm breakpoint so no label breaks mid-word.
    const grid = root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-tiles"]');
    expect(grid?.classList.contains('gap-[12px]')).toBe(true);
    expect(grid?.classList.contains('sm:grid-cols-4')).toBe(true);
    expect(grid?.classList.contains('grid-cols-2')).toBe(true);
    const tiles = Array.from(root.querySelectorAll<HTMLElement>('[data-testid^="brand-kit-icon-tile-"]'));
    expect(tiles.map((tile) => tile.getAttribute('data-testid'))).toEqual(BRAND_KIT_ICON_SAMPLES.map((icon) => `brand-kit-icon-tile-${icon.id}`));
    expect(tiles.map((tile) => tile.querySelector('span')?.textContent)).toEqual(BRAND_KIT_ICON_SAMPLES.map((icon) => icon.label));
    tiles.forEach((tile, index) => {
      expect(tile.style.color).toBe(cssColour(COLOURS.tileInk));
      const svg = tile.querySelector('svg');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg?.getAttribute('fill')).toBe('none');
      expect(svg?.getAttribute('stroke')).toBe('currentColor');
      expect(svg?.getAttribute('stroke-width')).toBe('2');
      expect(svg?.getAttribute('stroke-linecap')).toBe('round');
      expect(svg?.getAttribute('stroke-linejoin')).toBe('round');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('width')).toBe(String(BRAND_KIT_ICON_TILE_SIZE_PX));
      // One element per shape of the shared constant, of its kind: the shapes are drawn, never pasted as markup.
      const shapes = Array.from(svg?.children ?? []);
      expect(shapes.map((shape) => shape.tagName.toLowerCase())).toEqual(BRAND_KIT_ICON_SAMPLES[index].shapes.map((shape) => shape.kind));
      expect(svg?.textContent?.trim()).toBe('');
    });
    const documents = tiles[0].querySelectorAll('path');
    expect(documents[0].getAttribute('d')).toBe('M6 3h8l4 4v14H6z');
    const events = tiles[4].querySelector('rect');
    expect([events?.getAttribute('x'), events?.getAttribute('width'), events?.getAttribute('rx')]).toEqual(['3', '18', '2']);
    expect(root.querySelector('[innerHTML], [innerhtml]')).toBeNull();
  });

  it('draws the strip on the kit’s dark with the eight icons in white and the third, Global, in the highlight colour', async () => {
    const { root } = await setup();
    const strip = root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip"]');
    expect(strip?.style.backgroundColor).toBe(cssColour(COLOURS.stripGround));
    expect(strip?.getAttribute('role')).toBe('img');
    // In the half-width card the eight 28 px icons spread evenly with an 8 px minimum gap in 12 px of padding (one row from
    // a 304 px strip up), wrapping inside the strip in a narrower one.
    for (const cls of ['flex', 'flex-wrap', 'justify-between', 'gap-x-2', 'px-3']) {
      expect(strip?.classList.contains(cls)).toBe(true);
    }
    for (const cls of ['gap-x-3', 'gap-x-[26px]', 'px-4']) {
      expect(strip?.classList.contains(cls)).toBe(false);
    }
    expect(BRAND_KIT_ICON_STRIP_SIZE_PX).toBe(28);
    expect(strip?.getAttribute('aria-label')).toContain('Global in the highlight colour');
    const icons = Array.from(strip?.querySelectorAll<HTMLElement>('[data-testid^="brand-kit-icon-strip-"]') ?? []);
    expect(icons.map((icon) => icon.getAttribute('data-testid'))).toEqual(BRAND_KIT_ICON_SAMPLES.map((icon) => `brand-kit-icon-strip-${icon.id}`));
    icons.forEach((icon, index) => {
      const highlighted = index === BRAND_KIT_ICON_HIGHLIGHT_INDEX;
      expect(icon.getAttribute('data-highlight')).toBe(highlighted ? 'true' : null);
      expect(icon.style.color).toBe(cssColour(highlighted ? COLOURS.highlight : BRAND_KIT_ICON_STRIP_INK));
      expect(icon.querySelector('svg')?.getAttribute('width')).toBe(String(BRAND_KIT_ICON_STRIP_SIZE_PX));
      expect(icon.textContent?.trim()).toBe('');
    });
    expect(icons[BRAND_KIT_ICON_HIGHLIGHT_INDEX].getAttribute('data-testid')).toBe('brand-kit-icon-strip-global');
  });

  it('takes every colour from its input, so another kit’s dark and highlight paint the same shapes', async () => {
    const colours: BrandKitIconColours = { tileInk: '#171717', stripGround: '#171717', highlight: '#00AEEF' };
    const { root } = await setup(colours);
    expect(root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-tile-code"]')?.style.color).toBe(cssColour('#171717'));
    expect(root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip"]')?.style.backgroundColor).toBe(cssColour('#171717'));
    expect(root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip-global"]')?.style.color).toBe(cssColour('#00AEEF'));
    expect(root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip-code"]')?.style.color).toBe(cssColour('#FFFFFF'));
  });

  it('draws the print sheet’s compact rows in plain block flow: 30 px inline-block tiles four to a line, 18 px icons, 8 px labels, a 30 px strip of inline blocks, no grid or flex', async () => {
    const { root } = await setup(COLOURS, true);
    expect(root.classList.contains('block')).toBe(true);
    // No grid or flex box anywhere: inside the sheet's paginated table Chromium fragments their contents away from their boxes.
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      expect(Array.from(node.classList).filter((cls) => /^(grid|flex|inline-flex|grid-cols-\d|sm:grid-cols-\d)$/.test(cls))).toEqual([]);
    }
    const tiles = Array.from(root.querySelectorAll<HTMLElement>('[data-testid^="brand-kit-icon-tile-"]'));
    expect(tiles).toHaveLength(8);
    expect(tiles.map((tile) => tile.querySelector('span')?.textContent)).toEqual(BRAND_KIT_ICON_SAMPLES.map((icon) => icon.label));
    for (const tile of tiles) {
      for (const cls of ['inline-block', 'h-[30px]', 'w-[23%]', 'align-top', 'text-center']) {
        expect(tile.classList.contains(cls)).toBe(true);
      }
      expect(tile.classList.contains('h-[110px]')).toBe(false);
      expect(tile.style.color).toBe(cssColour(COLOURS.tileInk));
      expect(tile.querySelector('svg')?.getAttribute('width')).toBe(String(BRAND_KIT_ICON_COMPACT_SIZE_PX));
      expect(tile.querySelector('svg')?.classList.contains('block')).toBe(true);
      expect(tile.querySelector('span')?.classList.contains('text-[8px]')).toBe(true);
      expect(tile.querySelector('span')?.classList.contains('block')).toBe(true);
    }
    const strip = root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip"]');
    for (const cls of ['block', 'h-[30px]', 'whitespace-nowrap']) {
      expect(strip?.classList.contains(cls)).toBe(true);
    }
    expect(strip?.style.backgroundColor).toBe(cssColour(COLOURS.stripGround));
    const icons = Array.from(strip?.querySelectorAll<HTMLElement>('[data-testid^="brand-kit-icon-strip-"]') ?? []);
    expect(icons).toHaveLength(8);
    icons.forEach((icon, index) => {
      expect(icon.classList.contains('inline-block')).toBe(true);
      expect(icon.querySelector('svg')?.getAttribute('width')).toBe(String(BRAND_KIT_ICON_COMPACT_SIZE_PX));
      const highlighted = index === BRAND_KIT_ICON_HIGHLIGHT_INDEX;
      expect(icon.getAttribute('data-highlight')).toBe(highlighted ? 'true' : null);
      expect(icon.style.color).toBe(cssColour(highlighted ? COLOURS.highlight : BRAND_KIT_ICON_STRIP_INK));
    });
    // Print-safe: no filter, gradient or shadow anywhere in the markup.
    expect(root.innerHTML).not.toMatch(/filter|gradient|shadow/i);
  });
});
