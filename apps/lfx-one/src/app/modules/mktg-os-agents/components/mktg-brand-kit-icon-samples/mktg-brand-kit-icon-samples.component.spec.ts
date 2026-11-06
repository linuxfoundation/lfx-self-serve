// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { BRAND_KIT_ICON_HIGHLIGHT_INDEX, BRAND_KIT_ICON_SAMPLES, BRAND_KIT_ICON_STRIP_INK } from '@lfx-one/shared/constants';
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
      expect(svg?.getAttribute('width')).toBe('32');
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
    expect(strip?.getAttribute('aria-label')).toContain('Global in the highlight colour');
    const icons = Array.from(strip?.querySelectorAll<HTMLElement>('[data-testid^="brand-kit-icon-strip-"]') ?? []);
    expect(icons.map((icon) => icon.getAttribute('data-testid'))).toEqual(BRAND_KIT_ICON_SAMPLES.map((icon) => `brand-kit-icon-strip-${icon.id}`));
    icons.forEach((icon, index) => {
      const highlighted = index === BRAND_KIT_ICON_HIGHLIGHT_INDEX;
      expect(icon.getAttribute('data-highlight')).toBe(highlighted ? 'true' : null);
      expect(icon.style.color).toBe(cssColour(highlighted ? COLOURS.highlight : BRAND_KIT_ICON_STRIP_INK));
      expect(icon.querySelector('svg')?.getAttribute('width')).toBe('30');
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

  it('keeps the icons and labels in the compact rows the print sheet asks for, only the tiles and the strip shorter', async () => {
    const { root } = await setup(COLOURS, true);
    const tile = root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-tile-documents"]');
    expect(tile?.classList.contains('h-[88px]')).toBe(true);
    expect(tile?.classList.contains('h-[110px]')).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip"]')?.classList.contains('min-h-[72px]')).toBe(true);
    expect(root.querySelectorAll('[data-testid^="brand-kit-icon-tile-"]')).toHaveLength(8);
    expect(root.querySelectorAll('[data-testid^="brand-kit-icon-strip-"]')).toHaveLength(8);
    expect(tile?.querySelector('svg')?.getAttribute('width')).toBe('32');
    // Print-safe: no filter, gradient or shadow anywhere in the markup.
    expect(root.innerHTML).not.toMatch(/filter|gradient|shadow/i);
  });
});
