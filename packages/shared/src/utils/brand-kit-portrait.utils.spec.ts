// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { brandKitTestRevision } from './__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView } from './brand-kit-book.utils';
import {
  brandKitPortraitApprovalLine,
  brandKitPortraitArtwork,
  brandKitPortraitBuiltFrom,
  brandKitPortraitDate,
  brandKitPortraitFiles,
  brandKitPortraitPaletteSource,
  brandKitPortraitShare,
  brandKitPortraitWhiteContrast,
} from './brand-kit-portrait.utils';

const SVG = 'data:image/svg+xml,synthetic';
const view = buildBrandKitBookView(brandKitTestRevision(), 4);

describe('brandKitPortraitArtwork', () => {
  it('draws the primary lockup as it is, reversed by filter without a reversed file, and one-colour black', () => {
    expect(brandKitPortraitArtwork(view, 'lockup')).toEqual({ src: view.logos.primary?.src, alt: 'Horizontal lockup', filter: '' });
    expect(brandKitPortraitArtwork(view, 'lockup', 'reversed')?.filter).toBe('brightness(0) invert(1)');
    expect(brandKitPortraitArtwork(view, 'lockup', 'mono')?.filter).toBe('brightness(0)');
  });

  it('prefers the supplied reversed file as it is, and draws nothing for a slot the kit lacks', () => {
    const withReversed = { ...view, logos: { ...view.logos, reversed: { ref: 'r.svg', name: 'r.svg', src: SVG } } };
    expect(brandKitPortraitArtwork(withReversed, 'lockup', 'reversed')).toEqual({ src: SVG, alt: 'Reversed lockup', filter: '' });
    expect(brandKitPortraitArtwork(view, 'symbol')).toBeNull();
    expect(brandKitPortraitArtwork(view, 'stacked')).toBeNull();
    expect(brandKitPortraitArtwork({ ...view, logos: { ...view.logos, primary: null } }, 'lockup', 'reversed')).toBeNull();
    // A PNG the envelope carries no bytes for has no src: nothing is drawn.
    expect(brandKitPortraitArtwork({ ...view, logos: { ...view.logos, stacked: { ref: 's.png', name: 's.png', src: null } } }, 'stacked')).toBeNull();
  });

  it('filters the symbol the same way, from the symbol file or the crop', () => {
    const withSymbol = { ...view, symbol: { ref: 'logo.svg', name: 'logo.svg', src: SVG } };
    expect(brandKitPortraitArtwork(withSymbol, 'symbol', 'reversed')).toEqual({ src: SVG, alt: 'Symbol', filter: 'brightness(0) invert(1)' });
  });
});

describe('brandKitPortraitFiles', () => {
  it('lists the four slots, a missing file as the mock’s plain line, never a file name', () => {
    const rows = brandKitPortraitFiles(view);
    expect(rows.map((row) => row.slot)).toEqual(['primary', 'reversed', 'symbol', 'stacked']);
    expect(rows[0]).toEqual({ slot: 'primary', name: 'Horizontal lockup', format: 'SVG', variant: 'Full colour', source: 'Supplied' });
    expect(rows[1].source).toBe('Not supplied: this book derives it from the horizontal file');
    expect(rows[1].format).toBe('—');
    expect(rows[2].source).toBe('Not supplied');
    expect(rows[3]).toMatchObject({ format: '—', source: 'Not supplied' });
    expect(JSON.stringify(rows)).not.toContain('logo.svg');
  });

  it('names a cropped symbol and a non-SVG file’s format', () => {
    const cropped = { ...view, symbol: { ref: 'logo.svg', name: 'logo.svg', src: SVG } };
    expect(brandKitPortraitFiles(cropped)[2]).toMatchObject({ format: 'SVG (crop)', source: 'Cropped out of the horizontal lockup' });
    const png = { ...view, logos: { ...view.logos, stacked: { ref: 'kit.zip/stacked.PNG', name: 'stacked.PNG', src: null } } };
    expect(brandKitPortraitFiles(png)[3]).toMatchObject({ format: 'PNG', source: 'Supplied' });
    const none = { ...view, logos: { ...view.logos, primary: null } };
    expect(brandKitPortraitFiles(none)[1].source).toBe('Not supplied');
  });
});

describe('the palette page’s strings', () => {
  it('says where a colour was found without a file name or a URL', () => {
    const [charcoal, white, orange] = view.color.palette;
    expect(brandKitPortraitPaletteSource(charcoal)).toBe('From the logo artwork');
    expect(brandKitPortraitPaletteSource(white)).toBe('The page ground');
    expect(brandKitPortraitPaletteSource(orange)).toBe('From the site’s CSS — one.example.org');
    expect(brandKitPortraitPaletteSource({ ...orange, found_in: { kind: 'brand_page', source: 'the brand page' } })).toBe('From the brand page');
    expect(brandKitPortraitPaletteSource({ ...orange, found_in: { kind: 'unsourced', source: '' } })).toBe('No source — check it');
  });

  it('reads a colour’s share from the proportion rows, case-insensitively, null when absent', () => {
    expect(brandKitPortraitShare(view, '#4d4e4e')).toBe(55);
    expect(brandKitPortraitShare(view, '#000000')).toBeNull();
  });

  it('rounds the contrast of white on a colour to a decimal', () => {
    expect(brandKitPortraitWhiteContrast('#F37625')).toBe(2.8);
    expect(brandKitPortraitWhiteContrast('#1E3A8A')).toBe(10.4);
  });
});

describe('the contents page’s strings', () => {
  it('formats the approval date as the mock does, and leaves the line out without one', () => {
    expect(brandKitPortraitDate('2026-11-06T10:00:00Z')).toBe('6 Nov 2026');
    expect(brandKitPortraitDate('not a date')).toBe('');
    expect(brandKitPortraitApprovalLine(null)).toBe('');
    expect(brandKitPortraitApprovalLine({ approvedAt: 'not a date', approvedBy: null })).toBe('');
    expect(brandKitPortraitApprovalLine({ approvedAt: '2026-11-06T10:00:00Z', approvedBy: null })).toBe('Approved 6 Nov 2026');
    expect(brandKitPortraitApprovalLine({ approvedAt: '2026-11-06T10:00:00Z', approvedBy: { name: ' Synthetic Approver ' } })).toBe(
      'Approved 6 Nov 2026 by Synthetic Approver'
    );
  });

  it('says what the kit is built from without naming a file', () => {
    expect(brandKitPortraitBuiltFrom(view)).toBe('Built from the uploaded logo files, the messaging framework and the brand colors found in the logo artwork.');
    expect(brandKitPortraitBuiltFrom({ ...view, logos: { primary: null, stacked: null, symbol: null, reversed: null } })).toBe(
      'Built from the messaging framework and the brand colors the run found.'
    );
  });
});
