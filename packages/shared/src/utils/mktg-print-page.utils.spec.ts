// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the landscape print grammar: the fit (the deck's character
// model, ported) and the page plan helpers. The cases mirror the deck's own
// (marketing-os-agents agents/slides-export src/test/fit.test.ts at
// 7839d985), so the PDF cuts where the slide cuts. Every fixture is synthetic.

import { describe, expect, it } from 'vitest';

import {
  MKTG_PRINT_PAGE_AREA,
  MKTG_PRINT_PAGE_CANVAS,
  MKTG_PRINT_PAGE_CAPS_TRACKING_EM,
  MKTG_PRINT_PAGE_FOOTER_LEFT_X,
  MKTG_PRINT_PAGE_FRAME_PT,
  MKTG_PRINT_PAGE_INSET,
  MKTG_PRINT_PAGE_LEFT,
  MKTG_PRINT_PAGE_LINE,
  MKTG_PRINT_PAGE_LOGO_FRAME,
  MKTG_PRINT_PAGE_MIN_SCALE,
  MKTG_PRINT_PAGE_MUTED_INK,
  MKTG_PRINT_PAGE_RIGHT,
  MKTG_PRINT_PAGE_RULE_INK,
  MKTG_PRINT_PAGE_SCALE,
  MKTG_PRINT_PAGE_SIZE,
  MKTG_PRINT_PAGE_SLIDE_TOP_PT,
} from '../constants/mktg-print-page.constants';
import { MKTG_PRINT_INK_ON_LIGHT } from '../constants/mktg-print.constants';
import { MktgPrintRich } from '../interfaces/mktg-print-page.interface';
import {
  mktgPrintCharEm,
  mktgPrintCharsPerLine,
  mktgPrintCutPara,
  mktgPrintCutText,
  mktgPrintFitOrCut,
  mktgPrintFitRich,
  mktgPrintFits,
  mktgPrintOneLine,
  mktgPrintPaginate,
  mktgPrintRichHeight,
  mktgPrintScaleRich,
  mktgPrintSentences,
  mktgPrintWrapLines,
} from './mktg-print-fit.utils';
import {
  mktgPageBoxStyle,
  mktgPagePt,
  mktgPrintBackPage,
  mktgPrintBackTitleRich,
  mktgPrintBulletParas,
  mktgPrintClampRow,
  mktgPrintContentPage,
  mktgPrintContinued,
  mktgPrintCoverPage,
  mktgPrintCoverTitleRich,
  mktgPrintElView,
  mktgPrintFooterEls,
  mktgPrintFooterLine,
  mktgPrintHeadEls,
  mktgPrintInWords,
  mktgPrintMixHex,
  mktgPrintPageLook,
  mktgPrintPageNumber,
  mktgPrintProseColumn,
  mktgPrintProseParas,
  mktgPrintRowHeight,
  mktgPrintScaleRows,
  mktgPrintShapeEl,
  mktgPrintStack,
  mktgPrintTextEl,
  mktgPrintTitleRich,
  mktgPrintWithFooter,
  mktgPrintWithoutNote,
  mktgPrintWithoutSourceSentences,
  mktgPrintWithSentence,
} from './mktg-print-page.utils';
import { brandKitTestRevision } from './__fixtures__/brand-kit-revision.fixture';
import { mktgPrintBrand } from './mktg-print.utils';

const look = mktgPrintPageLook(mktgPrintBrand(null));
const rich = (texts: string[], size: number = MKTG_PRINT_PAGE_SIZE.prose): MktgPrintRich => ({
  paras: texts.map((text) => ({ text, size })),
  color: look.dark,
  font: null,
});
const sentence = 'The synthetic project builds open tooling with its community. ';

describe('the deck page plan on paper', () => {
  it('keeps the deck canvas and the page plan boxes value for value, and scales once to the frame width', () => {
    expect(MKTG_PRINT_PAGE_CANVAS).toEqual({ w: 720, h: 405 });
    expect(MKTG_PRINT_PAGE_AREA).toEqual({ x: 25, y: 91, w: 671, h: 265 });
    expect(MKTG_PRINT_PAGE_LEFT).toEqual({ x: 25, y: 91, w: 200, h: 265 });
    expect(MKTG_PRINT_PAGE_RIGHT).toEqual({ x: 247, y: 91, w: 449, h: 265 });
    expect(MKTG_PRINT_PAGE_LOGO_FRAME).toEqual({ x: 18.4, y: 366, w: 67.9, h: 22.4 });
    expect(MKTG_PRINT_PAGE_FOOTER_LEFT_X).toBe(92);
    expect(MKTG_PRINT_PAGE_SIZE).toMatchObject({ title: 22, prose: 11, eyebrow: 7.5, caption: 8, card: 9.5, head: 8 });
    expect(MKTG_PRINT_PAGE_INSET).toBe(7.2);
    expect(MKTG_PRINT_PAGE_LINE).toBe(1.22);
    expect(MKTG_PRINT_PAGE_MIN_SCALE).toBe(0.72);
    expect(MKTG_PRINT_PAGE_SCALE).toBeCloseTo(1.1, 10);
    // The frame fits Letter (792 × 612) and A4 (842 × 595) landscape whole; the slide is centred in it.
    expect(MKTG_PRINT_PAGE_FRAME_PT.w).toBeLessThanOrEqual(792);
    expect(MKTG_PRINT_PAGE_FRAME_PT.h).toBeLessThan(595);
    expect(MKTG_PRINT_PAGE_SLIDE_TOP_PT).toBeCloseTo((594 - 445.5) / 2, 10);
  });
});

describe('the fit', () => {
  it('wraps greedily by words, counts hard lines and breaks a word longer than a line', () => {
    expect(mktgPrintWrapLines('one two three', 9)).toBe(2);
    expect(mktgPrintWrapLines('a\nb\n\nc', 100)).toBe(4);
    expect(mktgPrintWrapLines('abcdefghijklmnopqrstuvwxyz', 10)).toBe(3);
    expect(mktgPrintWrapLines('', 10)).toBe(1);
  });

  it('measures characters per line from the width, the size and the face (wider for bold, capitals and a bullet)', () => {
    const plain = mktgPrintCharsPerLine(MKTG_PRINT_PAGE_LEFT.w, MKTG_PRINT_PAGE_SIZE.prose);
    expect(plain).toBe(Math.floor((200 - 2 * 7.2) / (11 * 0.55)));
    expect(mktgPrintCharsPerLine(MKTG_PRINT_PAGE_LEFT.w, MKTG_PRINT_PAGE_SIZE.prose, { weight: 600 })).toBeLessThan(plain);
    expect(mktgPrintCharsPerLine(MKTG_PRINT_PAGE_LEFT.w, MKTG_PRINT_PAGE_SIZE.prose, { caps: true })).toBeLessThan(plain);
    // Capitals count the letter-spacing the print draws (the deck's 0.72 em plus the tracking), bold does not.
    expect(mktgPrintCharEm({ caps: true })).toBeCloseTo(0.72 + MKTG_PRINT_PAGE_CAPS_TRACKING_EM, 9);
    expect(mktgPrintCharEm({ weight: 600 })).toBe(0.6);
    expect(mktgPrintCharsPerLine(420, 7.5, { caps: true })).toBe(Math.floor((420 - 2 * 7.2) / (7.5 * (0.72 + MKTG_PRINT_PAGE_CAPS_TRACKING_EM))));
    expect(mktgPrintCharsPerLine(MKTG_PRINT_PAGE_LEFT.w, MKTG_PRINT_PAGE_SIZE.prose, { bullet: true })).toBeLessThan(plain);
    expect(mktgPrintCharsPerLine(1, 100)).toBe(1);
  });

  it('gives a block its insets and line height, and says whether it fits', () => {
    const one = rich(['Short.']);
    expect(mktgPrintRichHeight(one, MKTG_PRINT_PAGE_LEFT.w)).toBeCloseTo(2 * 7.2 + 11 * 1.22, 6);
    expect(mktgPrintFits(one, MKTG_PRINT_PAGE_LEFT.w, 30)).toBe(true);
    expect(mktgPrintFits(one, MKTG_PRINT_PAGE_LEFT.w, 20)).toBe(false);
  });

  it('scales sizes down to the half point and the space above with them', () => {
    const scaled = mktgPrintScaleRich({ paras: [{ text: 'a', size: 11, above: 7.7 }], color: '#000', font: null }, 0.8);
    expect(scaled.paras[0].size).toBe(8.5);
    expect(scaled.paras[0].above).toBe(6.2);
  });

  it('fits a long text by setting it smaller, never below the floor', () => {
    const long = rich([sentence.repeat(14).trim()]);
    expect(mktgPrintFits(long, MKTG_PRINT_PAGE_LEFT.w, MKTG_PRINT_PAGE_LEFT.h)).toBe(false);
    const fitted = mktgPrintFitRich(long, MKTG_PRINT_PAGE_LEFT.w, MKTG_PRINT_PAGE_LEFT.h);
    expect(fitted).not.toBeNull();
    expect(fitted?.paras[0].size).toBeLessThan(11);
    expect(fitted?.paras[0].size).toBeGreaterThanOrEqual(11 * MKTG_PRINT_PAGE_MIN_SCALE - 0.5);
    expect(mktgPrintFitRich(rich([sentence.repeat(60)]), MKTG_PRINT_PAGE_LEFT.w, MKTG_PRINT_PAGE_LEFT.h)).toBeNull();
  });

  it('cuts at a sentence when one fits, else at a word with an ellipsis', () => {
    expect(mktgPrintSentences('One. Two! Three? (Four.)')).toEqual(['One.', 'Two!', 'Three?', '(Four.)']);
    expect(mktgPrintCutText('First sentence. Second sentence is longer.', 20)).toBe('First sentence.');
    expect(mktgPrintCutText('No sentence end here at all for a while', 12)).toBe('No sentence…');
    expect(mktgPrintCutText('short', 12)).toBe('short');
    // The split keeps the deck's semantics on a double space and on tabs, and the cut sheds a run of tabs and
    // punctuation before its ellipsis in one pass (CodeQL: no trailing-class regex on library input).
    expect(mktgPrintSentences('a. b.  c')).toEqual(['a. b.  c']);
    expect(mktgPrintSentences('A. B.  C')).toEqual(['A.', 'B.', 'C']);
    expect(mktgPrintSentences('One.\tTwo.')).toEqual(['One.', 'Two.']);
    expect(mktgPrintCutText(`Word, trail${'\t'.repeat(40)}and more words after the tabs`, 14)).toBe('Word, trail…');
    expect(mktgPrintCutText(`Lead word.${'\t'.repeat(2000)}X`, 11)).toBe('Lead word.');
    expect(mktgPrintCutText('A tabbed\t\tphrase, — more words follow here', 18)).toBe('A tabbed phrase…');
    expect(mktgPrintOneLine('A short line', 200, 11)).toBe('A short line');
    expect(mktgPrintOneLine(sentence.repeat(3), 100, 11).endsWith('…')).toBe(true);
  });

  it('cuts a paragraph with runs as a prefix, the runs clipped and the ellipsis on the last', () => {
    const para = {
      text: 'Label: the value of the row goes on for a while',
      size: 9.5,
      runs: [{ text: 'Label:', weight: 600 }, { text: ' the value of the row goes on for a while' }],
    };
    const cut = mktgPrintCutPara(para, 20);
    expect(cut.text.endsWith('…')).toBe(true);
    expect(cut.runs?.map((run) => run.text).join('')).toBe(cut.text);
    expect(cut.runs?.[0]).toEqual({ text: 'Label:', weight: 600 });
    expect(mktgPrintCutPara(para, 200)).toEqual(para);
    // A run's tail sheds the middle dot too (the deck's run set), the ellipsis on the last run kept.
    const dotted = {
      text: 'Name · the rest of a long row of text',
      size: 9.5,
      runs: [{ text: 'Name ·', weight: 600 }, { text: ' the rest of a long row of text' }],
    };
    const dottedCut = mktgPrintCutPara(dotted, 8);
    expect(dottedCut.runs?.map((run) => run.text).join('')).toBe(dottedCut.text);
    expect(dottedCut.text.endsWith('…')).toBe(true);
    expect(dottedCut.text).not.toContain('·…');
  });

  it('fits or cuts: the block always fits its box, the longest paragraph cut first', () => {
    const long = rich(['Short lead.', sentence.repeat(80).trim()]);
    const { rich: fitted, cut } = mktgPrintFitOrCut(long, MKTG_PRINT_PAGE_LEFT.w, MKTG_PRINT_PAGE_LEFT.h);
    expect(cut).toBe(true);
    expect(mktgPrintFits(fitted, MKTG_PRINT_PAGE_LEFT.w, MKTG_PRINT_PAGE_LEFT.h)).toBe(true);
    expect(fitted.paras[0].text).toBe('Short lead.');
    expect(fitted.paras[1].text.length).toBeLessThan(long.paras[1].text.length);
    expect(mktgPrintFitOrCut(rich(['Fits.']), MKTG_PRINT_PAGE_LEFT.w, MKTG_PRINT_PAGE_LEFT.h)).toEqual({ rich: rich(['Fits.']), cut: false });
  });

  it('paginates items as many per page as fit, at least one', () => {
    expect(mktgPrintPaginate([1, 2, 3, 4, 5], (page) => page.length <= 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(mktgPrintPaginate([1, 2], () => false)).toEqual([[1], [2]]);
    expect(mktgPrintPaginate([], () => true)).toEqual([]);
  });
});

describe('the page grammar', () => {
  it("sizes in deck points through the shell's one scale property", () => {
    expect(mktgPagePt(25)).toBe('calc(var(--mktg-page-scale) * 25pt)');
    expect(mktgPagePt(7.7 * 0.8)).toBe('calc(var(--mktg-page-scale) * 6.16pt)');
    expect(mktgPageBoxStyle(MKTG_PRINT_PAGE_AREA)).toEqual({
      left: 'calc(var(--mktg-page-scale) * 25pt)',
      top: 'calc(var(--mktg-page-scale) * 91pt)',
      width: 'calc(var(--mktg-page-scale) * 671pt)',
      height: 'calc(var(--mktg-page-scale) * 265pt)',
    });
  });

  it("derives the look from the print brand as the deck's look.ts does: tint, muted and rule mixed from the dark, the on-dark ink by contrast", () => {
    const brand = mktgPrintBrand(null);
    expect(look).toMatchObject({ dark: brand.dark, ink: brand.ink, accent: brand.accent, font: brand.fontStack });
    expect(look.ink).toBe(brand.dark);
    expect(look.tint).toBe(mktgPrintMixHex('#FFFFFF', brand.dark, 0.06));
    expect(look.muted).toBe(mktgPrintMixHex(brand.dark, '#FFFFFF', 0.3));
    expect(look.rule).toBe(mktgPrintMixHex('#FFFFFF', brand.dark, 0.16));
    expect(look.onDark).toBe('#FFFFFF');
    expect(mktgPrintMixHex('#000000', '#FFFFFF', 0.3)).toBe('#4D4D4D');
    expect(mktgPrintMixHex('#FFFFFF', '#102040', 0.06)).toBe('#F1F2F4');
    expect(mktgPrintMixHex('rgb(0,0,0)', '#FFFFFF', 0.3)).toBe('rgb(0,0,0)');
    // A light "dark" (#F4F4F4) takes the darkest gray on its ground; a non-hex dark keeps the brand's inks and the app's grays.
    const light = mktgPrintPageLook({ ...brand, dark: '#F4F4F4' });
    expect(light.onDark).toBe(MKTG_PRINT_INK_ON_LIGHT);
    const named = mktgPrintPageLook({ ...brand, dark: 'navy', tint: 'azure', onDark: 'white' });
    expect(named).toMatchObject({ tint: 'azure', onDark: 'white', muted: MKTG_PRINT_PAGE_MUTED_INK, rule: MKTG_PRINT_PAGE_RULE_INK });
    // A kit whose dark is white: the covers and panels keep the white ground, the body text takes the brand's
    // contrast-safe ink (mktgPrintBrand), never white on white.
    const kit = brandKitTestRevision();
    const white = mktgPrintPageLook(mktgPrintBrand({ ...kit, kit: { ...kit.kit, dark: '#FFFFFF' } }));
    expect(white.dark).toBe('#FFFFFF');
    expect(white.ink).toBe(MKTG_PRINT_INK_ON_LIGHT);
    expect(white.onDark).toBe(MKTG_PRINT_INK_ON_LIGHT);
    expect(mktgPrintProseColumn(white, [{ text: 'Body text.', size: 11 }]).text?.color).toBe(MKTG_PRINT_INK_ON_LIGHT);
    expect(mktgPrintTitleRich(white, 'Title').color).toBe(MKTG_PRINT_INK_ON_LIGHT);
  });

  it('builds a content page with the title fitted to the band and the two eyebrow lines, and a footer with a two-digit number', () => {
    const column = mktgPrintProseColumn(look, mktgPrintProseParas(['A paragraph.', 'Another.']));
    const page = mktgPrintWithFooter(
      mktgPrintContentPage(look, 'Logo system', { left: '01 Logo', right: 'Synthetic Project Brand Kit' }, [column]),
      mktgPrintFooterLine('Synthetic Project'),
      3
    );
    expect(page.layout).toBe('content');
    expect(page.title).toBe('Logo system');
    expect(page.titleRich.paras[0]).toMatchObject({ text: 'Logo system', size: 22 });
    expect(page.head).toEqual({ left: '01 Logo', right: 'Synthetic Project Brand Kit' });
    expect(page.footer).toEqual({ left: 'Synthetic Project · a Linux Foundation project', number: '03' });
    expect(page.els).toEqual([column]);
    expect(column.box).toEqual(MKTG_PRINT_PAGE_LEFT);
    expect(column.text?.paras.map((p) => p.above)).toEqual([0, 11 * 0.7]);
    const head = mktgPrintHeadEls(look, page.head ?? { left: '', right: '' });
    expect(head[0].text?.paras[0]).toMatchObject({ text: '01 Logo', caps: true, size: 7.5, color: look.muted });
    expect(head[1].text?.align).toBe('END');
    const footer = mktgPrintFooterEls(look, 'line', '03');
    expect(footer[0].box.x).toBe(MKTG_PRINT_PAGE_FOOTER_LEFT_X);
    expect(footer[1].text?.paras[0].text).toBe('03');
    expect(mktgPrintPageNumber(12)).toBe('12');
  });

  it('builds the cover and the back cover on the dark ground, their titles in the ink on the dark', () => {
    const cover = mktgPrintCoverPage(look, 'Brand Kit', 'Logos, color, type and usage on one reference.', []);
    expect(cover.layout).toBe('cover');
    expect(cover.titleRich.paras[0]).toMatchObject({ text: 'Brand Kit', size: 44 });
    expect(cover.titleRich.color).toBe(look.onDark);
    expect(cover.titleRich).toEqual(mktgPrintCoverTitleRich(look, 'Brand Kit'));
    expect(mktgPrintCoverTitleRich(look, 'Brand Kit', 36).paras[0].size).toBe(36);
    expect(mktgPrintBackTitleRich(look, 'Open standards')).toMatchObject({ color: look.onDark, align: 'CENTER', anchor: 'MIDDLE' });
    expect(mktgPrintBackTitleRich(look, 'Open standards').paras[0]).toMatchObject({ text: 'Open standards', caps: true, size: MKTG_PRINT_PAGE_SIZE.title });
    expect(cover.subtitle?.paras[0]).toMatchObject({ text: 'Logos, color, type and usage on one reference.', size: 15 });
    expect(cover.titleBox).toBeUndefined();
    expect(cover.subtitleBox).toBeUndefined();
    // A cover's own boxes: carried on the page, the subtitle fitted to its own (here a box one line tall, so it is set smaller).
    const long = Array.from({ length: 3 }, () => 'Logos, color, type and usage on one reference.').join(' ');
    const boxes = { title: { x: 38, y: 126, w: 624, h: 139 }, subtitle: { x: 38, y: 265, w: 624, h: 30 } };
    const own = mktgPrintCoverPage(look, 'Positioning & brand', long, [], 40, boxes);
    expect(own.titleBox).toEqual(boxes.title);
    expect(own.subtitleBox).toEqual(boxes.subtitle);
    expect(own.titleRich.paras[0].size).toBe(40);
    // The title is fitted to its own box too: thirty characters at 40 pt stay whole in the family's box, where the deck's 560×70 box sets them smaller or cuts.
    const thirty = 'Positioning and brand platform';
    const family = mktgPrintCoverPage(look, thirty, long, [], 40, boxes);
    expect(family.titleRich.paras[0]).toMatchObject({ text: thirty, size: 40 });
    expect(family.titleRich).toEqual(mktgPrintCoverTitleRich(look, thirty, 40, boxes.title));
    const deck = mktgPrintCoverPage(look, thirty, long, [], 40).titleRich.paras[0];
    expect(deck.size < 40 || deck.text !== thirty).toBe(true);
    expect(mktgPrintCoverPage(look, 'Positioning & brand', long, [], 40).subtitle?.paras[0].size).toBe(15);
    expect(own.subtitle?.paras[0].size).toBeLessThan(15);
    const back = mktgPrintBackPage(look, 'Open tooling for everyone', []);
    expect(back.layout).toBe('back');
    expect(back.titleRich.paras[0]).toMatchObject({ text: 'Open tooling for everyone', caps: true });
    expect(back.titleRich.align).toBe('CENTER');
  });

  it('stacks blocks down a column, set smaller together, then cut, so the column never overflows', () => {
    const blocks = [{ rich: rich(['Lead.']) }, { rich: rich([sentence.repeat(50).trim()]), gap: 10 }];
    const { els, bottom } = mktgPrintStack(blocks, 25, 91, 200, 120);
    expect(els).toHaveLength(2);
    expect(els[1].box.y).toBeCloseTo(els[0].box.y + els[0].box.h + 10, 6);
    expect(bottom).toBeLessThanOrEqual(91 + 120 + 0.01);
    expect((els[1].text?.paras[0].text.length ?? 0) < sentence.repeat(50).trim().length).toBe(true);
  });

  it('bounds rows to a page budget, scales rows together and names continuation pages as the deck does', () => {
    const row = rich([sentence.repeat(30).trim()], MKTG_PRINT_PAGE_SIZE.card);
    expect(mktgPrintRowHeight(row, 671)).toBeGreaterThan(60);
    expect(mktgPrintRowHeight(mktgPrintClampRow(row, 671, 60), 671)).toBeLessThanOrEqual(60.01);
    const rows = [rich(['a']), rich(['b'])];
    expect(mktgPrintScaleRows(rows, 671, 1000)).toEqual(rows);
    expect(mktgPrintScaleRows([row, row, row, row], 671, 100)).toEqual([row, row, row, row]);
    expect(mktgPrintContinued('Goal columns', 0)).toBe('Goal columns');
    expect(mktgPrintContinued('Goal columns', 1)).toBe('Goal columns (2)');
    expect(mktgPrintBulletParas(['a', ' ', 'b']).map((p) => [p.bullet, p.above])).toEqual([
      [true, 0],
      [true, 11 * 0.45],
    ]);
  });

  it('keeps a text element inside its box and the text helpers as the deck has them', () => {
    const el = mktgPrintTextEl({ x: 0, y: 0, w: 100, h: 30 }, rich([sentence.repeat(10)]), { fill: look.tint, shape: 'ROUND_RECTANGLE' });
    expect(el).toMatchObject({ t: 'shape', shape: 'ROUND_RECTANGLE', fill: look.tint });
    expect(mktgPrintFits(el.text ?? rich([]), 100, 30)).toBe(true);
    expect(mktgPrintWithSentence('A line', 'Ends here.')).toBe('A line Ends here.');
    expect(mktgPrintWithSentence('Has it. Ends here.', 'Ends here.')).toBe('Has it. Ends here.');
    expect(mktgPrintWithoutNote('Keep this. Drop that.', 'Drop that.')).toBe('Keep this.');
    expect(mktgPrintWithoutSourceSentences('The palette is calm. Values were found on the site. It pairs well.')).toBe('The palette is calm. It pairs well.');
    expect(mktgPrintInWords(['a'])).toBe('a');
    expect(mktgPrintInWords(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('renders a solid outline as an inset shadow and a dashed one as a border, and carries an image’s transform and a slot’s context through', () => {
    const box = { x: 10, y: 20, w: 100, h: 50 };
    const solid = mktgPrintElView(mktgPrintShapeEl('RECTANGLE', box, look.tint, { color: look.dark, weight: 1 }));
    expect(solid.style).toMatchObject({ 'background-color': look.tint, 'box-shadow': `inset 0 0 0 ${mktgPagePt(1)} ${look.dark}` });
    expect(solid.style['border']).toBeUndefined();
    // The clear-space frame and a partner's slot: dashed, which a shadow cannot draw, so a border, and no shadow.
    const dashed = mktgPrintElView(mktgPrintShapeEl('RECTANGLE', box, null, { color: look.muted, weight: 0.75, dash: true }));
    expect(dashed.style['border']).toBe(`${mktgPagePt(0.75)} dashed ${look.muted}`);
    expect(dashed.style['box-shadow']).toBeUndefined();
    expect(dashed.style['background-color']).toBeUndefined();
    // An image keeps its distortion (the watchouts) and a slot its context (an icon's index and ink) on the element itself; neither has text.
    const image = mktgPrintElView({ t: 'image', box, src: 'data:image/svg+xml,x', alt: 'Lockup', filter: '', transform: 'scaleX(1.45)' });
    expect(image.text).toBeNull();
    expect(image.el).toMatchObject({ t: 'image', transform: 'scaleX(1.45)' });
    const slot = mktgPrintElView({ t: 'slot', box, slot: 'icon', context: { index: 2, color: look.dark } });
    expect(slot.text).toBeNull();
    expect(slot.el).toMatchObject({ t: 'slot', slot: 'icon', context: { index: 2, color: look.dark } });
    expect(slot.style).toMatchObject({ left: mktgPagePt(10), top: mktgPagePt(20), width: mktgPagePt(100), height: mktgPagePt(50) });
  });
});
