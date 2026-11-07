// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
  MKTG_PORTRAIT_FIT,
  MKTG_PORTRAIT_INKS,
  MKTG_PORTRAIT_MORE_LINE,
  MKTG_PORTRAIT_PAGE,
  MKTG_PORTRAIT_PAGE_SETUP,
} from '../constants/mktg-portrait-print.constants';
import { MKTG_PRINT_PAGE_SETUPS } from '../constants/mktg-print.constants';
import { lfxColors } from '../constants/colors.constants';
import type { MktgPortraitFitBlock } from '../interfaces/mktg-portrait-print.interface';
import { brandKitContrastRatio, brandKitLuminance } from './brand-kit-book.utils';
import {
  mktgPortraitAccentText,
  mktgPortraitBlockHeight,
  mktgPortraitCharsPerLine,
  mktgPortraitCutText,
  mktgPortraitFitBlock,
  mktgPortraitFits,
  mktgPortraitIsChapter,
  mktgPortraitLineFits,
  mktgPortraitLook,
  mktgPortraitOneLine,
  mktgPortraitPageNumber,
  mktgPortraitPaginate,
  mktgPortraitScaleBlock,
  mktgPortraitSentences,
  mktgPortraitTextWidth,
  mktgPortraitWrapLines,
  mktgNoWidow,
  mktgPortraitLargestFitting,
  mktgPortraitMoreLine,
  mktgPortraitTrimStopWords,
} from './mktg-portrait-print.utils';
import { mktgPrintBrand } from './mktg-print.utils';

describe('the portrait page geometry', () => {
  it('is US Letter at 96 dpi with 56 px margins and a 704 px content column', () => {
    expect(MKTG_PORTRAIT_PAGE.width).toBe(8.5 * 96);
    expect(MKTG_PORTRAIT_PAGE.height).toBe(11 * 96);
    expect(MKTG_PORTRAIT_PAGE.width - 2 * MKTG_PORTRAIT_PAGE.margin).toBe(MKTG_PORTRAIT_PAGE.contentWidth);
    expect(MKTG_PORTRAIT_PAGE.bandTop + MKTG_PORTRAIT_PAGE.bandHeight).toBeLessThan(MKTG_PORTRAIT_PAGE.headTop);
    expect(MKTG_PORTRAIT_PAGE.headTop).toBeLessThan(MKTG_PORTRAIT_PAGE.titleTop);
    expect(MKTG_PORTRAIT_PAGE.titleTop).toBeLessThan(MKTG_PORTRAIT_PAGE.bodyTop);
  });

  it('prints on its own US Letter page with no margin, the setup the print frame writes', () => {
    expect(MKTG_PORTRAIT_PAGE_SETUP).toBe(MKTG_PRINT_PAGE_SETUPS['mktg-portrait']);
    expect(MKTG_PORTRAIT_PAGE_SETUP).toBe('size: auto; margin: 0;');
  });

  it('keeps the four neutral inks as the design sets them, and takes white and the fail ink from the app’s scales', () => {
    expect(MKTG_PORTRAIT_INKS).toEqual({
      ink: '#1F2937',
      muted: '#6B7280',
      hairline: '#E5E7EB',
      mist: '#F3F4F6',
      white: lfxColors.white,
      fail: lfxColors.red[600],
    });
  });
});

describe('mktgPortraitLook', () => {
  const brand = { ...mktgPrintBrand(null), dark: '#000000', accent: '#FF702D' };

  it('takes the dark, the accent and the typeface from the print brand, and the spark named, else the accent again', () => {
    expect(mktgPortraitLook(brand, '#B6B0D0')).toMatchObject({ dark: '#000000', accent: '#FF702D', spark: '#B6B0D0', fontStack: brand.fontStack });
    expect(mktgPortraitLook(brand).spark).toBe('#FF702D');
    expect(mktgPortraitLook(brand, '  ').spark).toBe('#FF702D');
  });

  it('inks text on the accent by the shared rule: the dark on a coral (white is 2.8:1), white on a navy', () => {
    expect(mktgPortraitLook(brand).onAccent).toBe('#000000');
    expect(mktgPortraitLook({ ...brand, accent: '#1E3A8A' }).onAccent).toBe('white');
  });
});

describe('page numbering', () => {
  it('prints two-digit page numbers', () => {
    expect(mktgPortraitPageNumber(1)).toBe('01');
    expect(mktgPortraitPageNumber(17)).toBe('17');
  });

  it('tells a numbered chapter’s label from the rest', () => {
    expect(mktgPortraitIsChapter('07 Sources')).toBe(true);
    expect(mktgPortraitIsChapter('Contents')).toBe(false);
  });
});

describe('the fit model', () => {
  it('measures characters per line wider for bold and for capitals', () => {
    expect(mktgPortraitCharsPerLine(704, 12.5)).toBe(Math.floor(704 / (12.5 * MKTG_PORTRAIT_FIT.charEm)));
    expect(mktgPortraitCharsPerLine(704, 12.5, { weight: 600 })).toBeLessThan(mktgPortraitCharsPerLine(704, 12.5));
    expect(mktgPortraitCharsPerLine(704, 12.5, { caps: true })).toBeLessThan(mktgPortraitCharsPerLine(704, 12.5, { weight: 600 }));
    expect(mktgPortraitCharsPerLine(1, 100)).toBe(1);
  });

  it('measures one line glyph by glyph in the kit’s face, so a line that fits its measure is left at its real size', () => {
    // A live foundation's display line at 64 px in a face of ordinary width is narrower than the 704 px column …
    const sans = { weight: 500, family: "'Instrument Sans', sans-serif" };
    const display = mktgPortraitTextWidth('Agentic AI Foundation', 64, sans);
    expect(display).toBeGreaterThan(560);
    expect(display).toBeLessThan(704);
    expect(mktgPortraitLineFits('Agentic AI Foundation', 704, 64, sans)).toBe(true);
    // … where the flat paragraph average (0.6 em a character for a medium weight) would call it too wide.
    expect('Agentic AI Foundation'.length * 64 * MKTG_PORTRAIT_FIT.charEmBold).toBeGreaterThan(704);
    // The same words set wider: a wide face (Montserrat), a bolder weight, capitals with their tracking.
    expect(mktgPortraitTextWidth('Agentic AI Foundation', 64, { weight: 500, family: 'Montserrat' })).toBeGreaterThan(display);
    expect(mktgPortraitTextWidth('Agentic AI Foundation', 64, { weight: 700, family: sans.family })).toBeGreaterThan(display);
    expect(mktgPortraitTextWidth('Agentic AI Foundation', 64, { ...sans, caps: true })).toBeGreaterThan(display);
    // An unknown face measures as a face of average width; a narrow i and a wide W are not the same glyph.
    expect(mktgPortraitTextWidth('iiii', 10)).toBeLessThan(mktgPortraitTextWidth('WWWW', 10));
    expect(mktgPortraitTextWidth('', 10)).toBe(0);
    expect(mktgPortraitLineFits('Agentic AI Foundation', 400, 64, sans)).toBe(false);
  });

  it('wraps greedily by words, a hard line on its own, a long word broken', () => {
    expect(mktgPortraitWrapLines('one two three', 20)).toBe(1);
    expect(mktgPortraitWrapLines('one two three', 7)).toBe(2);
    expect(mktgPortraitWrapLines('one\n\ntwo', 20)).toBe(3);
    expect(mktgPortraitWrapLines('abcdefghij', 4)).toBe(3);
    expect(mktgPortraitWrapLines('', 4)).toBe(1);
  });

  it('sums the paragraphs’ lines at their line height, with the space above', () => {
    const block: MktgPortraitFitBlock = {
      paras: [
        { text: 'short', size: 10, line: 1.5 },
        { text: 'short', size: 10, line: 1.5, above: 8 },
      ],
    };
    expect(mktgPortraitBlockHeight(block, 704)).toBe(15 + 8 + 15);
    expect(mktgPortraitFits(block, 704, 38)).toBe(true);
    expect(mktgPortraitFits(block, 704, 37)).toBe(false);
  });

  it('scales sizes down to the half px and the space above to a tenth', () => {
    const scaled = mktgPortraitScaleBlock({ paras: [{ text: 't', size: 12.5, line: 1.6, above: 10 }] }, 0.9);
    expect(scaled.paras[0]).toMatchObject({ size: 11, above: 9 });
  });

  it('splits sentences and cuts at a sentence, else at a word with an ellipsis', () => {
    expect(mktgPortraitSentences('One. Two! Three? (Four)')).toEqual(['One.', 'Two!', 'Three?', '(Four)']);
    expect(mktgPortraitCutText('One sentence. Another one here.', 14)).toBe('One sentence.');
    // A word cut never ends on a function word ('No stop in…' reads as a dangling cut).
    expect(mktgPortraitCutText('No stop in this long line of words', 12)).toBe('No stop…');
    expect(mktgPortraitCutText('No stop here this long line of words', 13)).toBe('No stop here…');
    expect(mktgPortraitTrimStopWords(['The', 'name', 'goes', 'first', 'and'])).toEqual(['The', 'name', 'goes', 'first']);
    expect(mktgPortraitTrimStopWords(['so,', 'with'])).toEqual(['so,']);
    expect(mktgPortraitLargestFitting(10, (count) => count <= 7)).toBe(7);
    expect(mktgPortraitLargestFitting(10, () => false)).toBe(1);
    expect(mktgPortraitLargestFitting(10, () => true)).toBe(10);
    expect(mktgPortraitCutText('short', 12)).toBe('short');
    expect(mktgPortraitCutText('A word, —  and more words after it', 9)).toBe('A word…');
  });

  it('cuts a hostile text of ten thousand tabs in linear time', () => {
    // A first word longer than the room, after ten thousand tabs: the cut falls back to the raw slice and trims its tail.
    const tabs = '\t'.repeat(10000);
    const started = performance.now();
    const slice = mktgPortraitCutText(`${tabs}x${'y'.repeat(20000)}`, 15000);
    const words = mktgPortraitCutText(`${tabs}x`, 20);
    expect(performance.now() - started).toBeLessThan(250);
    expect(slice).toBe(`${tabs}x${'y'.repeat(4998)}…`);
    expect(words).toBe('x');
  });

  it('keeps a block that fits as written, shrinks one that does not, and cuts the longest paragraph as the last resort', () => {
    const para = { text: 'The quick brown fox jumps over the lazy dog. It does so again and again.', size: 12.5, line: 1.6 };
    const fits = mktgPortraitFitBlock({ paras: [para] }, 704, 100);
    expect(fits).toEqual({ block: { paras: [para] }, scale: 1, cut: false });
    const shrunk = mktgPortraitFitBlock({ paras: [para] }, 200, 50);
    expect(shrunk.cut).toBe(false);
    expect(shrunk.scale).toBeLessThan(1);
    expect(shrunk.scale).toBeGreaterThanOrEqual(MKTG_PORTRAIT_FIT.minScale);
    expect(shrunk.block.paras[0].text).toBe(para.text);
    const cut = mktgPortraitFitBlock({ paras: [para] }, 200, 20);
    expect(cut.cut).toBe(true);
    expect(cut.scale).toBe(MKTG_PORTRAIT_FIT.minScale);
    expect(cut.block.paras[0].text.length).toBeLessThan(para.text.length);
    expect(mktgPortraitFits(cut.block, 200, 20)).toBe(true);
  });

  it('cuts a line to its width', () => {
    expect(mktgPortraitOneLine('Agentic AI Foundation', 704, 12.5)).toBe('Agentic AI Foundation');
    expect(mktgPortraitOneLine('Agentic AI Foundation and its logo are trademarks', 100, 12.5)).toMatch(/…$/);
  });

  it('paginates items as many as fit, at least one a page', () => {
    expect(mktgPortraitPaginate([1, 2, 3, 4, 5], (page) => page.length <= 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(mktgPortraitPaginate([1, 2], () => false)).toEqual([[1], [2]]);
    expect(mktgPortraitPaginate([], () => true)).toEqual([]);
  });
});

describe('mktgPortraitAccentText', () => {
  const onWhite = (hex: string): number => brandKitContrastRatio(1, brandKitLuminance(hex));

  it('darkens a light accent until it reads on the page white at WCAG AA, keeping its hue, and returns a dark one as it is', () => {
    const coral = mktgPortraitAccentText('#FF702D');
    expect(onWhite('#FF702D')).toBeLessThan(3);
    expect(onWhite(coral)).toBeGreaterThanOrEqual(4.5);
    expect(onWhite(coral)).toBeLessThan(4.8);
    // Still an orange: red first, then green, little blue.
    const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(coral.slice(offset, offset + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(onWhite(mktgPortraitAccentText('#F37625'))).toBeGreaterThanOrEqual(4.5);
    expect(onWhite(mktgPortraitAccentText('#FFD400'))).toBeGreaterThanOrEqual(4.5);
    expect(mktgPortraitAccentText('#1E3A8A')).toBe('#1E3A8A');
    expect(mktgPortraitAccentText('#4D4E4E')).toBe('#4D4E4E');
  });

  it('leaves anything that is not a six-digit hex alone', () => {
    expect(mktgPortraitAccentText('coral')).toBe('coral');
    expect(mktgPortraitAccentText('#FFF')).toBe('#FFF');
  });
});

describe('mktgPortraitMoreLine', () => {
  it('prints the count with the noun, singular at one, and nothing at none', () => {
    const nouns = MKTG_PORTRAIT_MORE_LINE.nouns;
    expect(mktgPortraitMoreLine(0, nouns.rule)).toBe('');
    expect(mktgPortraitMoreLine(1, nouns.rule)).toBe('+1 more rule, in LFX One');
    expect(mktgPortraitMoreLine(3, nouns.rule)).toBe('+3 more rules, in LFX One');
    expect(mktgPortraitMoreLine(1, nouns.avoid)).toBe('+1 more item to avoid, in LFX One');
    expect(mktgPortraitMoreLine(2, nouns.sourceRead)).toBe('+2 more sources read, in LFX One');
    expect(mktgPortraitMoreLine(1, nouns.colorConflict)).toBe('+1 more color conflict, in LFX One');
  });
});

describe('mktgNoWidow', () => {
  it('joins the last two words with a no-break space and leaves one word, or nothing, alone', () => {
    expect(mktgNoWidow('Open foundations for agentic AI.')).toBe('Open foundations for agentic\u00a0AI.');
    expect(mktgNoWidow('New members join Project One')).toBe('New members join Project\u00a0One');
    expect(mktgNoWidow('  two  words ')).toBe('two\u00a0words');
    expect(mktgNoWidow('Interoperability')).toBe('Interoperability');
    expect(mktgNoWidow('   ')).toBe('');
  });

  it('reads a hostile headline in linear time (no regex scan over the input)', () => {
    const hostile = `${'\t'.repeat(100_000)}x`;
    const started = performance.now();
    expect(mktgNoWidow(hostile)).toBe('x');
    expect(mktgNoWidow(`a${' '.repeat(100_000)}b`)).toBe('a\u00a0b');
    expect(performance.now() - started).toBeLessThan(50);
  });
});
