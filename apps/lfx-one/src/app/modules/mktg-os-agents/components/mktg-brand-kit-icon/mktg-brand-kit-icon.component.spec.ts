// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { BRAND_KIT_ICON_SAMPLES, BRAND_KIT_ICON_STROKE_WIDTH } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';
import { MktgBrandKitIconComponent } from './mktg-brand-kit-icon.component';

describe('MktgBrandKitIconComponent', () => {
  it('draws one shared icon as stroked SVG primitives in the current colour, at the size it is given, as the parent’s own child', async () => {
    const fixture = TestBed.createComponent(MktgBrandKitIconComponent);
    fixture.componentRef.setInput('icon', BRAND_KIT_ICON_SAMPLES[4]);
    fixture.componentRef.setInput('size', 32);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.classList.contains('contents')).toBe(true);
    const svg = root.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('height')).toBe('32');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('stroke-width')).toBe(String(BRAND_KIT_ICON_STROKE_WIDTH));
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    // One element per shape of the constant, of its kind: drawn, never pasted as markup.
    expect(Array.from(svg?.children ?? [], (shape) => shape.tagName.toLowerCase())).toEqual(BRAND_KIT_ICON_SAMPLES[4].shapes.map((shape) => shape.kind));
    expect(root.querySelector('[innerHTML], [innerhtml]')).toBeNull();
    // A CSS length fills the parent's box (the print page's slot).
    fixture.componentRef.setInput('size', '100%');
    await fixture.whenStable();
    expect(svg?.getAttribute('width')).toBe('100%');
  });
});
