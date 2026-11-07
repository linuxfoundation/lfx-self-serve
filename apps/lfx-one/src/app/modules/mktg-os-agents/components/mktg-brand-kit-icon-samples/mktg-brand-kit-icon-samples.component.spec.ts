// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import {
  BRAND_KIT_ICON_HIGHLIGHT_INDEX,
  BRAND_KIT_ICON_PORTRAIT_STRIP_SIZE_PX,
  BRAND_KIT_ICON_PORTRAIT_TILE_SIZE_PX,
  BRAND_KIT_ICON_PRINT_STRIP_SIZE_PX,
  BRAND_KIT_ICON_SAMPLES,
  BRAND_KIT_ICON_STRIP_INK,
  BRAND_KIT_ICON_STRIP_ONE_ROW_MIN_PX,
  BRAND_KIT_ICON_STRIP_SIZE_PX,
  BRAND_KIT_ICON_TILE_COLUMNS,
  BRAND_KIT_ICON_TILE_SIZE_PX,
} from '@lfx-one/shared/constants';
import { BrandKitIconColours } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';
import { MktgBrandKitIconSamplesComponent } from './mktg-brand-kit-icon-samples.component';

const COLOURS: BrandKitIconColours = { tileInk: '#003B5C', stripGround: '#003B5C', highlight: '#FF702D' };

async function setup(colours: BrandKitIconColours = COLOURS, print = false, portrait = false) {
  const fixture = TestBed.createComponent(MktgBrandKitIconSamplesComponent);
  fixture.componentRef.setInput('colours', colours);
  fixture.componentRef.setInput('print', print);
  fixture.componentRef.setInput('portrait', portrait);
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
    // A grid of eight 24 px icons spread evenly (space-between) with an 8 px minimum gap in 12 px of padding, one row from a
    // 272 px strip up (a container query on the host), and 4 + 4 below that: never a free wrap of 7 + 1 or 5 + 3.
    expect(root.classList.contains('@container')).toBe(true);
    for (const cls of ['grid', 'grid-cols-[repeat(4,max-content)]', '@[272px]:grid-cols-[repeat(8,max-content)]', 'justify-between', 'gap-x-2', 'px-3']) {
      expect(strip?.classList.contains(cls)).toBe(true);
    }
    for (const cls of ['flex', 'flex-wrap', 'gap-x-3', 'gap-x-[26px]', 'px-4']) {
      expect(strip?.classList.contains(cls)).toBe(false);
    }
    expect(BRAND_KIT_ICON_STRIP_SIZE_PX).toBe(24);
    expect(BRAND_KIT_ICON_STRIP_ONE_ROW_MIN_PX).toBe(8 * BRAND_KIT_ICON_STRIP_SIZE_PX + 7 * 8 + 2 * 12);
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

  it('draws the print sheet’s variant at the board’s proportions in table boxes: a 2 × 4 table of 110 px tiles with 32 px icons and 11 px labels, then a 110 px strip of eight equal cells with 30 px icons, no grid or flex', async () => {
    const { root } = await setup(COLOURS, true);
    expect(root.classList.contains('block')).toBe(true);
    // No grid or flex box anywhere: inside the sheet's paginated table Chromium fragments their contents away from their boxes.
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      expect(Array.from(node.classList).filter((cls) => /^(grid|flex|inline-flex|flex-wrap|grid-cols-.*)$/.test(cls))).toEqual([]);
    }
    const tiles = root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-tiles"]');
    for (const cls of ['table', 'table-fixed', 'w-[calc(100%+12px)]', '-mx-[6px]']) {
      expect(tiles?.classList.contains(cls)).toBe(true);
    }
    const rows = Array.from(tiles?.querySelectorAll<HTMLElement>(':scope > .table-row') ?? []);
    expect(rows).toHaveLength(BRAND_KIT_ICON_SAMPLES.length / BRAND_KIT_ICON_TILE_COLUMNS);
    const tileList = Array.from(root.querySelectorAll<HTMLElement>('[data-testid^="brand-kit-icon-tile-"]'));
    expect(tileList).toHaveLength(8);
    expect(tileList.map((tile) => tile.querySelector('span')?.textContent)).toEqual(BRAND_KIT_ICON_SAMPLES.map((icon) => icon.label));
    rows.forEach((row, rowIndex) => {
      const cells = Array.from(row.querySelectorAll<HTMLElement>(':scope > .table-cell'));
      expect(cells).toHaveLength(BRAND_KIT_ICON_TILE_COLUMNS);
      cells.forEach((cell, column) => {
        // The board's 12 px gaps: half on each side of every equal column (the table bleeds 6 px past the edges to stay flush), under every row but the last.
        expect(cell.classList.contains('px-[6px]')).toBe(true);
        expect(cell.classList.contains('pb-[12px]')).toBe(rowIndex < rows.length - 1);
        const tile = cell.firstElementChild as HTMLElement;
        expect(tile.getAttribute('data-testid')).toBe('brand-kit-icon-tile-' + BRAND_KIT_ICON_SAMPLES[rowIndex * BRAND_KIT_ICON_TILE_COLUMNS + column].id);
        for (const cls of ['table', 'h-[110px]', 'w-full', 'rounded-[10px]', 'border', 'border-gray-200']) {
          expect(tile.classList.contains(cls)).toBe(true);
        }
        expect(tile.style.color).toBe(cssColour(COLOURS.tileInk));
        expect(tile.firstElementChild?.classList.contains('table-cell')).toBe(true);
        expect(tile.firstElementChild?.classList.contains('align-middle')).toBe(true);
        expect(tile.querySelector('svg')?.getAttribute('width')).toBe(String(BRAND_KIT_ICON_TILE_SIZE_PX));
        expect(tile.querySelector('span')?.classList.contains('text-[11px]')).toBe(true);
      });
    });
    const strip = root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip"]');
    for (const cls of ['table', 'table-fixed', 'w-full', 'h-[110px]', 'mt-[14px]', 'px-[30px]', 'rounded-[10px]']) {
      expect(strip?.classList.contains(cls)).toBe(true);
    }
    expect(strip?.style.backgroundColor).toBe(cssColour(COLOURS.stripGround));
    expect(strip?.getAttribute('role')).toBe('img');
    const icons = Array.from(strip?.querySelectorAll<HTMLElement>('[data-testid^="brand-kit-icon-strip-"]') ?? []);
    expect(icons).toHaveLength(8);
    expect(strip?.querySelector(':scope > .table-row')?.children).toHaveLength(8);
    icons.forEach((icon, index) => {
      expect(icon.classList.contains('table-cell')).toBe(true);
      expect(icon.classList.contains('text-center')).toBe(true);
      expect(icon.querySelector('svg')?.getAttribute('width')).toBe(String(BRAND_KIT_ICON_PRINT_STRIP_SIZE_PX));
      const highlighted = index === BRAND_KIT_ICON_HIGHLIGHT_INDEX;
      expect(icon.getAttribute('data-highlight')).toBe(highlighted ? 'true' : null);
      expect(icon.style.color).toBe(cssColour(highlighted ? COLOURS.highlight : BRAND_KIT_ICON_STRIP_INK));
    });
    // Print-safe: no filter, gradient or shadow anywhere in the markup.
    expect(root.innerHTML).not.toMatch(/filter|gradient|shadow/i);
  });

  it('draws the portrait book’s variant at the mock’s sizes: 150 px tiles with 36 px icons and 16 px gaps, then the 120 px strip 36 px below with 32 px icons, in the same table boxes', async () => {
    const { root } = await setup(COLOURS, true, true);
    const tiles = root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-tiles"]');
    for (const cls of ['table', 'table-fixed', 'w-[calc(100%+16px)]', '-mx-[8px]']) {
      expect(tiles?.classList.contains(cls)).toBe(true);
    }
    const rows = Array.from(tiles?.querySelectorAll<HTMLElement>(':scope > .table-row') ?? []);
    expect(rows).toHaveLength(2);
    rows.forEach((row, rowIndex) => {
      Array.from(row.querySelectorAll<HTMLElement>(':scope > .table-cell')).forEach((cell) => {
        expect(cell.classList.contains('px-[8px]')).toBe(true);
        expect(cell.classList.contains('pb-[16px]')).toBe(rowIndex === 0);
        expect(cell.classList.contains('pb-[12px]')).toBe(false);
        const tile = cell.firstElementChild as HTMLElement;
        expect(tile.classList.contains('h-[150px]')).toBe(true);
        expect(tile.classList.contains('h-[110px]')).toBe(false);
        expect(tile.querySelector('svg')?.getAttribute('width')).toBe(String(BRAND_KIT_ICON_PORTRAIT_TILE_SIZE_PX));
        expect(tile.querySelector('span')?.classList.contains('mt-[12px]')).toBe(true);
      });
    });
    const strip = root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip"]');
    for (const cls of ['table', 'h-[120px]', 'mt-[36px]', 'px-[24px]']) {
      expect(strip?.classList.contains(cls)).toBe(true);
    }
    expect(strip?.classList.contains('h-[110px]')).toBe(false);
    const icons = Array.from(strip?.querySelectorAll<HTMLElement>('[data-testid^="brand-kit-icon-strip-"]') ?? []);
    expect(icons).toHaveLength(8);
    icons.forEach((icon) => expect(icon.querySelector('svg')?.getAttribute('width')).toBe(String(BRAND_KIT_ICON_PORTRAIT_STRIP_SIZE_PX)));
    expect(icons[BRAND_KIT_ICON_HIGHLIGHT_INDEX].style.color).toBe(cssColour(COLOURS.highlight));
  });
});
