// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageColorPaletteComponent } from './mktg-brand-kit-page-color-palette.component';
import { mountBrandKitPage, rectOf } from './mktg-brand-kit-page.spec-helper';

describe('the Color palette page', () => {
  it('opens the Color chapter with a swatch per colour (values, share, role, source without a file name) and the proportion bar', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageColorPaletteComponent, 'color-palette');
    expect(frame.getAttribute('data-page')).toBe('8');
    expect(frame.getAttribute('data-section')).toBe('02 Color');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-palette-intro"]')?.textContent).toBe(view.color.summary);
    const swatches = Array.from(frame.querySelectorAll<HTMLElement>('[data-testid="brand-kit-palette-swatches"] .kp-swatch'));
    expect(swatches).toHaveLength(4);
    expect(rectOf(swatches[0])).toEqual({ left: '56px', top: '220px', width: '704px' });
    const first = swatches[0].textContent?.replace(/\s+/g, ' ').trim();
    expect(first).toBe('Charcoal HEX #4D4E4E RGB 77 78 78 Share 55% Role Headings From the logo artwork');
    expect(swatches[0].textContent).not.toContain('logo.svg');
    expect(swatches[2].textContent).toContain('From the site’s CSS — one.example.org');
    expect(swatches[2].textContent).not.toContain('https://');
    expect(swatches[0].querySelector<HTMLElement>('.kp-swatch-name')?.style.color).not.toBe('');
    expect(swatches[0].querySelector('.kp-swatch-color')?.classList.contains('kp-swatch-color--short')).toBe(false);
    const bar = frame.querySelector('[data-testid="brand-kit-palette-proportion"]');
    expect(rectOf(bar)).toEqual({ left: '56px', top: '860px', width: '704px' });
    expect(Array.from(bar?.querySelectorAll<HTMLElement>('span') ?? [], (span) => span.style.flexGrow)).toEqual(['55', '30', '10', '5']);
    expect(frame.querySelector('.kp-legend')?.textContent).toContain('Charcoal 55%');
  });

  it('shortens the swatches of a five-colour kit so the page still fits', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageColorPaletteComponent, 'color-palette', (view) => ({
      ...view,
      palette: [...view.palette, { ...view.palette[0], name: 'Fifth', hex: '#123456', hexDigits: '123456' }],
    }));
    expect(frame.querySelectorAll('.kp-swatch')).toHaveLength(5);
    expect(frame.querySelectorAll('.kp-swatch-color--short')).toHaveLength(5);
  });
});
