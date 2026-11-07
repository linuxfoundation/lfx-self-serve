// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { brandKitReportV2Fixture } from './__fixtures__/brand-kit-report-v2.fixture';
import { brandKitTestRevision } from './__fixtures__/brand-kit-revision.fixture';
import {
  BRAND_KIT_PORTRAIT_FIT_MIN_PX,
  BRAND_KIT_PORTRAIT_TYPE_PAGE,
  BRAND_KIT_PORTRAIT_TYPE_SAMPLE_TRACKING_EM,
} from '../constants/brand-kit-portrait.constants';
import { lfxColors } from '../constants/colors.constants';
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
  brandKitPortraitFitSize,
  brandKitPortraitAttributesFit,
  brandKitPortraitContentsLayout,
  brandKitPortraitGradePill,
  brandKitPortraitMessageCard,
  brandKitPortraitSourcesFit,
  brandKitPortraitPaletteSource,
  brandKitPortraitReadableSource,
  brandKitPortraitShare,
  brandKitPortraitSources,
  brandKitPortraitTypeLayout,
  brandKitPortraitTypeSample,
  brandKitPortraitTypeSource,
  brandKitPortraitUsageCards,
  brandKitPortraitWeightName,
  brandKitPortraitWhiteContrast,
} from './brand-kit-portrait.utils';
import { mktgPortraitLineFits } from './mktg-portrait-print.utils';

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
    expect(rows[0]).toEqual({ slot: 'primary', name: 'Horizontal lockup', format: 'SVG', variant: 'Full color', source: 'Supplied' });
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
  it('grades an unrounded ratio by the WCAG thresholds, in the kit’s own grade words, with the app’s semantic inks', () => {
    expect(brandKitPortraitContrastGrade(8.3)).toBe('AAA');
    expect(brandKitPortraitContrastGrade(7)).toBe('AAA');
    expect(brandKitPortraitContrastGrade(4.5)).toBe('AA');
    // 4.46 is labelled 4.4 (cut, not rounded) and graded as it is: not AA.
    expect(brandKitPortraitContrastGrade(4.46)).toBe('Large text only');
    expect(brandKitPortraitContrastGrade(3)).toBe('Large text only');
    expect(brandKitPortraitContrastGrade(2.96)).toBe('Fails');
    expect(brandKitPortraitGradePill('AA')).toEqual({ label: 'AA', background: lfxColors.emerald[50], color: lfxColors.emerald[700] });
    expect(brandKitPortraitGradePill('Fails').color).toBe(lfxColors.red[600]);
  });

  it('pairs every palette colour as text with every colour as ground, computed unrounded from the hex values, blank on the diagonal', () => {
    expect(brandKitPortraitContrast('#4D4E4E', '#FFFFFF')).toBeCloseTo(8.35, 2);
    const matrix = brandKitPortraitContrastMatrix(view);
    expect(matrix.map((row) => row.name)).toEqual(['Charcoal', 'White', 'Orange', 'Mid gray']);
    expect(matrix[0].cells.map((cell) => cell.label)).toEqual(['', '8.3', '2.9', '1.8']);
    expect(matrix[0].cells.map((cell) => cell.grade?.label ?? null)).toEqual([null, 'AAA', 'Fails', 'Fails']);
    // 2.95 is labelled 2.9 (cut, never rounded up to a threshold) and fails: graded on the ratio, not on its label.
    expect(matrix[0].cells[2].ratio).toBeCloseTo(2.95, 2);
    expect(matrix[0].cells.map((cell) => cell.tinted)).toEqual([true, false, true, true]);
    expect(matrix[1].cells[0]).toMatchObject({ foreground: '#FFFFFF', background: '#4D4E4E', label: '8.3', tinted: true });
  });
});

describe('the type page’s strings', () => {
  it('names a weight as the mock does and leaves an uncommon one as its number', () => {
    expect(brandKitPortraitWeightName(400)).toBe('Regular 400');
    expect(brandKitPortraitWeightName(650)).toBe('650');
  });

  it('keeps the contents list in one column with the blocks at y 690 for fifteen rows, moves the blocks down for sixteen, and goes to two columns for seventeen', () => {
    // Fifteen rows end at y 658, 32 px above the blocks; sixteen at 692, so the blocks move to 716 (ending at 986, under 990).
    expect(brandKitPortraitContentsLayout(14)).toEqual({ columns: 1, blocksTop: 690 });
    expect(brandKitPortraitContentsLayout(15)).toEqual({ columns: 1, blocksTop: 690 });
    expect(brandKitPortraitContentsLayout(16)).toEqual({ columns: 1, blocksTop: 716 });
    // Seventeen rows would put the blocks at 750, ending past 990: two columns of nine, and the blocks back at 690.
    expect(brandKitPortraitContentsLayout(17)).toEqual({ columns: 2, blocksTop: 690 });
    expect(brandKitPortraitContentsLayout(30)).toEqual({ columns: 2, blocksTop: 690 });
  });

  it('sets the umbrella-message card at 19 px when the message fits, smaller when it must, and prints the brand line when it cannot fit whole', () => {
    expect(brandKitPortraitMessageCard(view)).toEqual({ text: 'Where organizations fund Project One.', size: 19 });
    // About 120 characters: six lines at 19 px overrun the box, so the message is set in the grammar's steps until it fits.
    const longer = 'Where organizations fund the open computing standards every member builds on, together and in the open, every year.';
    const fitted = brandKitPortraitMessageCard({ ...view, voice: { ...view.voice, umbrella: longer } });
    expect(fitted.text).toBe(longer);
    expect(fitted.size).toBeLessThan(19);
    expect(fitted.size).toBeGreaterThanOrEqual(13.5);
    // A message the box cannot hold at the smallest step is never cut: the brand line is printed instead.
    const essay = `${longer} ${longer} ${longer}`;
    expect(brandKitPortraitMessageCard({ ...view, voice: { ...view.voice, umbrella: essay } })).toEqual({ text: view.voice.line, size: 19 });
    expect(brandKitPortraitMessageCard({ ...view, voice: { ...view.voice, umbrella: '' } }).text).toBe(view.voice.line);
  });

  it('fills each scale step from the kit’s own words, whole, and names the font source by its host', () => {
    const samples = view.type.scale.map((step) => brandKitPortraitTypeSample(view, step));
    expect(samples).toEqual(['Project One', view.voice.line, view.voice.line, view.voice.line, view.voice.umbrella, view.footer]);
    expect(brandKitPortraitTypeSample({ ...view, voice: { ...view.voice, umbrella: '' } }, view.type.scale[4])).toBe(view.voice.line);
    // A sample is set at its step's size when its measured line fits (the kit's face, its weight, its tracking), smaller
    // (never cut) when it would not — as the served AAIF book shows (QA round 1, p11): the display line at 64 fits 704,
    // the tracked specimen (-0.015em) at 48 fits 704 (≈696 px drawn), the untracked H2 line at 32 wraps the 480 px
    // column (so it is set at 30.5, one line), the H3 at 24 fits …
    const sans = { weight: 500, family: 'Instrument Sans' };
    expect(brandKitPortraitFitSize('Agentic AI Foundation', 704, 64, sans)).toBe(64);
    expect(brandKitPortraitFitSize('Open foundations for agentic AI.', 704, 48, { ...sans, tracking: BRAND_KIT_PORTRAIT_TYPE_SAMPLE_TRACKING_EM })).toBe(48);
    expect(mktgPortraitLineFits('Open foundations for agentic AI.', 480, 32, sans)).toBe(false);
    expect(brandKitPortraitFitSize('Open foundations for agentic AI.', 480, 32, sans)).toBe(30.5);
    expect(brandKitPortraitFitSize('Open foundations for agentic AI.', 480, 24, sans)).toBe(24);
    // … while the synthetic line in Montserrat, a wide face, is set smaller in the 480 px H2 column.
    expect(brandKitPortraitFitSize('Project One', 704, 64, { weight: 500, family: view.type.family })).toBe(64);
    expect(brandKitPortraitFitSize(view.voice.line, 480, 32, { weight: 500, family: view.type.family })).toBe(26.5);
    expect(brandKitPortraitFitSize(view.voice.line, 704, 48, { weight: 500, family: view.type.family })).toBe(38);
    // No floor but the readable minimum: a line no size above it holds is set at the minimum and wraps.
    expect(
      brandKitPortraitFitSize('Open standards, open governance and open collaboration for every kind of computing everywhere', 704, 48, { weight: 500 })
    ).toBe(13);
    expect(brandKitPortraitFitSize('A very long project name that fits no line at all at this size', 200, 64, { weight: 500 })).toBe(
      BRAND_KIT_PORTRAIT_FIT_MIN_PX
    );
    expect(brandKitPortraitTypeSource('https://one.example.org/brand')).toBe('one.example.org');
    expect(brandKitPortraitTypeSource('Named in the brand guide')).toBe('Named in the brand guide');
  });

  it('places the lower blocks at y 830 while the scale ends above it, and under the scale when a three-line body step runs past', () => {
    const c = BRAND_KIT_PORTRAIT_TYPE_PAGE;
    // The synthetic umbrella is one line at 18/30: the scale ends well above 830 and the blocks keep the mock's y.
    const short = brandKitPortraitTypeLayout(view, 704);
    expect(short.steps.map((step) => step.step)).toEqual(['display', 'h2', 'h3', 'eyebrow', 'body', 'caption']);
    expect(short.steps.map((step) => step.size)).toEqual([64, 26.5, 24, 14, 18, 12]);
    expect(short.steps[4]).toMatchObject({ sample: view.voice.umbrella, size: 18, line_height: 30, spec: '400 · 18/30' });
    expect(short.scaleEnd).toBeLessThan(c.lowerTop - c.lowerGap);
    expect(short).toMatchObject({ lowerTop: 830, bodyScale: 1, cut: false });
    expect(short.sourceLines).toEqual([
      { text: 'Montserrat · Google Fonts · weights 400, 700', muted: false },
      { text: 'Fallback: none', muted: false },
      { text: 'Named on one.example.org', muted: true },
    ]);
    // A live foundation's umbrella (three lines at 18/30 in the 480 px sample column) takes the caption row to y 850: the
    // blocks follow the scale's real end, 16 px under it, the body step still at 18/30, and the stack ends above y 990.
    const umbrella =
      'The Synthetic Foundation is the neutral home at the Linux Foundation where the open protocols and tools for agents are governed in the open.';
    const three = brandKitPortraitTypeLayout({ ...view, voice: { ...view.voice, umbrella } }, 704);
    expect(three.steps[4]).toMatchObject({ sample: umbrella, size: 18, line_height: 30 });
    expect(three.scaleEnd).toBeGreaterThan(c.lowerTop);
    expect(three.lowerTop).toBe(Math.ceil(three.scaleEnd) + c.lowerGap);
    expect(three.lowerTop).toBeGreaterThan(830);
    expect(three.lowerTop).toBeLessThan(c.bottom - 60);
    expect(three).toMatchObject({ bodyScale: 1, cut: false });
    // The served AAIF book (QA round 1b): Instrument Sans, the H2 line set at 30.5 in one line (its label saying so), the
    // display, H3 and eyebrow at size, and the three-line umbrella leaving the body step at 18/30 under "400 · 18/30".
    const aaif = brandKitPortraitTypeLayout(
      {
        ...view,
        type: { ...view.type, family: 'Instrument Sans' },
        voice: { ...view.voice, line: 'Open foundations for agentic AI.', umbrella },
      },
      704
    );
    expect(aaif.steps.map((step) => [step.step, step.size, step.spec])).toEqual([
      ['display', 64, '500 · 64/72'],
      ['h2', 30.5, '500 · 30.5/40'],
      ['h3', 24, '500 · 24/32'],
      ['eyebrow', 14, '500 · 14/20'],
      ['body', 18, '400 · 18/30'],
      ['caption', 12, '500 · 12/16'],
    ]);
    expect(aaif).toMatchObject({ bodyScale: 1, cut: false });
    expect(aaif.lowerTop).toBeLessThan(c.bottom - 60);
  });

  it('gives the body step size, never below 14 px, before anything is cut when the stack would cross the footer', () => {
    const c = BRAND_KIT_PORTRAIT_TYPE_PAGE;
    const sentence = 'Where organizations fund the open computing standards every member builds on, together and in the open, every year.';
    // Two sentences: five lines at 18/30 would push the blocks past the footer, so the body step is set smaller (a whole
    // message still) until the stack ends by y 990 — four lines at 14/24 here.
    const long = brandKitPortraitTypeLayout({ ...view, voice: { ...view.voice, umbrella: `${sentence} ${sentence}` } }, 704);
    expect(long.bodyScale).toBeLessThan(1);
    expect(long.steps[4].size).toBeGreaterThanOrEqual(c.bodyMinPx);
    expect(long.steps[4].size).toBeLessThan(18);
    expect(long.steps[4].spec).toBe(`400 · ${long.steps[4].size}/${long.steps[4].line_height}`);
    expect(long.steps[4].sample).toBe(`${sentence} ${sentence}`);
    expect(long.cut).toBe(false);
    expect(long.lowerTop).toBeLessThan(c.bottom);
    // An essay no size down to 14 px holds is cut at a sentence, and the result says so.
    const essay = Array(12).fill(sentence).join(' ');
    const cut = brandKitPortraitTypeLayout({ ...view, voice: { ...view.voice, umbrella: essay } }, 704);
    expect(cut.steps[4].size).toBe(c.bodyMinPx);
    expect(cut.cut).toBe(true);
    expect(cut.steps[4].sample.length).toBeLessThan(essay.length);
    expect(cut.steps[4].sample.endsWith('.')).toBe(true);
    expect(cut.lowerTop).toBeLessThan(c.bottom);
  });
});

describe('the usage page’s cards', () => {
  it('gives each card the kit’s line for its layout and the mock’s accent moment, from the kit’s examples', () => {
    const cards = brandKitPortraitUsageCards(view, { approvedAt: '2026-11-06T10:00:00Z', approvedBy: null });
    expect(cards.map((card) => card.layout)).toEqual(['keynote', 'social', 'report', 'announcement']);
    expect(cards.map((card) => card.text)).toEqual([view.voice.line, view.voice.line, 'Project One annual report 2026', 'New members join Project One']);
    // Without a recorded approval the report cover carries no year: never a made-up one.
    expect(brandKitPortraitUsageCards(view)[2].text).toBe('Project One annual report');
    expect(cards.map((card) => card.accentMoment)).toEqual(['none (grid ground)', 'the card itself', 'none', 'the top rule']);
    expect(cards[2]).toMatchObject({ name: 'Report cover', format: 'letter', ground: 'white' });
    expect(brandKitPortraitUsageCards({ ...view, usageTiles: [] })).toEqual([]);
  });
});

describe('the Voice page’s attributes', () => {
  it('keeps four attributes as written, sets eight long ones smaller in the grammar’s steps, and cuts only what no step holds', () => {
    expect(brandKitPortraitAttributesFit(view.voice.attributes)).toEqual({ scale: 1, cut: false, attributes: view.voice.attributes });
    const line = 'Every claim names its number and its source, in the words the reader would use, and never a superlative the record cannot back.';
    const eight = Array.from({ length: 8 }, (_, index) => ({ name: `Attribute ${index + 1}`, line }));
    const fitted = brandKitPortraitAttributesFit(eight);
    expect(fitted.scale).toBeLessThan(1);
    expect(fitted.scale).toBeGreaterThanOrEqual(0.72);
    expect(fitted.cut).toBe(false);
    expect(fitted.attributes).toEqual(eight);
    const twenty = Array.from({ length: 20 }, (_, index) => ({ name: `Attribute ${index + 1}`, line: `${line} ${line}` }));
    const cut = brandKitPortraitAttributesFit(twenty);
    expect(cut.scale).toBe(0.72);
    expect(cut.cut).toBe(true);
    expect(cut.attributes).toHaveLength(20);
    expect(cut.attributes.some((attribute) => attribute.line.length < `${line} ${line}`.length)).toBe(true);
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
    expect(rich.conflicts[0].values.map((value) => value.label)).toEqual(['#F37625 · kept', '#F07000']);
    expect(rich.conflicts[0].values.map((value) => value.kept)).toEqual([true, false]);
  });

  it('prints a live record’s sources in a reader’s words: the site root as its host, a conflict value’s `<kind>: <url>` as the place itself', () => {
    const live = brandKitPortraitSources({ ...view, report: brandKitReportV2Fixture() });
    // The record read the root, four stylesheet chunks (folded), the brand page and the LFX record: no raw address, no chunk name.
    expect(live.read).toEqual(['aaif.io', 'aaif.io stylesheets', 'aaif.io/brand', 'The LFX project record']);
    expect(live.failed.map((entry) => entry.source)).toEqual(['aaif.io/brand-guidelines', 'the logo package linked from the site']);
    expect(live.missing[0].reason).toBe("The site's header links a logo image that was not read in this run, so the kit shows placeholder marks.");
    expect(live.conflicts.map((conflict) => conflict.name)).toEqual(['Coral']);
    expect(live.conflicts[0].values.map((value) => value.source)).toEqual(['aaif.io/brand', 'aaif.io stylesheets']);
    expect(JSON.stringify(live)).not.toMatch(/https?:|_next|brand_page|site_css/);
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

  it('fits the two columns to their room: as written when they fit, smaller together for a long record, cut at a sentence when no size holds it', () => {
    const short = brandKitPortraitSourcesFit(brandKitPortraitSources(view), true);
    expect(short).toEqual({ scale: 1, cut: false, sources: brandKitPortraitSources(view) });
    // Forty read sources at 20 px a line overrun the 636 px above the accepted box; the columns shrink in the grammar's steps.
    const sentence = 'The page names the typeface and its weights, and links the logo package the site offers to the press.';
    const long = brandKitPortraitSources({
      ...view,
      report: { ...view.report, sources_read: Array.from({ length: 40 }, (_, index) => `https://one.example.org/page-${index + 1}`) },
    });
    const fitted = brandKitPortraitSourcesFit(long, true);
    expect(fitted.scale).toBeLessThan(1);
    expect(fitted.scale).toBeGreaterThanOrEqual(0.72);
    expect(fitted.cut).toBe(false);
    expect(fitted.sources.read).toEqual(long.read);
    // Without the accepted box the same record has the room down to y 990: it fits at a larger size.
    expect(brandKitPortraitSourcesFit(long, false).scale).toBeGreaterThan(fitted.scale);
    // Eighty gap sentences hold at no step: the longest lines are cut at a sentence, marked, and the record's lists stay in order.
    const essay = brandKitPortraitSources({ ...view, report: { ...view.report, gaps: Array.from({ length: 80 }, () => `${sentence} ${sentence}`) } });
    const cut = brandKitPortraitSourcesFit(essay, true);
    expect(cut.scale).toBe(0.72);
    expect(cut.cut).toBe(true);
    expect(cut.sources.gaps).toHaveLength(80);
    expect(cut.sources.gaps.some((gap) => gap.length < `${sentence} ${sentence}`.length)).toBe(true);
    expect(cut.sources.read).toEqual(essay.read);
  });
});
