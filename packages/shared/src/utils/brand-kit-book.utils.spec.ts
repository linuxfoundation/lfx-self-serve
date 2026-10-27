// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the kit's reader-facing words (hand test, 18 Oct: a raw CDN
// URL in "Built from …" ran across the contents list): a logo file is named
// by its own name, an opaque upload id becomes "the logo you supplied", and
// no URL ever reaches the copy. Every fixture is synthetic.

import { describe, expect, it } from 'vitest';

import { BrandKitLogoRef, BrandKitRevision } from '../interfaces/brand-kit.interface';
import {
  brandKitArtworkInWords,
  brandKitBuiltFrom,
  brandKitChapterSummaries,
  brandKitContrastRatio,
  brandKitFoundIn,
  brandKitLabelInk,
  brandKitLuminance,
  buildBrandKitBookView,
} from './brand-kit-book.utils';
import { brandKitLogoFileName } from './brand-kit.utils';

/** A logo uploaded to a CDN that names files by a content hash and the image size: one long unbroken token. */
const CDN_LOGO_URL = 'https://cdn.sanity.io/images/p4x9k2m1/production/0f3e9c2b8a7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f-838x203.svg';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 3"/>';

/** The smallest kit the helpers read: the logo files, and enough of the other chapters for the book's view model. */
function kitWith(files: Partial<Record<'primary' | 'stacked' | 'symbol' | 'reversed', BrandKitLogoRef>>): BrandKitRevision {
  const palette = [
    { name: 'Ink', hex: '#20232A', rgb: [32, 35, 42] as [number, number, number], role: 'Text', found_in: { kind: 'logo' as const, source: CDN_LOGO_URL } },
    {
      name: 'Sky',
      hex: '#3A86FF',
      rgb: [58, 134, 255] as [number, number, number],
      role: 'Accent',
      found_in: { kind: 'site_css' as const, source: 'https://www.orbit.example.org/assets/site.css?v=9' },
    },
    {
      name: 'White',
      hex: '#FFFFFF',
      rgb: [255, 255, 255] as [number, number, number],
      role: 'Ground',
      found_in: { kind: 'page' as const, source: 'the page' },
    },
    {
      name: 'Mist',
      hex: '#E9EEF5',
      rgb: [233, 238, 245] as [number, number, number],
      role: 'Panels',
      found_in: { kind: 'unsourced' as const, source: 'chosen' },
    },
  ];
  return {
    projectName: 'Orbit',
    project: 'orbit',
    version: 1,
    mode: 'draft',
    kit: { colors: [], font: 'Inter', fontNote: '', attrs: [], dark: '#20232A', accent: '#3A86FF', spark: '#3A86FF', word: 'ORBIT' },
    chapters: {
      logo: {
        files: { primary: null, stacked: null, symbol: null, reversed: null, ...files },
        symbol_viewbox: null,
        placeholder: Object.keys(files).length === 0,
        system: 'One lockup, one symbol.',
        colorways: [],
        clear_space: 'X.',
        minimum_size: { screen_px: 32, print_mm: 10, symbol_px: 16, rule: 'Below that, the symbol.' },
        symbol: 'The ring.',
        partnership: [],
        watchouts: [],
      },
      color: { summary: 'Ink on white.', palette, proportion: [], contrast: { rule: 'AA.', pairs: [] } },
      type: {
        family: 'Inter',
        weights: [400],
        source: 'site',
        google_fonts: true,
        fallback: null,
        note: '',
        summary: 'Inter throughout.',
        scale: [],
        rules: [],
      },
      visual: { icons: { rules: [], recommended: 'Lucide' }, imagery: { rule: 'Real people.', avoid: [] } },
      usage: { summary: 'Dark grounds for impact.', examples: [] },
      voice: { umbrella: 'Orbit ships open releases.', line: 'Release, open', source: 'From the messaging framework', note: '', attributes: [] },
    },
    report: { sources_read: [], sources_failed: [], gaps: [], notes: '' },
    websiteUrl: 'https://orbit.example.org',
    generatedAt: '2026-10-18T00:00:00Z',
    agentVersion: '2.1.0',
  };
}

describe('brandKitLogoFileName', () => {
  it('takes the last segment of a name, a ZIP member or a URL, decoded, without query or fragment', () => {
    expect(brandKitLogoFileName('orbit-horizontal.svg')).toBe('orbit-horizontal.svg');
    expect(brandKitLogoFileName('brand.zip/logos/orbit-mark.svg')).toBe('orbit-mark.svg');
    expect(brandKitLogoFileName('https://orbit.example.org/assets/Orbit%20Logo%20(white).svg?v=3#top')).toBe('Orbit Logo (white).svg');
  });

  it('gives no name for an opaque, hash-like upload id or a URL with no file in it', () => {
    expect(brandKitLogoFileName(CDN_LOGO_URL)).toBeNull();
    expect(brandKitLogoFileName('https://cdn.example.org/u/3f2504e0-4f89-11d3-9a0c-0305e82c3301.png')).toBeNull();
    expect(brandKitLogoFileName('https://cdn.example.org/u/Xk29fPq83LmZr0aBv7TnQe.svg')).toBeNull();
    expect(brandKitLogoFileName('https://orbit.example.org')).toBeNull();
    expect(brandKitLogoFileName('')).toBeNull();
  });

  it('keeps a readable name that happens to carry a size or a short hash', () => {
    expect(brandKitLogoFileName('https://cdn.example.org/orbit-logo-838x203.svg')).toBe('orbit-logo-838x203.svg');
    expect(brandKitLogoFileName('logo-v2-a1b2.svg')).toBe('logo-v2-a1b2.svg');
  });
});

describe('brandKitBuiltFrom', () => {
  it('never puts a long CDN URL in the copy: an opaque upload is "the logo you supplied"', () => {
    const builtFrom = brandKitBuiltFrom(kitWith({ primary: { ref: CDN_LOGO_URL, svg: SVG } }));
    expect(builtFrom).toBe(
      'Built from the logo you supplied, the messaging framework and the brand colors found in the logo artwork. For the full voice, persona and messaging rules, see the messaging framework.'
    );
    expect(builtFrom).not.toContain('https://');
    expect(builtFrom).not.toContain('cdn.sanity.io');
    expect(builtFrom).not.toContain('0f3e9c2b');
  });

  it('counts several opaque uploads, names the readable files, and lists them in words', () => {
    expect(brandKitArtworkInWords(kitWith({ primary: { ref: CDN_LOGO_URL, svg: SVG }, symbol: { ref: CDN_LOGO_URL.replace('0f3e', '1a2b'), svg: SVG } }))).toBe(
      'the 2 logo files you supplied'
    );
    expect(brandKitArtworkInWords(kitWith({ primary: { ref: 'https://orbit.example.org/img/orbit-logo.svg', svg: SVG } }))).toBe(
      'the logo file orbit-logo.svg'
    );
    expect(
      brandKitArtworkInWords(
        kitWith({
          primary: { ref: 'orbit-horizontal.svg', svg: SVG },
          stacked: { ref: 'brand.zip/orbit-stacked.svg', svg: SVG },
          symbol: { ref: CDN_LOGO_URL, svg: SVG },
        })
      )
    ).toBe('the logo files orbit-horizontal.svg, orbit-stacked.svg and one more logo file you supplied');
  });

  it('names the same file once when it fills two slots, and says so when there is no artwork yet', () => {
    const file = { ref: 'orbit-horizontal.svg', svg: SVG };
    expect(brandKitArtworkInWords(kitWith({ primary: file, reversed: file }))).toBe('the logo file orbit-horizontal.svg');
    expect(brandKitBuiltFrom(kitWith({}))).toContain('Built from placeholder marks (no logo files yet), the messaging framework');
  });
});

describe('the book’s view model', () => {
  it('names each logo by its file name, or as the logo you supplied, for captions and alt text — never by URL', () => {
    const view = buildBrandKitBookView(kitWith({ primary: { ref: CDN_LOGO_URL, svg: SVG }, stacked: { ref: 'orbit-stacked.png', svg: null } }));
    expect(view.logos.primary?.name).toBe('the logo you supplied');
    expect(view.logos.stacked?.name).toBe('orbit-stacked.png');
    expect(view.builtFrom).not.toContain('https://');
  });

  it('draws the supplied reversed artwork unfiltered on the reversed tile, and filters the primary lockup only without one', () => {
    const colorways = ['Full colour', 'Reversed', 'On the tint', 'One colour'].map((name) => ({ name, ground: 'x', logo: 'x' }));
    const withColorways = (kit: BrandKitRevision): BrandKitRevision => ({ ...kit, chapters: { ...kit.chapters, logo: { ...kit.chapters.logo, colorways } } });
    const primary = { ref: 'orbit-horizontal.svg', svg: SVG };
    const supplied = buildBrandKitBookView(withColorways(kitWith({ primary, reversed: { ref: 'orbit-reversed.svg', svg: SVG } }))).colorways;
    expect(supplied.map((tile) => [tile.logo?.name, tile.logoFilter])).toEqual([
      ['orbit-horizontal.svg', ''],
      ['orbit-reversed.svg', ''],
      ['orbit-horizontal.svg', ''],
      ['orbit-horizontal.svg', 'brightness(0)'],
    ]);
    // The symbol is never the supplied reversed lockup: the reversed tile still turns a dark symbol white.
    expect(supplied.map((tile) => tile.symbolFilter)).toEqual(['', 'brightness(0) invert(1)', '', 'brightness(0)']);
    const fallback = buildBrandKitBookView(withColorways(kitWith({ primary }))).colorways[1];
    expect([fallback.logo?.name, fallback.logoFilter]).toEqual(['orbit-horizontal.svg', 'brightness(0) invert(1)']);
  });

  it('says where each palette value was found without a raw URL: the logo by name, a stylesheet by its site', () => {
    const view = buildBrandKitBookView(kitWith({ primary: { ref: CDN_LOGO_URL, svg: SVG } }));
    expect(view.palette.map((card) => card.source)).toEqual([
      'From the logo artwork — the logo you supplied',
      'From the site’s CSS — orbit.example.org',
      'The page ground',
      'No source — check it — chosen',
    ]);
    expect(brandKitFoundIn({ kind: 'logo', source: 'orbit-horizontal.svg' })).toBe('From the logo artwork — orbit-horizontal.svg');
  });

  it('summarises the six chapters for the web view’s overview, each with the tab that opens it', () => {
    const summaries = brandKitChapterSummaries(kitWith({}));
    expect(summaries.map((chapter) => [chapter.id, chapter.number, chapter.title])).toEqual([
      ['logo', '01', 'Logo'],
      ['color', '02', 'Color'],
      ['type', '03', 'Type'],
      ['visual', '04', 'Visual'],
      ['usage', '05', 'Usage'],
      ['voice', '06', 'Voice'],
    ]);
    expect(summaries.map((chapter) => chapter.summary)).toEqual([
      'One lockup, one symbol.',
      'Ink on white.',
      'Inter throughout.',
      'Real people.',
      'Dark grounds for impact.',
      'Orbit ships open releases.',
    ]);
  });

  it('sets every swatch label in a colour that reaches WCAG AA on it — black on a medium orange, where white and the dark both fall short', () => {
    const orange = '#F37625';
    const dark = '#4D4E4E';
    const onOrange = (inkLuminance: number): number => brandKitContrastRatio(brandKitLuminance(orange), inkLuminance);
    expect(onOrange(1)).toBeLessThan(4.5);
    expect(onOrange(brandKitLuminance(dark))).toBeLessThan(4.5);

    expect(brandKitLabelInk(orange, dark)).toBe('black');
    expect(onOrange(0)).toBeGreaterThanOrEqual(4.5);
    // The kit's dark wherever it is legible, white on a dark swatch.
    expect(brandKitLabelInk('#E9EEF5', '#20232A')).toBe('#20232A');
    expect(brandKitLabelInk('#20232A', '#20232A')).toBe('white');

    const inkLuminance = (ink: string): number => {
      if (ink === 'white') {
        return 1;
      }
      return ink === 'black' ? 0 : brandKitLuminance(ink);
    };
    const cards = buildBrandKitBookView(kitWith({})).palette;
    for (const card of cards) {
      expect(brandKitContrastRatio(brandKitLuminance(card.hex), inkLuminance(card.ink))).toBeGreaterThanOrEqual(4.5);
    }
    expect(cards.find((card) => card.name === 'Ink')?.ink).toBe('white');
    expect(cards.find((card) => card.name === 'White')?.ink).toBe('#20232A');
  });

  it('prints the version the page shows, the kit’s own draft version when none is given', () => {
    expect(buildBrandKitBookView({ ...kitWith({}), version: 1 }).versionLabel).toBe('V1.0');
    expect(buildBrandKitBookView({ ...kitWith({}), version: 1 }, 3).versionLabel).toBe('V3.0');
    expect(buildBrandKitBookView({ ...kitWith({}), version: 2 }, null).versionLabel).toBe('V2.0');
  });
});
