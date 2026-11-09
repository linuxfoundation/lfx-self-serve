// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_ICON_SAMPLES } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';
import { brandKitIconSvg } from './mktg-brand-kit-icons.util';

describe('brandKitIconSvg', () => {
  it('writes one stroked SVG on the 24-unit grid from the shared shapes, with the stroke and nothing else of the caller’s', () => {
    const documents = BRAND_KIT_ICON_SAMPLES[0];
    const svg = brandKitIconSvg(documents.shapes, '#4D4E4E');

    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4D4E4E"' +
        ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>'
    );
  });

  it('draws each primitive as its own element: circles and rects with their numbers, never text or markup', () => {
    const events = BRAND_KIT_ICON_SAMPLES.find((icon) => icon.id === 'events');
    const svg = brandKitIconSvg(events?.shapes ?? [], '#000000') ?? '';

    expect(svg).toContain('<rect x="3" y="5" width="18" height="16" rx="2"/>');
    expect(svg).not.toMatch(/<text|<image|<script|<style|url\(/i);
    const global = BRAND_KIT_ICON_SAMPLES.find((icon) => icon.id === 'global');
    expect(brandKitIconSvg(global?.shapes ?? [], '#000000')).toContain('<circle cx="12" cy="12" r="9"/>');
  });

  it('refuses a stroke that is not a #RRGGBB colour, so no text of a kit’s can reach the markup', () => {
    // The shared rule (`BRAND_KIT_HEX_REGEX`) is the kit's own: six upper-case hex digits, as every stored kit colour is.
    for (const stroke of ['navy', '#fff', '#ffffff', '#4D4E4E" onload="x', 'url(#g)', '', '#GGGGGG']) {
      expect(brandKitIconSvg(BRAND_KIT_ICON_SAMPLES[0].shapes, stroke)).toBeNull();
    }
    expect(brandKitIconSvg(BRAND_KIT_ICON_SAMPLES[0].shapes, '#FFFFFF')).not.toBeNull();
  });

  it('writes every shared sample, each with as many elements as shapes', () => {
    for (const icon of BRAND_KIT_ICON_SAMPLES) {
      const svg = brandKitIconSvg(icon.shapes, '#FFFFFF') ?? '';
      expect((svg.match(/<(path|circle|rect) /g) ?? []).length).toBe(icon.shapes.length);
    }
  });
});
