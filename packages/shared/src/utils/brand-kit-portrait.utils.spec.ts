// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { brandKitTestRevision } from './__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView } from './brand-kit-book.utils';
import {
  brandKitPortraitApprovalLine,
  brandKitPortraitArtwork,
  brandKitPortraitBuiltFrom,
  brandKitPortraitContrast,
  brandKitPortraitContrastGrade,
  brandKitPortraitContrastMatrix,
  brandKitPortraitDate,
  brandKitPortraitFiles,
  brandKitPortraitPaletteSource,
  brandKitPortraitReadableSource,
  brandKitPortraitShare,
  brandKitPortraitSources,
  brandKitPortraitTypeSample,
  brandKitPortraitTypeSource,
  brandKitPortraitUsageCards,
  brandKitPortraitWeightName,
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

describe('the contrast page’s matrix', () => {
  it('grades a ratio by the WCAG thresholds the mock uses', () => {
    expect(brandKitPortraitContrastGrade(8.3).label).toBe('AAA');
    expect(brandKitPortraitContrastGrade(7).label).toBe('AAA');
    expect(brandKitPortraitContrastGrade(4.5).label).toBe('AA');
    expect(brandKitPortraitContrastGrade(3).label).toBe('Large only');
    expect(brandKitPortraitContrastGrade(2.8).label).toBe('Fails');
  });

  it('pairs every palette colour as text with every colour as ground, computed from the hex values, blank on the diagonal', () => {
    expect(brandKitPortraitContrast('#4D4E4E', '#FFFFFF')).toBe(8.35);
    const matrix = brandKitPortraitContrastMatrix(view);
    expect(matrix.map((row) => row.name)).toEqual(['Charcoal', 'White', 'Orange', 'Mid gray']);
    expect(matrix[0].cells.map((cell) => cell.ratio)).toEqual([null, 8.35, 2.95, 1.82]);
    expect(matrix[1].cells[0]).toEqual({ foreground: '#FFFFFF', background: '#4D4E4E', ratio: 8.35 });
  });
});

describe('the type page’s strings', () => {
  it('names a weight as the mock does and leaves an uncommon one as its number', () => {
    expect(brandKitPortraitWeightName(400)).toBe('Regular 400');
    expect(brandKitPortraitWeightName(650)).toBe('650');
  });

  it('fills each scale step from the kit’s own words, whole, and names the font source by its host', () => {
    const samples = view.type.scale.map((step) => brandKitPortraitTypeSample(view, step));
    expect(samples).toEqual([view.voice.line, view.voice.line, view.voice.line, 'Plain', view.voice.umbrella, view.footer]);
    expect(brandKitPortraitTypeSample({ ...view, voice: { ...view.voice, umbrella: '', attributes: [] } }, view.type.scale[4])).toBe(view.voice.line);
    expect(brandKitPortraitTypeSource('https://one.example.org/brand')).toBe('one.example.org');
    expect(brandKitPortraitTypeSource('Named in the brand guide')).toBe('Named in the brand guide');
  });
});

describe('the usage page’s cards', () => {
  it('gives each card the kit’s line for its layout and the mock’s accent moment, from the kit’s examples', () => {
    const cards = brandKitPortraitUsageCards(view);
    expect(cards.map((card) => card.layout)).toEqual(['keynote', 'social', 'report', 'announcement']);
    expect(cards.map((card) => card.text)).toEqual([view.voice.umbrella, view.voice.line, view.voice.line, 'New members join Project One']);
    expect(cards.map((card) => card.accentMoment)).toEqual(['none (grid ground)', 'the card itself', 'none', 'the top rule']);
    expect(cards[2]).toMatchObject({ name: 'Report cover', format: 'letter', ground: 'white' });
    expect(brandKitPortraitUsageCards({ ...view, usageTiles: [] })).toEqual([]);
  });
});

describe('the Sources page’s lists', () => {
  it('writes a source in words: the LFX record by name, a stylesheet chunk as the host’s stylesheets, a URL bare', () => {
    expect(brandKitPortraitReadableSource('LFX record')).toBe('The LFX project record');
    expect(brandKitPortraitReadableSource('https://one.example.org/_next/static/chunks/app.css')).toBe('one.example.org stylesheets');
    expect(brandKitPortraitReadableSource('https://one.example.org/brand?x=1')).toBe('one.example.org/brand');
    // An uploaded file is named as the logo files, never by its file name.
    expect(brandKitPortraitReadableSource('logo.svg')).toBe('the uploaded logo files');
    expect(brandKitPortraitReadableSource('Logo-Stacked.PNG')).toBe('the uploaded logo files');
  });

  it('reads only what the run record holds, folds duplicate sources and keeps a real conflict only', () => {
    const plain = brandKitPortraitSources(view);
    expect(plain).toEqual({ read: ['one.example.org'], failed: [], warnings: [], missing: [], sharedFix: '', gaps: [], notes: '', conflicts: [] });
    const rich = brandKitPortraitSources({
      ...view,
      report: {
        sources_read: ['https://one.example.org', 'https://one.example.org/_next/static/chunks/a.css', 'https://one.example.org/_next/static/chunks/b.css'],
        sources_failed: [{ name: 'https://one.example.org/brand.pdf', reason: 'HTTP 404' }],
        gaps: ['No symbol file.', ' '],
        notes: ' A note. ',
        color_conflicts: [
          { name: 'Charcoal', values: [{ hex: '#4D4E4E', source: 'LFX record' }], chosen: '#4D4E4E' },
          {
            name: 'Orange',
            values: [
              { hex: '#F37625', source: 'https://one.example.org/_next/static/chunks/a.css' },
              { hex: '#F07000', source: 'logo.svg' },
            ],
            chosen: '#F37625',
          },
        ],
      },
    });
    expect(rich.read).toEqual(['one.example.org', 'one.example.org stylesheets']);
    expect(rich.failed).toEqual([{ source: 'one.example.org/brand.pdf', reason: 'HTTP 404' }]);
    expect(rich.gaps).toEqual(['No symbol file.']);
    expect(rich.notes).toBe('A note.');
    expect(rich.conflicts.map((conflict) => conflict.name)).toEqual(['Orange']);
    expect(rich.conflicts[0].values.map((value) => value.source)).toEqual(['one.example.org stylesheets', 'the uploaded logo files']);
  });

  it('takes a v2 report’s findings, names the missing assets by the shared labels and lifts a fix they all share', () => {
    const sources = brandKitPortraitSources({
      ...view,
      report: {
        ...view.report,
        findings: {
          sources_failed: [{ source: 'https://one.example.org/brand', kind: 'brand_page', reason: 'Timed out', detail: 'ETIMEDOUT' }],
          missing_assets: [
            { asset: 'logo_stacked', reason: 'Not in the record', fix: 'Upload the stacked file as SVG.' },
            { asset: 'logo_symbol', reason: 'Not in the record', fix: 'Upload the symbol file as SVG.' },
          ],
          warnings: [
            { code: 'font_unverified', text: ' Font weights unverified. ', source: 'https://one.example.org' },
            { code: 'color_conflict', text: 'Two values for Orange.' },
          ],
        },
      },
    });
    expect(sources.failed).toEqual([{ source: 'one.example.org/brand', reason: 'Timed out' }]);
    expect(sources.missing).toEqual([
      { asset: 'Stacked logo', reason: 'Not in the record', fix: '' },
      { asset: 'Symbol', reason: 'Not in the record', fix: '' },
    ]);
    expect(sources.sharedFix).toBe('Upload each file as SVG.');
    expect(sources.warnings).toEqual([{ text: 'Font weights unverified.', source: 'one.example.org' }]);
  });
});
