// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The kit book's pages against the deck's own expectations (marketing-os-agents
// agents/slides-export src/test/deck.test.ts at 7839d985, the kit cases): the
// order and the headings of BRAND_KIT_BOOK_PAGES, the contents' numbers, the
// footer on every content page, the logo slots dropped without artwork, the
// icons as slots, the pagination of the contrast rows.

import { describe, expect, it } from 'vitest';
import { BRAND_KIT_ICON_SAMPLES } from '../constants/brand-kit-icons.constants';
import { BRAND_KIT_BOOK_PAGES } from '../constants/brand-kit.constants';
import {
  MKTG_PRINT_BRAND_KIT_CONTRAST_PILLS,
  MKTG_PRINT_BRAND_KIT_CONTRAST_PILL_H,
  MKTG_PRINT_BRAND_KIT_CONTRAST_ROWS_PER_PAGE,
  MKTG_PRINT_BRAND_KIT_ICON_SLOT,
} from '../constants/mktg-print-brand-kit.constants';
import { MKTG_PRINT_PAGE_FOOTER_MARGIN_LEFT_BOX, MKTG_PRINT_PAGE_RIGHT } from '../constants/mktg-print-page.constants';
import { MKTG_PRINT_INK_ON_DARK } from '../constants/mktg-print.constants';
import type { BrandKitContrastRow, BrandKitRevision } from '../interfaces/brand-kit.interface';
import type { MktgPrintPage, MktgPrintPageEl, MktgPrintPageShapeEl, MktgPrintPageSlotEl } from '../interfaces/mktg-print-page.interface';
import { brandKitTestRevision } from './__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView } from './brand-kit-book.utils';
import {
  buildBrandKitPrintPages,
  mktgBrandKitBookPageCount,
  mktgPrintBrandKitColorwaySlots,
  mktgPrintBrandKitContext,
  mktgPrintBrandKitCover,
  mktgPrintBrandKitLogos,
  mktgPrintBrandKitSymbolOn,
  mktgPrintBrandKitUsageGround,
  mktgPrintBrandKitWithoutStackedLockup,
} from './mktg-print-brand-kit.utils';
import { mktgPrintPageLook } from './mktg-print-page.utils';
import { mktgPrintBrand } from './mktg-print.utils';

const CONTENT_TITLES = BRAND_KIT_BOOK_PAGES.filter((p) => p.id !== 'back-cover').map((p) => p.title);

function pagesOf(kit: BrandKitRevision = brandKitTestRevision(), options = {}): MktgPrintPage[] {
  const view = buildBrandKitBookView(kit, kit.version);
  return buildBrandKitPrintPages(view, mktgPrintBrand(kit), kit.projectName, options);
}

function texts(page: MktgPrintPage): string[] {
  return page.els.flatMap((el) => (el.t === 'shape' && el.text ? el.text.paras.map((p) => p.text) : []));
}

function slots(page: MktgPrintPage): MktgPrintPageSlotEl[] {
  return page.els.filter((el): el is MktgPrintPageSlotEl => el.t === 'slot');
}

function images(page: MktgPrintPage): Extract<MktgPrintPageEl, { t: 'image' }>[] {
  return page.els.filter((el): el is Extract<MktgPrintPageEl, { t: 'image' }> => el.t === 'image');
}

describe('buildBrandKitPrintPages', () => {
  it('lays out the contents page, then the thirteen content pages in BRAND_KIT_BOOK_PAGES order with their titles, every one a content page with its chapter head', () => {
    const pages = pagesOf();
    expect(pages[0].title).toBe('What’s inside');
    expect(pages[0].head).toEqual({ left: 'Contents', right: 'Project One Brand Kit' });
    expect(pages.slice(1).map((p) => p.title)).toEqual(CONTENT_TITLES);
    expect(pages.every((p) => p.layout === 'content')).toBe(true);
    expect(pages[1].head).toEqual({ left: '01 Logo', right: 'Project One Brand Kit' });
    expect(pages[7].head?.left).toBe('02 Color');
    expect(pages[9].head?.left).toBe('03 Type');
    expect(pages[10].head?.left).toBe('04 Visual');
    expect(pages[12].head?.left).toBe('05 Usage');
    expect(pages[13].head?.left).toBe('06 Voice');
  });

  it('numbers the pages with the cover counted (the cover is 01, the contents 02) and carries the footer line on every one', () => {
    const pages = pagesOf();
    expect(pages.map((p) => p.footer?.number)).toEqual(pages.map((_, i) => String(i + 2).padStart(2, '0')));
    expect(new Set(pages.map((p) => p.footer?.left))).toEqual(new Set(['Project One · a Linux Foundation project']));
    // In a larger document the first page's number moves the rest.
    const later = pagesOf(brandKitTestRevision(), { firstPage: 5 });
    expect(later[0].footer?.number).toBe('06');
  });

  it('lists on the contents page the page each book page starts on, the back cover’s row among them, in two columns', () => {
    const [contents] = pagesOf();
    const rows = texts(contents).filter((t) => /^\d\d {3}/.test(t));
    // Every BOOK_PAGES id has a row (kit-book.ts builds them over all of them): the thirteen chapter pages and the back cover.
    expect(rows).toHaveLength(CONTENT_TITLES.length + 1);
    expect(rows[0]).toBe('03   Logo system');
    expect(rows[rows.length - 2]).toBe(`${String(CONTENT_TITLES.length + 2).padStart(2, '0')}   Voice in brief`);
    expect(rows[rows.length - 1]).toBe('16   Back cover');
    // Without the back cover (inside a document with its own), its row goes too.
    const [alone] = pagesOf(brandKitTestRevision(), { backCover: false });
    expect(texts(alone).filter((t) => /^\d\d {3}/.test(t))).toHaveLength(CONTENT_TITLES.length);
    expect(texts(alone)).not.toContain('16   Back cover');
    const columns = contents.els.filter((el) => el.t === 'shape' && el.box.x >= MKTG_PRINT_PAGE_RIGHT.x && el.text && el.text.paras.length > 1);
    expect(columns).toHaveLength(2);
    expect(texts(contents)[0]).toContain('Built from');
  });

  it('shows no version on any inner page', () => {
    const pages = pagesOf();
    expect(pages.flatMap(texts).some((t) => /\bV1\.0\b/.test(t))).toBe(false);
  });

  it('draws the primary lockup where the kit has it as its SVG, and drops the slots of the variants the kit has no artwork for', () => {
    const kit = brandKitTestRevision();
    const view = buildBrandKitBookView(kit, 1);
    const logos = mktgPrintBrandKitLogos(view);
    expect(logos.primary?.src).toMatch(/^data:image\/svg\+xml/);
    expect(logos.primary?.filter).toBe('');
    // The reversed and one-colour lockups are the primary under the colorway tiles' filters (one code path with the web book).
    expect(logos.reversed?.src).toBe(logos.primary?.src);
    expect(logos.reversed?.filter).not.toBe('');
    expect(logos.one_color?.filter).not.toBe('');
    // No symbol file and no symbol crop: no symbol, so the Symbol page's tiles and shapes are dropped, never labelled.
    expect(logos.symbol).toBeNull();
    expect(logos.symbol_reversed).toBeNull();
    const pages = pagesOf(kit);
    const symbol = pages.find((p) => p.title === 'Symbol & symbol in shape');
    expect(images(symbol as MktgPrintPage)).toHaveLength(0);
    expect(texts(symbol as MktgPrintPage)).not.toContain('Variants');
    expect(texts(symbol as MktgPrintPage)).not.toContain('In shape');
    const system = pages.find((p) => p.title === 'Logo system') as MktgPrintPage;
    expect(images(system)).toHaveLength(1);
    expect(texts(system)).toContain('Primary · horizontal lockup');
    expect(texts(system)).not.toContain('Symbol');
    // With a primary lockup the footer line sits left of the logo frame; with none, it starts at the margin (the prototype's footer).
    expect(pages.every((p) => p.footer?.leftBox === undefined)).toBe(true);
    const noLogo = { ...kit.chapters.logo, files: { ...kit.chapters.logo.files, primary: null } };
    const bare = pagesOf({ ...kit, chapters: { ...kit.chapters, logo: noLogo } });
    expect(bare.length).toBe(pages.length);
    expect(bare.every((p) => p.footer?.leftBox === MKTG_PRINT_PAGE_FOOTER_MARGIN_LEFT_BOX)).toBe(true);
  });

  it('keeps the Scaling row inside its column at a large screen or symbol size, the labels still naming the pixel value', () => {
    const kit = brandKitTestRevision();
    const logo = { ...kit.chapters.logo, symbol_viewbox: '0 0 3 3', minimum_size: { ...kit.chapters.logo.minimum_size, screen_px: 96, symbol_px: 64 } };
    const page = pagesOf({ ...kit, chapters: { ...kit.chapters, logo } }).find((p) => p.title === 'Clear space & minimum size') as MktgPrintPage;
    const right = MKTG_PRINT_PAGE_RIGHT.x + MKTG_PRINT_PAGE_RIGHT.w;
    const row = page.els.filter((el) => el.box.y >= 256 && el.box.x >= MKTG_PRINT_PAGE_RIGHT.x - 4);
    expect(row.filter((el) => el.t === 'image')).toHaveLength(4);
    for (const el of row) expect(el.box.x + el.box.w).toBeLessThanOrEqual(right + 1e-9);
    const captions = row.filter((el) => el.t === 'shape' && el.text);
    for (const el of captions) expect(el.box.w).toBeGreaterThan(0);
    expect(captions.flatMap((el) => (el.t === 'shape' && el.text ? el.text.paras.map((p) => p.text) : []))).toEqual([
      'Scaling',
      '48 px',
      '40 px',
      '96 px',
      'Symbol 64 px',
    ]);
    // At the fixture's sizes (32 / 16 px) the row fits as the deck draws it: no box shrinks.
    const plain = pagesOf(kit).find((p) => p.title === 'Clear space & minimum size') as MktgPrintPage;
    expect(
      images(plain)
        .filter((el) => el.box.y >= 256)
        .map((el) => el.box.w)
    ).toEqual([120, 100, 80]);
    // A 48 px kit with a 16 px symbol fits too: the deck's sizes, unshrunk (the lockups 120, 100 and 120 wide, the symbol 12).
    const parity = { ...logo, minimum_size: { ...logo.minimum_size, screen_px: 48, symbol_px: 16 } };
    const deck = pagesOf({ ...kit, chapters: { ...kit.chapters, logo: parity } }).find((p) => p.title === 'Clear space & minimum size') as MktgPrintPage;
    expect(
      images(deck)
        .filter((el) => el.box.y >= 256)
        .map((el) => el.box.w)
    ).toEqual([120, 100, 120, 12]);
  });

  it('draws the colorways in the contract’s order on their grounds, each captioned with the kit’s name', () => {
    const kit = brandKitTestRevision();
    const look = mktgPrintPageLook(mktgPrintBrand(kit));
    expect(mktgPrintBrandKitColorwaySlots(look).map((s) => s.ground)).toEqual([MKTG_PRINT_INK_ON_DARK, look.dark, look.tint, MKTG_PRINT_INK_ON_DARK]);
    const page = pagesOf(kit).find((p) => p.title === 'Colorways') as MktgPrintPage;
    expect(images(page)).toHaveLength(4);
    expect(texts(page)).toEqual(expect.arrayContaining(kit.chapters.logo.colorways.map((c) => c.name)));
  });

  it('draws a watchout card only where the mistake can be shown (stretched, rotated, retyped), each with the ✕ and its caption', () => {
    const page = pagesOf().find((p) => p.title === 'Watchouts') as MktgPrintPage;
    const imgs = images(page);
    expect(imgs.map((i) => i.transform)).toEqual(['scaleX(1.45)', 'rotate(-14deg)']);
    expect(texts(page).filter((t) => t === '✕')).toHaveLength(3);
    expect(texts(page)).toEqual(expect.arrayContaining(['Stretch', 'Rotate', 'Retype']));
    const retyped = page.els.find((el) => el.t === 'shape' && el.text?.paras[0]?.font === 'Georgia');
    expect(retyped).toBeDefined();
  });

  it('draws the palette as filled swatches with the value, the role and the source line in the board’s words, then the proportion bar', () => {
    const page = pagesOf().find((p) => p.title === 'Color palette') as MktgPrintPage;
    const t = texts(page);
    expect(t).toContain('HEX #4D4E4E');
    expect(t).toContain('from the logo artwork');
    expect(t).toContain('Proportion');
    expect(page.els.some((el) => el.t === 'shape' && el.fill === '#4D4E4E' && el.shape === 'ROUND_RECTANGLE')).toBe(true);
  });

  it('paginates the contrast rows, eleven to a page, and continues the title', () => {
    const kit = brandKitTestRevision();
    const pair = kit.chapters.color.contrast.pairs[0];
    kit.chapters.color.contrast.pairs = Array.from({ length: MKTG_PRINT_BRAND_KIT_CONTRAST_ROWS_PER_PAGE + 1 }, (): BrandKitContrastRow => ({ ...pair }));
    const pages = pagesOf(kit);
    const contrast = pages.filter((p) => /^Color contrast/.test(p.title));
    expect(contrast.map((p) => p.title)).toEqual(['Color contrast', 'Color contrast (2)']);
    expect(texts(contrast[0]).filter((t) => t === 'Aa')).toHaveLength(MKTG_PRINT_BRAND_KIT_CONTRAST_ROWS_PER_PAGE);
    expect(texts(contrast[1]).filter((t) => t === 'Aa')).toHaveLength(1);
    // The pages after it move down one, and the contents say so.
    expect(pages.find((p) => p.title === 'Typography')?.footer?.number).toBe('12');
    expect(texts(pages[0])).toContain('12   Typography');
    expect(mktgBrandKitBookPageCount(pages)).toBe(17);
    // A kit with no pairs keeps its one Color contrast page, the rule alone, so the contents' row points at a page.
    const none = brandKitTestRevision();
    none.chapters.color.contrast = { ...none.chapters.color.contrast, pairs: [] };
    const bare = pagesOf(none);
    expect(bare.filter((p) => /^Color contrast/.test(p.title)).map((p) => p.title)).toEqual(['Color contrast']);
    expect(texts(bare.find((p) => p.title === 'Color contrast') as MktgPrintPage)).toContain(none.chapters.color.contrast.rule);
    expect(texts(bare[0])).toContain('10   Color contrast');
    expect(texts(bare[0])).toContain('11   Typography');
  });

  it('sets the typography page in the kit’s typeface: the family, the specimen, the weights and the scale', () => {
    const kit = brandKitTestRevision();
    const view = buildBrandKitBookView(kit, 1);
    const page = pagesOf(kit).find((p) => p.title === 'Typography') as MktgPrintPage;
    const t = texts(page);
    expect(t).toContain(kit.chapters.type.family);
    expect(t.some((s) => s.startsWith('AaBbCc'))).toBe(true);
    expect(t).toEqual(expect.arrayContaining(kit.chapters.type.weights.map((w) => expect.stringMatching(new RegExp(`${w}$`)))));
    const family = page.els.find((el) => el.t === 'shape' && el.text?.paras[0]?.text === kit.chapters.type.family);
    expect(family?.t === 'shape' && family.text?.font).toBe(view.fontStack);
  });

  it('leaves one slot per icon on the Iconography page: eight on the tiles in the tile ink, eight on the strip in white with the third in the highlight', () => {
    const kit = brandKitTestRevision();
    const view = buildBrandKitBookView(kit, 1);
    const page = pagesOf(kit).find((p) => p.title === 'Iconography') as MktgPrintPage;
    const iconSlots = slots(page);
    expect(iconSlots).toHaveLength(2 * BRAND_KIT_ICON_SAMPLES.length);
    expect(new Set(iconSlots.map((s) => s.slot))).toEqual(new Set([MKTG_PRINT_BRAND_KIT_ICON_SLOT]));
    expect(iconSlots.slice(0, 8).map((s) => s.context?.['index'])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(iconSlots.slice(0, 8).map((s) => s.context?.['color']))).toEqual(new Set([view.iconColours.tileInk]));
    const strip = iconSlots.slice(8).map((s) => s.context?.['color']);
    expect(strip[2]).toBe(view.iconColours.highlight);
    expect(strip.filter((c) => c === '#FFFFFF')).toHaveLength(7);
    expect(texts(page)).toEqual(expect.arrayContaining(BRAND_KIT_ICON_SAMPLES.map((s) => s.label)));
    expect(texts(page)).toContain('Recommended set: Lucide');
    expect(page.els.some((el) => el.t === 'shape' && el.fill === view.iconColours.stripGround)).toBe(true);
  });

  it('draws the four usage examples on the ground the kit names, the Social card with the host as a pill, each captioned name · format', () => {
    const kit = brandKitTestRevision();
    const look = mktgPrintPageLook(mktgPrintBrand(kit));
    expect(mktgPrintBrandKitUsageGround(look, 'white')).toBe(MKTG_PRINT_INK_ON_DARK);
    expect(mktgPrintBrandKitUsageGround(look, 'accent')).toBe(look.accent);
    expect(mktgPrintBrandKitUsageGround(look, 'dark')).toBe(look.dark);
    const page = pagesOf(kit).find((p) => p.title === 'Example usage') as MktgPrintPage;
    const t = texts(page);
    expect(t).toContain('one.example.org');
    expect(t).toEqual(expect.arrayContaining(kit.chapters.usage.examples.map((e) => `${e.name} · ${e.format}`)));
    expect(t).toContain('[Partner] joins Project One');
    // The Primary button and the host pill sit on the kit's dark in the ink that reads on it (white on a dark dark, the
    // on-light ink on a light one), not white regardless.
    const onDark = (page: MktgPrintPage, text: string) =>
      page.els.flatMap((el) => (el.t === 'shape' && el.text ? el.text.paras : [])).find((para) => para.text === text)?.color;
    expect(onDark(page, 'one.example.org')).toBe(look.onDark);
    const light = brandKitTestRevision();
    light.kit = { ...light.kit, dark: '#F2F2F2' };
    const lightLook = mktgPrintPageLook(mktgPrintBrand(light));
    expect(lightLook.onDark).not.toBe(MKTG_PRINT_INK_ON_DARK);
    const lightUsage = pagesOf(light).find((p) => p.title === 'Example usage') as MktgPrintPage;
    expect(onDark(lightUsage, 'one.example.org')).toBe(lightLook.onDark);
    const buttons = pagesOf(light).find((p) => p.title === 'Imagery & graphic elements') as MktgPrintPage;
    expect(onDark(buttons, 'Primary button')).toBe(lightLook.onDark);
  });

  it('takes the prototype’s look items: the verdict pills by grade, the solid accent call-out, the grid ground on the hero band and the keynote card', () => {
    const kit = brandKitTestRevision();
    kit.chapters.color.contrast.pairs = [
      { foreground: 'Charcoal', background: 'White', ratio: 8.3, grade: 'AAA' },
      { foreground: 'Coral', background: 'White', ratio: 3.2, grade: 'Large text only' },
      { foreground: 'Coral', background: 'Charcoal', ratio: 2.1, grade: 'Fails' },
    ];
    const look = mktgPrintPageLook(mktgPrintBrand(kit));
    const shapesWith = (page: MktgPrintPage, text: string) =>
      page.els.filter((el): el is MktgPrintPageShapeEl => el.t === 'shape' && !!el.text?.paras.some((p) => p.text === text));
    const contrast = pagesOf(kit).find((p) => p.title === 'Color contrast') as MktgPrintPage;
    const pills = contrast.els.filter((el): el is MktgPrintPageShapeEl => el.t === 'shape' && el.shape === 'PILL');
    expect(pills).toHaveLength(3);
    (['AAA', 'Large text only', 'Fails'] as const).forEach((grade, i) => {
      const spec = MKTG_PRINT_BRAND_KIT_CONTRAST_PILLS[grade];
      const [label] = shapesWith(contrast, grade);
      // The ground in the grade's colour, sized to its text, at the row's right end inside the column; the text whole, in the grade's ink.
      expect(pills[i]).toMatchObject({ fill: spec.fill, box: { w: spec.w, h: MKTG_PRINT_BRAND_KIT_CONTRAST_PILL_H } });
      expect(pills[i].box.x + pills[i].box.w).toBe(MKTG_PRINT_PAGE_RIGHT.x + MKTG_PRINT_PAGE_RIGHT.w);
      expect(label.text?.paras[0]).toMatchObject({ text: grade, color: spec.ink, weight: 600, size: 9 });
      expect(label.box.x + label.box.w / 2).toBe(pills[i].box.x + pills[i].box.w / 2);
    });
    const imagery = pagesOf(kit).find((p) => p.title === 'Imagery & graphic elements') as MktgPrintPage;
    const [callout] = shapesWith(imagery, 'One per view, for the main call to action.');
    expect(callout).toMatchObject({ shape: 'ROUND_RECTANGLE', fill: look.accent, line: null });
    expect(callout.text?.paras[0].color).toBe(look.dark);
    expect(imagery.els.filter((el) => el.t === 'shape' && el.fill === look.tint)).toHaveLength(0);
    const [hero] = shapesWith(imagery, '— Eyebrow');
    expect(hero).toMatchObject({ fill: look.dark, ground: 'grid' });
    const usage = pagesOf(kit).find((p) => p.title === 'Example usage') as MktgPrintPage;
    const grounds = usage.els.filter((el): el is MktgPrintPageShapeEl => el.t === 'shape' && el.ground === 'grid');
    // The keynote alone: the social card, on the dark too, keeps the plain dark.
    expect(grounds).toHaveLength(1);
    expect(grounds[0].text?.paras[0].text).toBe(kit.chapters.voice.line);
  });

  it('sets the voice page: the umbrella and the brand line over a rule, the four attributes under them on the same page when they fit', () => {
    const pages = pagesOf();
    const voice = pages.filter((p) => /^Voice in brief/.test(p.title));
    expect(voice).toHaveLength(1);
    const t = texts(voice[0]);
    expect(t).toEqual(expect.arrayContaining(['Umbrella message', 'Brand line', 'Plain', 'One sentence.', 'From the messaging framework']));
  });

  it('builds the cover’s lines as the deck’s cover sets them, and counts the cover and the back cover in the page count', () => {
    const kit = brandKitTestRevision();
    const view = buildBrandKitBookView(kit, 1);
    const cover = mktgPrintBrandKitCover(view, kit.projectName);
    expect(cover.title).toBe('Brand Kit');
    expect(cover.subtitle).toBe('Open standards for one computing. Logos, color, type and usage on one reference, for members, partners and the press.');
    // The brand line's trailing stop and space go before the sentence is joined (a linear trim, not a trailing-class regex).
    const trailing = buildBrandKitBookView({ ...kit, chapters: { ...kit.chapters, voice: { ...kit.chapters.voice, line: 'Open standards.  ' } } }, 1);
    expect(mktgPrintBrandKitCover(trailing, kit.projectName).subtitle).toMatch(/^Open standards\. Logos,/);
    expect(cover.eyebrow).toBe('Project One · A Linux Foundation project');
    expect(cover.topRight).toBe('V1.0');
    expect(cover.footerLeft).toBe('Project One · a Linux Foundation project');
    expect(cover.footerRight).toBe('one.example.org · V1.0 · October 2026');
    expect(mktgBrandKitBookPageCount(pagesOf(kit))).toBe(1 + 14 + 1);
    expect(mktgBrandKitBookPageCount(pagesOf(kit), false)).toBe(15);
  });

  it('keeps the kit’s own text where it is drawn, minus the stacked-lockup sentence, and picks the symbol that reads on a ground', () => {
    expect(mktgPrintBrandKitWithoutStackedLockup('One lockup. The stacked lockup is for squares. Two.')).toBe('One lockup. Two.');
    expect(mktgPrintBrandKitSymbolOn('#FFFFFF')).toBe('symbol');
    expect(mktgPrintBrandKitSymbolOn('#111111')).toBe('symbol_reversed');
    const ctx = mktgPrintBrandKitContext(buildBrandKitBookView(brandKitTestRevision(), 1), mktgPrintBrand(brandKitTestRevision()), 'Project One');
    expect(ctx.look.dark).toBe('#4D4E4E');
  });
});
