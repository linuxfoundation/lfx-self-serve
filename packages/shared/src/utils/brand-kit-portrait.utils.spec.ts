// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { brandKitReportV2Fixture } from './__fixtures__/brand-kit-report-v2.fixture';
import { brandKitOverfullFixture, brandKitPngOnlyFixture, brandKitTestRevision } from './__fixtures__/brand-kit-revision.fixture';
import {
  BRAND_KIT_PORTRAIT_ATTRIBUTES,
  BRAND_KIT_PORTRAIT_INTRO,
  BRAND_KIT_PORTRAIT_RECOLOR_FILTER,
  BRAND_KIT_PORTRAIT_RULE_LISTS,
  BRAND_KIT_PORTRAIT_SOURCES,
  BRAND_KIT_PORTRAIT_VOICE_MESSAGES,
  BRAND_KIT_PORTRAIT_TYPE_PAGE,
  BRAND_KIT_PORTRAIT_TYPE_SAMPLE_TRACKING_EM,
} from '../constants/brand-kit-portrait.constants';
import { lfxColors } from '../constants/colors.constants';
import { buildBrandKitBookView } from './brand-kit-book.utils';
import {
  brandKitPortraitAccentMoment,
  brandKitPortraitApprovalLine,
  brandKitPortraitArtwork,
  brandKitPortraitBackCoverLine,
  brandKitPortraitBuiltFrom,
  brandKitPortraitContrast,
  brandKitPortraitContrastGrade,
  brandKitPortraitContrastMatrix,
  brandKitPortraitDate,
  brandKitPortraitFiles,
  brandKitPortraitUndrawableFilesLine,
  brandKitPortraitShortenLine,
  brandKitPortraitShortenParagraph,
  brandKitPortraitAttributesFit,
  brandKitPortraitContentsLayout,
  brandKitPortraitContrastLayout,
  brandKitPortraitIntro,
  brandKitPortraitRetypedName,
  brandKitPortraitRulesFit,
  brandKitPortraitVoiceMessagesFit,
  brandKitPortraitGradePill,
  brandKitPortraitMessageCard,
  brandKitPortraitSourcesFit,
  brandKitPortraitPaletteSource,
  brandKitPortraitPlate,
  brandKitPortraitReadableSource,
  brandKitPortraitShare,
  brandKitPortraitSources,
  brandKitPortraitTypeLayout,
  brandKitPortraitTypeSample,
  brandKitPortraitTypeSource,
  brandKitPortraitUsageCards,
  brandKitPortraitWatchoutDraw,
  brandKitPortraitWeightName,
  brandKitPortraitRatioLabel,
  brandKitPortraitWhiteContrast,
} from './brand-kit-portrait.utils';
import { brandKitPortraitHasLogoFiles, brandKitPortraitHasLogoUploads } from './mktg-portrait-plan.utils';
import {
  mktgNoWidow,
  mktgPortraitBlockHeight,
  mktgPortraitCharsPerLine,
  mktgPortraitLineFits,
  mktgPortraitScaleBlock,
  mktgPortraitWrapLines,
} from './mktg-portrait-print.utils';

const SVG = 'data:image/svg+xml,synthetic';
const view = buildBrandKitBookView(brandKitTestRevision(), 4);

describe('brandKitPortraitArtwork', () => {
  it('draws the primary lockup as it is, and derives the reversed and one-colour marks by filter only from one-colour artwork', () => {
    expect(brandKitPortraitArtwork(view, 'lockup')).toEqual({ src: view.logos.primary?.src, alt: 'Horizontal lockup', filter: '' });
    // The fixture's lockup is drawn in three colours: a filter would flatten it to one shape, so the dark grounds draw
    // it in full colour and the one-colour slot keeps it as it is.
    expect(view.derivable).toEqual({ lockup: false, symbol: false });
    // Reversed, it sits on the white plate (the kit's watch-out forbids full colour bare on a dark ground); one-colour, as it is.
    expect(brandKitPortraitArtwork(view, 'lockup', 'reversed')).toEqual({ src: view.logos.primary?.src, alt: 'Horizontal lockup', filter: '', plate: true });
    expect(brandKitPortraitArtwork(view, 'lockup', 'mono')).toEqual({ src: view.logos.primary?.src, alt: 'Horizontal lockup', filter: '' });
    expect(brandKitPortraitPlate(view)).toBe(true);
    // A supplied reversed file or a one-ink lockup needs no plate.
    expect(brandKitPortraitPlate({ ...view, logos: { ...view.logos, reversed: { ref: 'r.svg', name: 'r.svg', src: SVG } } })).toBe(false);
    expect(brandKitPortraitPlate({ ...view, derivable: { lockup: true, symbol: false } })).toBe(false);
    expect(brandKitPortraitPlate({ ...view, logos: { ...view.logos, primary: null } })).toBe(false);
    const mono = { ...view, derivable: { lockup: true, symbol: false } };
    expect(brandKitPortraitArtwork(mono, 'lockup', 'reversed')).toEqual({
      src: view.logos.primary?.src,
      alt: 'Horizontal lockup',
      filter: 'brightness(0) invert(1)',
    });
    expect(brandKitPortraitArtwork(mono, 'lockup', 'mono')?.filter).toBe('brightness(0)');
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

  it('filters the symbol by its own slot: a one-ink symbol beside a multi-colour lockup reverses, and the other way round never', () => {
    const symbol = { ref: 'logo.svg', name: 'logo.svg', src: SVG };
    const symbolOnly = { ...view, derivable: { lockup: false, symbol: true }, symbol };
    expect(brandKitPortraitArtwork(symbolOnly, 'symbol', 'reversed')).toEqual({ src: SVG, alt: 'Symbol', filter: 'brightness(0) invert(1)' });
    expect(brandKitPortraitArtwork(symbolOnly, 'lockup', 'reversed')?.filter).toBe('');
    const lockupOnly = { ...view, derivable: { lockup: true, symbol: false }, symbol };
    expect(brandKitPortraitArtwork(lockupOnly, 'symbol', 'reversed')).toEqual({ src: SVG, alt: 'Symbol', filter: '', plate: true });
    expect(brandKitPortraitArtwork(lockupOnly, 'symbol', 'mono')?.filter).toBe('');
    expect(brandKitPortraitArtwork(lockupOnly, 'lockup', 'mono')?.filter).toBe('brightness(0)');
  });
});

describe('brandKitPortraitFiles', () => {
  it('lists the four slots, a missing file as the mock’s plain line, never a file name', () => {
    const rows = brandKitPortraitFiles(view);
    expect(rows.map((row) => row.slot)).toEqual(['primary', 'reversed', 'symbol', 'stacked']);
    expect(rows[0]).toEqual({ slot: 'primary', name: 'Horizontal lockup', format: 'SVG', variant: 'Full color', source: 'Supplied' });
    // The reversed slot says the book derives it only when it can (a one-colour primary); the fixture's is three colours.
    expect(rows[1]).toMatchObject({ format: '—', source: 'Not supplied' });
    expect(brandKitPortraitFiles({ ...view, derivable: { lockup: true, symbol: false } })[1].source).toBe(
      'Not supplied: this book derives it from the horizontal file'
    );
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

  it('tells a PNG-only kit from a kit with no uploads: the table lists the supplied files, the tiles’ line names them by the record', () => {
    const pngOnly = buildBrandKitBookView(brandKitPngOnlyFixture(), 4);
    expect(brandKitPortraitHasLogoUploads(pngOnly)).toBe(true);
    expect(brandKitPortraitHasLogoFiles(pngOnly)).toBe(false);
    expect(brandKitPortraitFiles(pngOnly).map((row) => [row.format, row.source])).toEqual([
      ['PNG', 'Supplied'],
      // A PNG lockup is not artwork the book can filter, so the reversed slot is plainly not supplied.
      ['—', 'Not supplied'],
      ['PNG', 'Supplied'],
      ['—', 'Not supplied'],
    ]);
    expect(brandKitPortraitUndrawableFilesLine(pngOnly)).toBe(
      'This book draws inline SVG artwork only. The supplied horizontal lockup (PNG) and symbol (PNG) are listed below and not drawn here.'
    );
    const one = { ...pngOnly, logos: { ...pngOnly.logos, symbol: null } };
    expect(brandKitPortraitUndrawableFilesLine(one)).toBe(
      'This book draws inline SVG artwork only. The supplied horizontal lockup (PNG) is listed below and not drawn here.'
    );
    // Nothing uploaded, or something drawable: no line.
    const none = { ...view, logos: { primary: null, stacked: null, symbol: null, reversed: null }, symbol: null };
    expect(brandKitPortraitHasLogoUploads(none)).toBe(false);
    expect(brandKitPortraitUndrawableFilesLine(none)).toBe('');
    expect(brandKitPortraitUndrawableFilesLine(view)).toBe('');
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

  it('reads the contrast of white on a colour unrounded, and labels it cut to one decimal, so a 4.48 never passes as 4.5', () => {
    expect(brandKitPortraitWhiteContrast('#F37625')).toBeCloseTo(2.83, 2);
    expect(brandKitPortraitRatioLabel(brandKitPortraitWhiteContrast('#F37625'))).toBe('2.8');
    expect(brandKitPortraitRatioLabel(brandKitPortraitWhiteContrast('#1E3A8A'))).toBe('10.3');
    const grey = brandKitPortraitWhiteContrast('#777777');
    expect(grey).toBeLessThan(4.5);
    expect(brandKitPortraitRatioLabel(grey)).toBe('4.4');
    expect(brandKitPortraitContrastGrade(grey)).toBe('Large text only');
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
    // A sample is never set smaller than its step (the editor's rule): a line that fits its measure at the step's size
    // prints whole, one that would not is shortened at a word with an ellipsis (never a bare cut) — as the served AAIF
    // book needs (QA round 1, p11): the display line at 64 fits 704, the tracked specimen (-0.015em) at 48 fits 704, the
    // untracked H2 line at 32 wraps the 480 px column (so it loses its last word), the H3 at 24 fits …
    const sans = { weight: 500, family: 'Instrument Sans' };
    expect(brandKitPortraitShortenLine('Agentic AI Foundation', 704, 64, sans)).toBe('Agentic AI Foundation');
    expect(brandKitPortraitShortenLine('Open foundations for agentic AI.', 704, 48, { ...sans, tracking: BRAND_KIT_PORTRAIT_TYPE_SAMPLE_TRACKING_EM })).toBe(
      'Open foundations for agentic AI.'
    );
    expect(mktgPortraitLineFits('Open foundations for agentic AI.', 480, 32, sans)).toBe(false);
    expect(brandKitPortraitShortenLine('Open foundations for agentic AI.', 480, 32, sans)).toBe('Open foundations for agentic…');
    expect(brandKitPortraitShortenLine('Open foundations for agentic AI.', 480, 24, sans)).toBe('Open foundations for agentic AI.');
    // … while the synthetic line in Montserrat, a wide face, loses words in the 480 px H2 column and at the 48 px specimen.
    const montserrat = { weight: 500, family: view.type.family };
    expect(brandKitPortraitShortenLine('Project One', 704, 64, montserrat)).toBe('Project One');
    expect(brandKitPortraitShortenLine(view.voice.line, 480, 32, montserrat)).toBe('Open standards for one…');
    expect(brandKitPortraitShortenLine(view.voice.line, 704, 48, montserrat)).toBe('Open standards for one…');
    // At least the first word, whatever the measure; spaces never count.
    expect(brandKitPortraitShortenLine('  Interoperability   everywhere ', 40, 64, { weight: 500 })).toBe('Interoperability…');
    expect(brandKitPortraitShortenLine('', 400, 64, {})).toBe('');
    // A shortened sample never ends on a function word: the overfull H3 loses "and" with the word after it.
    const clause = 'The name of the project goes first and the rest of the sentence follows at the same weight.';
    const h3 = brandKitPortraitShortenLine(clause, 340, 24, montserrat);
    expect(h3.length).toBeLessThan(clause.length);
    expect(/\b(and|the|of|so|for|to|in|on|with|at|by|a|an|or|but)$/i.test(h3)).toBe(false);
    // A 30k-character line is shortened by bisection: a dozen measures, well under a tenth of a second.
    const started = performance.now();
    const huge = brandKitPortraitShortenLine(Array.from({ length: 5000 }, (_, index) => `word${index}`).join(' '), 704, 48, montserrat);
    expect(huge.split(' ').length).toBeLessThan(20);
    expect(
      brandKitPortraitShortenParagraph(Array.from({ length: 5000 }, (_, index) => `word${index}`).join(' '), 480, 18, { weight: 400 }, 3).endsWith('…')
    ).toBe(true);
    expect(performance.now() - started).toBeLessThan(100);
    // A paragraph sample is shortened to its lines, cut at a word with an ellipsis, trailing punctuation dropped first.
    const sentence = 'Where organizations fund the open computing standards every member builds on, together and in the open, every year.';
    expect(brandKitPortraitShortenParagraph(view.voice.umbrella, 480, 18, { weight: 400 }, 3)).toBe(view.voice.umbrella);
    const three = brandKitPortraitShortenParagraph(`${sentence} ${sentence} ${sentence}`, 480, 18, { weight: 400 }, 3);
    expect(three.endsWith('…')).toBe(true);
    expect(three.length).toBeLessThan(sentence.length * 2);
    expect(mktgPortraitWrapLines(three, mktgPortraitCharsPerLine(480, 18, { weight: 400 }))).toBeLessThanOrEqual(3);
    expect(/[,;:.—-]…$/.test(three)).toBe(false);
    expect(/\b(and|the|of|so|for|to|in|on|with|at|by|a|an|or|but)…$/i.test(three)).toBe(false);
    expect(brandKitPortraitShortenParagraph(`${sentence} ${sentence}`, 480, 18, { weight: 400 }, 1).split(' ').length).toBeLessThan(12);
    expect(brandKitPortraitTypeSource('https://one.example.org/brand')).toBe('one.example.org');
    expect(brandKitPortraitTypeSource('Named in the brand guide')).toBe('Named in the brand guide');
  });

  it('places the lower blocks at y 830 while the scale ends above it, and under the scale when a three-line body step runs past', () => {
    const c = BRAND_KIT_PORTRAIT_TYPE_PAGE;
    // The synthetic umbrella is one line at 18/30: the scale ends well above 830 and the blocks keep the mock's y. Every
    // step prints at the kit's size, its spec the kit's values; the Montserrat H2 line is shortened to its column.
    const short = brandKitPortraitTypeLayout(view, 704);
    expect(short.steps.map((step) => step.step)).toEqual(['display', 'h2', 'h3', 'eyebrow', 'body', 'caption']);
    expect(short.steps.map((step) => step.size)).toEqual(view.type.scale.map((step) => step.size));
    expect(short.steps.map((step) => step.spec)).toEqual(view.type.scale.map((step) => `${step.weight} · ${step.size}/${step.line_height}`));
    expect(short.steps[1]).toMatchObject({ sample: 'Open standards for one…', shortened: true, size: 32 });
    expect(short.steps[4]).toMatchObject({ sample: view.voice.umbrella, size: 18, line_height: 30, spec: '400 · 18/30', shortened: false });
    expect(short.scaleEnd).toBeLessThan(c.lowerTop - c.lowerGap);
    expect(short).toMatchObject({ lowerTop: 830, bodyLines: 3 });
    expect(short.sourceLines).toEqual([
      { text: 'Montserrat · Google Fonts · weights 400, 700', muted: false },
      { text: 'Fallback: none', muted: false },
      { text: 'Named on one.example.org', muted: true },
    ]);
    // A live foundation's umbrella (three lines at 18/30 in the 480 px sample column) takes the caption row to y 850: the
    // blocks follow the scale's real end, 16 px under it, the body step still at 18/30, whole, and the stack ends above
    // y 990.
    const umbrella =
      'The Synthetic Foundation is the neutral home at the Linux Foundation where the open protocols and tools for agents are governed in the open.';
    const three = brandKitPortraitTypeLayout({ ...view, voice: { ...view.voice, umbrella } }, 704);
    expect(three.steps[4]).toMatchObject({ sample: umbrella, size: 18, line_height: 30, shortened: false });
    expect(three.scaleEnd).toBeGreaterThan(c.lowerTop);
    expect(three.lowerTop).toBe(Math.ceil(three.scaleEnd) + c.lowerGap);
    expect(three.lowerTop).toBeGreaterThan(830);
    expect(three.lowerTop).toBeLessThan(c.bottom - 60);
    expect(three.bodyLines).toBe(3);
    // The served AAIF book: Instrument Sans, every step at the kit's size under the kit's spec — the H2 line, which 32 px
    // would wrap in 480 px, prints its first four words at 32/40 (the editor's rule: shorten, never shrink).
    const aaif = brandKitPortraitTypeLayout(
      {
        ...view,
        type: { ...view.type, family: 'Instrument Sans' },
        voice: { ...view.voice, line: 'Open foundations for agentic AI.', umbrella },
      },
      704
    );
    expect(aaif.steps.map((step) => [step.step, step.size, step.spec, step.sample])).toEqual([
      ['display', 64, '500 · 64/72', 'Project One'],
      ['h2', 32, '500 · 32/40', 'Open foundations for agentic…'],
      ['h3', 24, '500 · 24/32', 'Open foundations for agentic AI.'],
      ['eyebrow', 14, '500 · 14/20', 'Open foundations for agentic AI.'],
      ['body', 18, '400 · 18/30', umbrella],
      ['caption', 12, '500 · 12/16', view.footer],
    ]);
    expect(aaif.lowerTop).toBeLessThan(c.bottom - 60);
  });

  it('shortens the body sample to three lines, and to fewer when the stack would cross the footer, never setting it smaller', () => {
    const c = BRAND_KIT_PORTRAIT_TYPE_PAGE;
    const sentence = 'Where organizations fund the open computing standards every member builds on, together and in the open, every year.';
    // A 300-character umbrella (five lines at 18/30) prints its first words, at 18/30, ending in an ellipsis within three lines.
    const long = brandKitPortraitTypeLayout({ ...view, voice: { ...view.voice, umbrella: `${sentence} ${sentence} ${sentence}` } }, 704);
    expect(long.steps[4]).toMatchObject({ size: 18, line_height: 30, spec: '400 · 18/30', shortened: true });
    expect(long.steps[4].sample.endsWith('…')).toBe(true);
    expect(mktgPortraitWrapLines(long.steps[4].sample, mktgPortraitCharsPerLine(480, 18, { weight: 400 }))).toBeLessThanOrEqual(3);
    expect(long.bodyLines).toBe(3);
    expect(long.lowerTop).toBeLessThan(c.bottom);
    // When the lower blocks are tall (many rules), three body lines would push the stack past y 990: the body sample takes
    // fewer lines, still at 18/30.
    const rules = Array.from({ length: 9 }, (_, index) => `Rule ${index + 1}: one sentence of guidance for the page, long enough to wrap its column once.`);
    const tall = brandKitPortraitTypeLayout({ ...view, type: { ...view.type, rules }, voice: { ...view.voice, umbrella: `${sentence} ${sentence}` } }, 704);
    expect(tall.bodyLines).toBeLessThan(3);
    expect(tall.steps[4]).toMatchObject({ size: 18, line_height: 30 });
    expect(tall.lowerTop).toBeLessThan(c.bottom);
  });
});

describe('the usage page’s cards', () => {
  it('gives each card the kit’s line for its layout and the mock’s accent moment, from the kit’s examples', () => {
    const cards = brandKitPortraitUsageCards(view, { approvedAt: '2026-11-06T10:00:00Z', approvedBy: null });
    expect(cards.map((card) => card.layout)).toEqual(['keynote', 'social', 'report', 'announcement']);
    // The headlines keep their last two words together (a no-break space), so no card ends on one word alone.
    const line = mktgNoWidow(view.voice.line);
    expect(line).toBe(view.voice.line.replace(/ (\S+)$/, '\u00a0$1'));
    // The project's name stays on one line in every card (a no-break space inside it), and a header's name as a whole.
    expect(cards.map((card) => card.text)).toEqual([line, line, 'Project\u00a0One annual report 2026', 'New members join Project\u00a0One']);
    const foundation = brandKitPortraitUsageCards({ ...view, projectName: 'Agentic AI Foundation' });
    expect(foundation[3].text).toBe('New members join Agentic\u00a0AI\u00a0Foundation');
    // A name that does not fit one line of the card at its size wraps as plain words ("Cloud Native Computing
    // Foundatio" once overflowed the announcement header): the name is kept together only where it fits.
    const cncf = brandKitPortraitUsageCards({ ...view, projectName: 'Cloud Native Computing Foundation' });
    expect(cncf[3].text).toBe('New members join Cloud Native Computing\u00a0Foundation');
    expect(cncf[2].text).toBe('Cloud Native Computing Foundation annual report');
    expect(mktgPortraitLineFits('Cloud Native Computing Foundation', 308, 17, { weight: 500, family: view.type.family })).toBe(false);
    expect(mktgPortraitLineFits('Agentic AI Foundation', 308, 17, { weight: 500, family: view.type.family })).toBe(true);
    // Without a recorded approval the report cover carries no year: never a made-up one.
    expect(brandKitPortraitUsageCards(view)[2].text).toBe('Project\u00a0One annual report');
    // The social card's ground and moment are the accent-moment rule's, not the record's word ("dark"): on this kit's
    // orange nothing reads, so the card is white under the accent as its top rule.
    expect(cards.map((card) => card.accentMoment)).toEqual(['none (grid ground)', 'the top rule', 'none', 'the top rule']);
    expect(cards.map((card) => card.ground)).toEqual(['dark', 'white', 'white', 'dark']);
    expect(cards[2]).toMatchObject({ name: 'Report cover', format: 'letter', ground: 'white' });
    const onNavy = brandKitPortraitUsageCards({ ...view, accent: '#1E3A8A' });
    expect(onNavy[1]).toMatchObject({ ground: 'accent', accentMoment: 'the card itself' });
    expect(brandKitPortraitUsageCards({ ...view, usageTiles: [] })).toEqual([]);
  });
});

describe('brandKitPortraitBackCoverLine', () => {
  it('keeps a brand line that sets in two lines of the content width, and shortens a longer one at a word with an ellipsis, never on a function word', () => {
    expect(brandKitPortraitBackCoverLine(view.voice.line)).toBe(view.voice.line);
    expect(brandKitPortraitBackCoverLine('  ')).toBe('');
    const overfull = buildBrandKitBookView(brandKitOverfullFixture(), 4).voice.line;
    const line = brandKitPortraitBackCoverLine(overfull, 'Montserrat, sans-serif');
    expect(overfull.length).toBeGreaterThan(280);
    expect(line.endsWith('…')).toBe(true);
    expect(overfull.startsWith(line.slice(0, -1))).toBe(true);
    // Two lines of 13 px capitals at +0.16em in the 704 px: about sixty characters a line.
    expect(line.length).toBeLessThan(140);
    expect(line.length).toBeGreaterThan(90);
    expect(line).not.toMatch(/ (the|a|an|and|or|of|to|in|on|for|with|at|by)…$/);
  });
});

describe('brandKitPortraitAccentMoment', () => {
  it('sets no text on an accent nothing in the kit reads on, and says so in the matrix’s own ratios; text in the best readable ink where one does', () => {
    // Every fixture shares the orange: white 2.8:1 and Charcoal 2.9:1 both fail, as the contrast matrix grades them.
    for (const kit of [brandKitTestRevision(), brandKitOverfullFixture(), brandKitPngOnlyFixture()]) {
      const moment = brandKitPortraitAccentMoment(buildBrandKitBookView(kit, 4));
      expect(moment).toEqual({
        ground: 'white',
        background: '#FFFFFF',
        ink: '#4D4E4E',
        inkName: 'Charcoal',
        ratioLabel: '8.3',
        reason: 'no palette color reaches AA on Orange (Charcoal 2.9:1 at best), so the card keeps a white ground under an accent rule',
      });
    }
    // A darker orange white just reads on (4.5:1 by the floor label, graded unrounded): white on the accent.
    expect(brandKitPortraitAccentMoment({ ...view, accent: '#C95000' })).toMatchObject({ ground: 'accent', ink: 'white', inkName: 'White', ratioLabel: '4.5' });
    expect(brandKitPortraitAccentMoment({ ...view, accent: '#C95000' }).reason).toBe('text in White (4.5:1 on Orange)');
    // A pale accent: the kit's dark reads on it, and is named.
    const onPale = brandKitPortraitAccentMoment({ ...view, accent: '#FFE8D6' });
    expect(onPale).toMatchObject({ ground: 'accent', ink: '#4D4E4E', inkName: 'Charcoal' });
    expect(onPale.reason).toMatch(/^text in Charcoal \(\d+\.\d:1 on Orange\)$/);
  });
});

describe('the chapters’ intros', () => {
  it('keeps an intro that fits as written, keeps whole sentences of a long one, and shortens a single long sentence at a word', () => {
    const sentence = 'The page names the typeface and its weights, and links the logo package the site offers to the press.';
    expect(brandKitPortraitIntro('Montserrat throughout.')).toBe('Montserrat throughout.');
    // Four sentences (412 chars) wrap to five lines of 87; the first two (206) fit three lines.
    expect(brandKitPortraitIntro(Array.from({ length: 4 }, () => sentence).join(' '))).toBe(Array.from({ length: 2 }, () => sentence).join(' '));
    const run = Array.from({ length: 5 }, () => sentence.slice(0, -1)).join(', ');
    const shortened = brandKitPortraitIntro(run);
    expect(shortened.endsWith('…')).toBe(true);
    expect(shortened.length).toBeLessThan(run.length);
    expect(mktgPortraitWrapLines(shortened, mktgPortraitCharsPerLine(BRAND_KIT_PORTRAIT_INTRO.width, BRAND_KIT_PORTRAIT_INTRO.size))).toBeLessThanOrEqual(3);
    expect(brandKitPortraitIntro(brandKitOverfullFixture().chapters.type.summary).length).toBeLessThan(300);
  });
});

describe('the Voice page’s messages', () => {
  it('prints the umbrella and the brand line as written when they fit, and sets a long pair smaller together, cut at a sentence, above the attributes', () => {
    expect(brandKitPortraitVoiceMessagesFit(view)).toEqual({ scale: 1, cut: false, umbrella: view.voice.umbrella, line: view.voice.line });
    expect(brandKitPortraitVoiceMessagesFit({ voice: { ...view.voice, umbrella: '' } })).toMatchObject({ umbrella: '', line: view.voice.line, scale: 1 });
    // The overfull record's pair (two 295-character lines, the brand line at the umbrella's 1.3 leading) holds at the
    // smallest step only with the umbrella cut at a sentence (the longer paragraph first); the brand line stays whole and
    // the block still ends above the attributes.
    const long = buildBrandKitBookView(brandKitOverfullFixture(), 4);
    const fit = brandKitPortraitVoiceMessagesFit(long);
    expect(fit).toMatchObject({ scale: 0.72, cut: true, line: long.voice.line });
    expect(fit.umbrella.length).toBeLessThan(long.voice.umbrella.length);
    expect(long.voice.umbrella.startsWith(fit.umbrella)).toBe(true);
    expect(fit.umbrella.endsWith('.')).toBe(true);
    const doubled = { voice: { ...long.voice, umbrella: `${long.voice.umbrella} ${long.voice.umbrella}`, line: `${long.voice.line} ${long.voice.line}` } };
    expect(brandKitPortraitVoiceMessagesFit(doubled)).toMatchObject({ scale: 0.72, cut: true });
    const c = BRAND_KIT_PORTRAIT_VOICE_MESSAGES;
    const height = mktgPortraitBlockHeight(
      mktgPortraitScaleBlock(
        {
          paras: [
            { text: 'Umbrella message', ...c.label },
            { text: fit.umbrella, ...c.umbrella },
            { text: 'Brand line', ...c.label, above: c.lineLabelAbove },
            { text: fit.line, ...c.line },
          ],
        },
        fit.scale
      ),
      c.width
    );
    expect(height).toBeLessThanOrEqual(c.bottom - c.top);
  });
});

describe('the chapters’ rule lists', () => {
  it('prints a list as written when its columns hold it, smaller and cut at a sentence for 300-character rules, and counts the rules a room cannot hold', () => {
    const r = BRAND_KIT_PORTRAIT_RULE_LISTS;
    expect(brandKitPortraitRulesFit(view.logo.partnership, r.partnership)).toEqual({
      scale: 1,
      cut: false,
      rules: view.logo.partnership,
      more: 0,
      moreLine: '',
    });
    const long = buildBrandKitBookView(brandKitOverfullFixture(), 4);
    for (const [rules, room] of [
      [long.logo.partnership, r.partnership],
      [long.visual.icons.rules, r.iconography],
      [long.visual.imagery.avoid, r.imageryAvoid],
      [long.type.rules, r.typeRules],
    ] as const) {
      const fit = brandKitPortraitRulesFit(rules, room);
      expect(fit.scale).toBe(0.72);
      expect(fit.cut).toBe(true);
      expect(fit.rules.length + fit.more).toBe(rules.length);
      expect(fit.rules.length).toBeGreaterThan(0);
      expect(fit.rules.every((rule) => rule.length < 300)).toBe(true);
    }
    // The Partnership and Type lists hold every rule cut at a sentence; the Iconography and Imagery rooms count some.
    expect(brandKitPortraitRulesFit(long.logo.partnership, r.partnership).more).toBe(0);
    expect(brandKitPortraitRulesFit(long.type.rules, r.typeRules).more).toBe(0);
    expect(brandKitPortraitRulesFit(long.visual.icons.rules, r.iconography)).toMatchObject({ more: 2, moreLine: '+2 more rules, in LFX One' });
    // The Avoid list counts items to avoid, not rules, and one is singular.
    expect(brandKitPortraitRulesFit(long.visual.imagery.avoid, r.imageryAvoid)).toMatchObject({ more: 1, moreLine: '+1 more item to avoid, in LFX One' });
    // Twelve short rules in the Imagery page's 70 px: the first few print, the rest are counted, the first always kept.
    const many = brandKitPortraitRulesFit(
      Array.from({ length: 12 }, (_, index) => `Avoid the ${index + 1}th thing.`),
      r.imageryAvoid
    );
    expect(many.more).toBeGreaterThan(0);
    expect(many.rules.length + many.more).toBe(12);
    expect(many.rules[0]).toBe('Avoid the 1th thing.');
    expect(
      brandKitPortraitRulesFit(['One rule that is far too long for its room '.repeat(40)], { ...r.imageryAvoid, bottom: r.imageryAvoid.top + 30 }).rules
    ).toHaveLength(1);
  });
});

describe('the Color contrast page’s layout', () => {
  it('keeps the pairs at the mock’s y 610 under four colours, lets a bigger matrix push them down, and counts the pairs the footer cannot hold', () => {
    // The matrix block keeps the room above the pairs' 24 px gap, so the heading sits at 610 under four colours.
    expect(brandKitPortraitContrastLayout(4, 1)).toEqual({ matrixHeight: 362, matrixMinHeight: 366, pairsTop: 610, pairsKept: 1, more: 0, moreLine: '' });
    // Seven pairs fill the room under four colours (990 − 610 − 20 = 360 ≥ 7 × 51); the eighth needs the line.
    expect(brandKitPortraitContrastLayout(4, 7)).toMatchObject({ pairsKept: 7, more: 0 });
    expect(brandKitPortraitContrastLayout(4, 8)).toMatchObject({ pairsKept: 6, more: 2 });
    // Six colours: the matrix is 534 px, the pairs start at 778 (the gap kept) and three of eight fit with the line; one always prints.
    expect(brandKitPortraitContrastLayout(6, 8)).toEqual({
      matrixHeight: 534,
      matrixMinHeight: 366,
      pairsTop: 778,
      pairsKept: 3,
      more: 5,
      moreLine: '+5 more pairs, in LFX One',
    });
    expect(brandKitPortraitContrastLayout(9, 2)).toMatchObject({ pairsKept: 1, more: 1, moreLine: '+1 more pair, in LFX One' });
  });
});

describe('the Watchouts page’s retyped sample', () => {
  it('prints the name as written when the tile holds it in four lines clear of the badge, else shortened at a word with an ellipsis', () => {
    expect(brandKitPortraitRetypedName('Project One')).toBe('Project One');
    // Each long word is a line of its own in the 156 px clear of the badge: five words are one too many, so the
    // acronym goes and the name ends with the ellipsis.
    expect(brandKitPortraitRetypedName('Cloud Native Computing Foundation (CNCF)')).toBe('Cloud Native Computing Foundation…');
    const long = brandKitPortraitRetypedName('The Synthetic Foundation for Interoperable Agentic Computing Standards and Open Governance');
    expect(long.endsWith('…')).toBe(true);
    expect(long.startsWith('The Synthetic Foundation')).toBe(true);
    expect(brandKitPortraitRetypedName('  ')).toBe('');
  });
});

describe('the Watchouts page’s draws', () => {
  it('draws each tile by its kind: the shadow in px, the recolor as the portrait filter, the busy ground as the mock’s gradient, white under the rest', () => {
    const drawn = view.watchouts.map((tile) => brandKitPortraitWatchoutDraw(tile, view, '#FFFFFF'));
    expect(drawn.map((tile) => tile.kind)).toEqual(['stretched', 'recolored', 'rotated', 'shadowed', 'busy', 'retyped']);
    expect(drawn[0]).toMatchObject({ transform: 'scaleX(1.45)', filter: '', ground: '#FFFFFF' });
    expect(drawn[1].filter).toBe(BRAND_KIT_PORTRAIT_RECOLOR_FILTER);
    expect(drawn[3].filter).toBe('drop-shadow(4px 5px 3px rgba(0, 0, 0, 0.45))');
    expect(drawn[4].ground).toBe(`linear-gradient(120deg, ${view.accent}, ${view.palette[3].hex} 60%, ${view.dark})`);
    expect(drawn[5]).toMatchObject({ retyped: true, ground: '#FFFFFF' });
    // The key is the kind, not the screen's CSS: a recolored tile drawn differently on screen still prints the portrait filter.
    expect(brandKitPortraitWatchoutDraw({ ...view.watchouts[1], filter: 'sepia(1)' }, view, '#FFFFFF').filter).toBe(BRAND_KIT_PORTRAIT_RECOLOR_FILTER);
    // Without a fourth colour the busy ground goes through the spark.
    const three = { ...view, palette: view.palette.slice(0, 3) };
    expect(brandKitPortraitWatchoutDraw(view.watchouts[4], three, '#FFFFFF').ground).toBe(
      `linear-gradient(120deg, ${view.accent}, ${view.spark} 60%, ${view.dark})`
    );
  });
});

describe('the Voice page’s attributes', () => {
  it('keeps four attributes as written, sets eight long ones smaller in the grammar’s steps, and cuts only what no step holds', () => {
    const room = BRAND_KIT_PORTRAIT_ATTRIBUTES.bottom - BRAND_KIT_PORTRAIT_ATTRIBUTES.top;
    const four = brandKitPortraitAttributesFit(view.voice.attributes);
    expect(four).toMatchObject({ scale: 1, cut: false, attributes: view.voice.attributes, more: 0 });
    expect(four.height).toBeLessThanOrEqual(room);
    const line = 'Every claim names its number and its source, in the words the reader would use, and never a superlative the record cannot back.';
    const eight = Array.from({ length: 8 }, (_, index) => ({ name: `Attribute ${index + 1}`, line }));
    const fitted = brandKitPortraitAttributesFit(eight);
    expect(fitted.scale).toBeLessThan(1);
    expect(fitted.scale).toBeGreaterThanOrEqual(0.72);
    expect(fitted).toMatchObject({ cut: false, attributes: eight, more: 0 });
    expect(fitted.height).toBeLessThanOrEqual(room);
    // Twenty two-sentence attributes: every line cut to three lines at the smallest step, the rows the room still does
    // not hold counted in the "+N more" line, and the stack never past the room (rv2 P1-5: it overran the footer).
    const twenty = Array.from({ length: 20 }, (_, index) => ({ name: `Attribute ${index + 1}`, line: `${line} ${line}` }));
    const cut = brandKitPortraitAttributesFit(twenty);
    expect(cut.scale).toBe(0.72);
    expect(cut.cut).toBe(true);
    expect(cut.more).toBeGreaterThan(0);
    expect(cut.attributes.length + cut.more).toBe(20);
    expect(cut.attributes.length % BRAND_KIT_PORTRAIT_ATTRIBUTES.columns).toBe(0);
    expect(cut.height).toBeLessThanOrEqual(room);
    // Each line is cut at a sentence (whole, so no ellipsis when one fits), never left as written.
    expect(cut.attributes.every((attribute) => attribute.line.length < `${line} ${line}`.length)).toBe(true);
    expect(cut.attributes[0].line).toBe(line);
    expect(cut.attributes.map((attribute) => attribute.name)).toEqual(twenty.slice(0, cut.attributes.length).map((attribute) => attribute.name));
    // The boundary: eight two-sentence attributes hold at no step as written, but the cut grid fits the room, so every
    // attribute is kept and no "+N more" line is charged (rv4: it lost a row to a line nothing needed).
    const eightLong = brandKitPortraitAttributesFit(Array.from({ length: 8 }, (_, index) => ({ name: `Attribute ${index + 1}`, line: `${line} ${line}` })));
    expect(eightLong).toMatchObject({ scale: 0.72, cut: true, more: 0 });
    expect(eightLong.attributes).toHaveLength(8);
    expect(eightLong.height).toBeLessThanOrEqual(room);
    // Ten long attributes (rv2's probe: 535 px as written): cut, three rows kept, four counted in the line.
    const ten = brandKitPortraitAttributesFit(Array.from({ length: 10 }, (_, index) => ({ name: `Attribute ${index + 1}`, line: `${line} ${line}` })));
    expect(ten.height).toBeLessThanOrEqual(room);
    expect(ten).toMatchObject({ cut: true, more: 4 });
    expect(ten.attributes).toHaveLength(6);
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

  it('fits the two columns to their room: as written when they fit, smaller together for a long record, its last items given up when no size holds it', () => {
    const short = brandKitPortraitSourcesFit(brandKitPortraitSources(view), true);
    expect(short).toEqual({
      scale: 1,
      cut: false,
      sources: brandKitPortraitSources(view),
      moreRead: 0,
      moreGaps: 0,
      moreConflicts: 0,
      moreReadLine: '',
      moreGapsLine: '',
      moreConflictsLine: '',
    });
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
    // Every name whole and unique, the failed line's source once, kept + counted = the record's.
    expect(fitted.sources.read).toEqual(long.read);
    expect(new Set(fitted.sources.read).size).toBe(fitted.sources.read.length);
    expect(fitted.sources.read.length + fitted.moreRead).toBe(40);
    expect(fitted.sources.failed).toEqual(long.failed);
    expect(fitted.moreRead).toBe(0);
    // Without the accepted box the same record has the room down to y 990: it fits at a larger size.
    expect(brandKitPortraitSourcesFit(long, false).scale).toBeGreaterThan(fitted.scale);
    // Eighty gap sentences hold at no step: the column gives up its last items first (the sources read down to one, then
    // the gaps), to `+N more` lines; what stays prints whole, in the record's order, and nothing is cut.
    const essay = brandKitPortraitSources({ ...view, report: { ...view.report, gaps: Array.from({ length: 80 }, () => `${sentence} ${sentence}`) } });
    const dropped = brandKitPortraitSourcesFit(essay, true);
    expect(dropped.scale).toBe(0.72);
    expect(dropped.cut).toBe(false);
    expect(dropped.sources.gaps.every((gap) => gap === `${sentence} ${sentence}`)).toBe(true);
    expect(dropped.sources.read).toEqual(essay.read.slice(0, 1));
    expect(dropped.moreRead).toBe(essay.read.length - 1);
    expect(dropped.moreGaps).toBeGreaterThan(0);
    expect(dropped.sources.gaps.length + dropped.moreGaps).toBe(80);
    expect(dropped.moreGapsLine).toBe(`+${dropped.moreGaps} more gaps, in LFX One`);
    expect(dropped.moreConflicts).toBe(0);
    // Only when nothing is left to give up is prose cut, at a sentence: one failed source with a sixty-sentence reason
    // keeps its name whole and once, and loses its last sentences.
    const reason = Array.from({ length: 60 }, () => sentence).join(' ');
    const verbose = brandKitPortraitSources({
      ...view,
      report: { ...view.report, sources_read: [], gaps: [], sources_failed: [{ name: 'https://one.example.org/press', reason }] },
    });
    const cut = brandKitPortraitSourcesFit(verbose, true);
    expect(cut.cut).toBe(true);
    expect(cut.sources.failed).toHaveLength(1);
    expect(cut.sources.failed[0].source).toBe(verbose.failed[0].source);
    expect(cut.sources.failed[0].reason.length).toBeLessThan(reason.length);
    expect(reason.startsWith(cut.sources.failed[0].reason)).toBe(true);
    expect(cut.sources.failed[0].reason.endsWith('.')).toBe(true);
    expect(cut.moreRead + cut.moreGaps + cut.moreConflicts).toBe(0);
  });

  it('counts the items a column cannot hold even cut in "+N more" lines: sources read (left) and color conflicts (right), one kept at least', () => {
    const room = BRAND_KIT_PORTRAIT_SOURCES.acceptedTop - BRAND_KIT_PORTRAIT_SOURCES.gap - BRAND_KIT_PORTRAIT_SOURCES.top;
    const width = BRAND_KIT_PORTRAIT_SOURCES.width - BRAND_KIT_PORTRAIT_SOURCES.indent;
    const read = Array.from({ length: 120 }, (_, index) => `https://one.example.org/page-${index + 1}`);
    const conflict = (index: number) => ({
      name: `Color ${index + 1}`,
      values: [
        { hex: '#112233', source: 'https://one.example.org/brand' },
        { hex: '#113344', source: 'https://one.example.org/_next/static/chunks/a1b2c3.css' },
      ],
      chosen: '#112233',
    });
    const crowded = brandKitPortraitSources({
      ...view,
      report: { ...view.report, sources_read: read, color_conflicts: Array.from({ length: 30 }, (_, index) => conflict(index)) },
    });
    const fit = brandKitPortraitSourcesFit(crowded, true);
    expect(fit.scale).toBe(0.72);
    expect(fit.moreRead).toBeGreaterThan(0);
    expect(fit.sources.read.length + fit.moreRead).toBe(120);
    expect(fit.sources.read.length).toBeGreaterThanOrEqual(1);
    // The names printed are the record's first, whole and unique; nothing is cut.
    expect(fit.sources.read).toEqual(crowded.read.slice(0, fit.sources.read.length));
    expect(new Set(fit.sources.read).size).toBe(fit.sources.read.length);
    expect(fit.cut).toBe(false);
    expect(fit.moreReadLine).toBe(`+${fit.moreRead} more sources read, in LFX One`);
    expect(fit.moreConflicts).toBeGreaterThan(0);
    expect(fit.sources.conflicts.length + fit.moreConflicts).toBe(30);
    expect(fit.sources.conflicts.length).toBeGreaterThanOrEqual(1);
    // The columns as printed, with their "+N more" lines, end inside the room.
    const column = (paras: { text: string; size: number; line: number; above?: number }[]) =>
      mktgPortraitBlockHeight(mktgPortraitScaleBlock({ paras }, fit.scale), width);
    const item = BRAND_KIT_PORTRAIT_SOURCES.item;
    const left = [
      { text: 'Read', ...BRAND_KIT_PORTRAIT_SOURCES.label },
      ...fit.sources.read.map((text, index) => ({ text, ...item, above: index === 0 ? BRAND_KIT_PORTRAIT_SOURCES.listAbove : 0 })),
      { text: fit.moreReadLine, ...item },
    ];
    expect(column(left)).toBeLessThanOrEqual(room);
  });

  it('measures a color conflict as the page draws it (a head, then padded rows with the source in its own cell), so the overfull record’s six stop above the accepted box', () => {
    const c = BRAND_KIT_PORTRAIT_SOURCES;
    const room = c.acceptedTop - c.gap - c.top;
    const width = c.width - c.indent;
    const overfull = brandKitPortraitSources(buildBrandKitBookView(brandKitOverfullFixture(), 4));
    expect(overfull.conflicts).toHaveLength(6);
    const fit = brandKitPortraitSourcesFit(overfull, true);
    // Six conflicts of three values: eighteen padded rows and six heads. As plain 20 px lines they would read as fitting
    // at a larger size; as drawn (8 px over each table, 11 px of padding and rule a row, the source wrapping in its cell)
    // they hold only set smaller, and the column's drawn height ends inside the room.
    expect(fit.scale).toBeLessThanOrEqual(0.76);
    expect(fit.sources.conflicts).toHaveLength(6);
    expect(fit.moreConflicts).toBe(0);
    const k = c.conflict;
    const labelWidth = (label: string) => (label.length * width) / mktgPortraitCharsPerLine(width, c.item.size, { weight: 600 });
    const drawn = fit.sources.conflicts.flatMap((conflict) => [
      { text: conflict.name, ...k.name, above: k.above },
      ...conflict.values.map((value, index) => ({
        text: value.source,
        ...c.item,
        above: k.rowPad + (index === 0 ? k.headBelow : 0),
        indent: k.swatch + k.cellGap + labelWidth(value.label) + k.cellGap,
      })),
    ]);
    const right = [
      ...(fit.sources.missing.length ? [{ text: 'Missing', ...c.label }] : []),
      ...fit.sources.missing.map((entry, index) => ({ text: `${entry.asset} — ${entry.reason}`, ...c.item, above: index === 0 ? c.listAbove : 0 })),
      { text: 'Color conflicts', ...c.label, above: fit.sources.missing.length ? c.blockGap : 0 },
      ...drawn,
    ];
    expect(mktgPortraitBlockHeight(mktgPortraitScaleBlock({ paras: right }, fit.scale), width)).toBeLessThanOrEqual(room);
    // Long sources in the cells: more rows than the room holds even smallest, so conflicts are counted, never run under the box.
    const wordy = brandKitPortraitSources({
      ...buildBrandKitBookView(brandKitOverfullFixture(), 4),
      report: {
        ...buildBrandKitBookView(brandKitOverfullFixture(), 4).report,
        color_conflicts: Array.from({ length: 8 }, (_, index) => ({
          name: `Color ${index + 1}`,
          values: Array.from({ length: 4 }, (_, v) => ({
            hex: `#11223${v}`,
            source: `https://one.example.org/brand/guidelines/section-${index + 1}/colour-${v + 1}`,
          })),
          chosen: '#112230',
        })),
      },
    });
    const counted = brandKitPortraitSourcesFit(wordy, true);
    expect(counted.scale).toBe(0.72);
    expect(counted.moreConflicts).toBeGreaterThan(0);
    expect(counted.sources.conflicts.length + counted.moreConflicts).toBe(8);
  });
});
