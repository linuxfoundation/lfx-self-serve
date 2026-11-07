// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { BRAND_KIT_ICON_SAMPLES, BRAND_KIT_ICON_STROKE_WIDTH, BRAND_KIT_ICON_VIEWBOX_SIZE } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';
import { MktgBrandKitIconComponent } from './mktg-brand-kit-icon.component';

describe('MktgBrandKitIconComponent', () => {
  it('draws the sample’s shapes as stroked SVG primitives on the 24-unit grid at the size it is given, taking the parent’s colour', async () => {
    const icon = BRAND_KIT_ICON_SAMPLES.find((sample) => sample.id === 'verified') ?? BRAND_KIT_ICON_SAMPLES[0];
    const fixture = TestBed.createComponent(MktgBrandKitIconComponent);
    fixture.componentRef.setInput('icon', icon);
    fixture.componentRef.setInput('size', 36);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.classList.contains('contents')).toBe(true);
    const svg = root.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('36');
    expect(svg?.getAttribute('height')).toBe('36');
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${BRAND_KIT_ICON_VIEWBOX_SIZE} ${BRAND_KIT_ICON_VIEWBOX_SIZE}`);
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.getAttribute('stroke-width')).toBe(String(BRAND_KIT_ICON_STROKE_WIDTH));
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.querySelectorAll('path, circle, rect')).toHaveLength(icon.shapes.length);
    expect(root.innerHTML).not.toMatch(/innerHTML|filter|gradient/i);
    // Another size: the same shapes, resized.
    fixture.componentRef.setInput('size', 16);
    await fixture.whenStable();
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.querySelectorAll('path, circle, rect')).toHaveLength(icon.shapes.length);
  });
});
