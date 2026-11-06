// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit as landscape print pages: a port of the deck's kit book
// (marketing-os-agents agents/slides-export src/kit-book.ts at 7839d985)
// over LFX One's own book view, one page per slide, in the deck's order, with
// its headings and numbers. The builder emits the content pages: the contents
// ("What's inside", every BOOK_PAGES row, the back cover's among them) and the
// thirteen chapter pages (six logo pages, the palette, the contrast pairs, the
// typography, the iconography, the imagery, the example usage, the voice); the
// document mounts the cover and the back cover around them as pages of their
// own. A list that does not fit its page continues on a numbered page; the
// contents list the page each starts on. Every content page
// carries the footer "<project> · a Linux Foundation project" and its number;
// no inner page shows the version. Where the deck draws a PNG of a logo
// variant, the pages draw the kit's own SVG (the view's logos and colorway
// filters); where it draws the icon PNGs, the Iconography page leaves one
// slot per icon, which the print fills with the shared icon sample. Pure.

import { BRAND_KIT_ICON_HIGHLIGHT_INDEX, BRAND_KIT_ICON_SAMPLES, BRAND_KIT_ICON_STRIP_INK } from '../constants/brand-kit-icons.constants';
import { BRAND_KIT_BOOK_PAGES, BRAND_KIT_CHAPTERS, BRAND_KIT_TYPE_SPECIMEN } from '../constants/brand-kit.constants';
import {
  MKTG_PRINT_BRAND_KIT_ATTRIBUTE_GRIDS,
  MKTG_PRINT_BRAND_KIT_CONTRAST_ROWS_PER_PAGE,
  MKTG_PRINT_BRAND_KIT_ICON_GRID,
  MKTG_PRINT_BRAND_KIT_ICON_SLOT,
  MKTG_PRINT_BRAND_KIT_PILL,
  MKTG_PRINT_BRAND_KIT_RETYPED_FONT,
  MKTG_PRINT_BRAND_KIT_SOURCE_LINES,
} from '../constants/mktg-print-brand-kit.constants';
import { MKTG_PRINT_INK_ON_DARK } from '../constants/mktg-print.constants';
import {
  MKTG_PRINT_PAGE_AREA,
  MKTG_PRINT_PAGE_INSET,
  MKTG_PRINT_PAGE_LEFT,
  MKTG_PRINT_PAGE_RIGHT,
  MKTG_PRINT_PAGE_SIZE,
} from '../constants/mktg-print-page.constants';
import type { BrandKitBookView, BrandKitLogoImage, BrandKitVoiceAttribute } from '../interfaces/brand-kit.interface';
import type {
  MktgPrintPage,
  MktgPrintPageBox,
  MktgPrintPageEl,
  MktgPrintPageLook,
  MktgPrintPara,
  MktgPrintRich,
} from '../interfaces/mktg-print-page.interface';
import type { MktgPrintBrandKitContext, MktgPrintBrandKitLogoVariant, MktgPrintBrandKitOptions } from '../interfaces/mktg-print-brand-kit.interface';
import type { MktgPrintBrand, MktgPrintLogo } from '../interfaces/mktg-print.interface';
import { brandKitInkOnAccent, brandKitIsLight, brandKitLabelInk } from './brand-kit-book.utils';
import { mktgPrintCharEm, mktgPrintFits, mktgPrintOneLine, mktgPrintPaginate, mktgPrintTrimTrailing } from './mktg-print-fit.utils';
import {
  mktgPrintBulletParas,
  mktgPrintContentPage,
  mktgPrintContinued,
  mktgPrintEyebrowPara,
  mktgPrintFooterLine,
  mktgPrintHairline,
  mktgPrintPageLook,
  mktgPrintPara,
  mktgPrintProseColumn,
  mktgPrintProseParas,
  mktgPrintRich,
  mktgPrintShapeEl,
  mktgPrintStack,
  mktgPrintTextEl,
  mktgPrintWithFooter,
  mktgPrintWithSentence,
  mktgPrintWithoutNote,
  mktgPrintWithoutSourceSentences,
} from './mktg-print-page.utils';

const RIGHT = MKTG_PRINT_PAGE_RIGHT;
const WHITE = MKTG_PRINT_INK_ON_DARK;

type ChapterId = (typeof BRAND_KIT_CHAPTERS)[number]['id'];

/**
 * The logo variants from the book view, where the deck reads the PNGs LFX
 * One's export form sends it: the primary lockup and the symbol are the
 * kit's own SVGs (`view.logos.primary`, `view.symbol`); the reversed and the
 * one-colour lockups are what the book's colorway tiles draw (the supplied
 * reversed file, else the primary under the tile's reversal or one-colour
 * filter: `brandKitColorwayTiles`, one code path with the web book); the
 * reversed symbol is the symbol under the reversed tile's symbol filter. A
 * variant with no drawable artwork (no file, or a PNG the envelope carries no
 * bytes for) is null and every slot that shows it is dropped.
 */
export function mktgPrintBrandKitLogos(view: BrandKitBookView): MktgPrintBrandKitContext['logos'] {
  const image = (logo: BrandKitLogoImage | null | undefined, filter = ''): MktgPrintLogo | null =>
    logo?.src ? { src: logo.src, alt: logo.name, filter } : null;
  const reversedTile = view.colorways[1];
  const oneColorTile = view.colorways[3];
  return {
    primary: image(view.logos.primary),
    reversed: reversedTile ? image(reversedTile.logo, reversedTile.logoFilter) : null,
    one_color: oneColorTile ? image(oneColorTile.logo, oneColorTile.logoFilter) : null,
    symbol: image(view.symbol),
    symbol_reversed: reversedTile ? image(view.symbol, reversedTile.symbolFilter) : null,
  };
}

function head(ctx: MktgPrintBrandKitContext, chapter: ChapterId | null): { left: string; right: string } {
  const c = chapter ? BRAND_KIT_CHAPTERS.find((entry) => entry.id === chapter) : null;
  return { left: c ? `${c.number} ${c.title}` : 'Contents', right: `${ctx.projectName} Brand Kit` };
}

/** A tile: a rounded rectangle on its ground, bordered on a light ground. */
function tile(ctx: MktgPrintBrandKitContext, box: MktgPrintPageBox, ground: string): MktgPrintPageEl {
  return mktgPrintShapeEl('ROUND_RECTANGLE', box, ground, isLightGround(ground) ? { color: ctx.look.rule, weight: 0.75 } : null);
}

function isLightGround(ground: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(ground) ? brandKitIsLight(ground) : ground.toLowerCase() === 'white';
}

function has(ctx: MktgPrintBrandKitContext, variant: MktgPrintBrandKitLogoVariant): boolean {
  return ctx.logos[variant] !== null;
}

/** The logo in `variant` in a box, as an image element; `transform` is the watchouts' distortion. */
function logoEl(ctx: MktgPrintBrandKitContext, variant: MktgPrintBrandKitLogoVariant, box: MktgPrintPageBox, transform = ''): MktgPrintPageEl[] {
  const logo = ctx.logos[variant];
  if (!logo) return [];
  return [{ t: 'image', box, src: logo.src, alt: logo.alt, filter: logo.filter, transform }];
}

/** The logo in `variant`, drawn into the box's middle (70% wide, 60% high, the tile's padding). */
function logoIn(ctx: MktgPrintBrandKitContext, variant: MktgPrintBrandKitLogoVariant, box: MktgPrintPageBox): MktgPrintPageEl[] {
  return logoEl(ctx, variant, { x: box.x + box.w * 0.15, y: box.y + box.h * 0.2, w: box.w * 0.7, h: box.h * 0.6 });
}

/** A tile holding the project logo in `variant` on its ground, or nothing at all when the kit has no such variant: the slot is dropped, never labelled. */
function logoTile(ctx: MktgPrintBrandKitContext, box: MktgPrintPageBox, variant: MktgPrintBrandKitLogoVariant, ground: string = WHITE): MktgPrintPageEl[] {
  if (!has(ctx, variant)) return [];
  return [tile(ctx, box, ground), ...logoIn(ctx, variant, box)];
}

function caption(ctx: MktgPrintBrandKitContext, box: MktgPrintPageBox, text: string, align: 'START' | 'CENTER' = 'START'): MktgPrintPageEl {
  return mktgPrintTextEl(box, mktgPrintRich(ctx.look, [mktgPrintPara(text, MKTG_PRINT_PAGE_SIZE.caption, { color: ctx.look.muted })], { align }));
}

function eyebrowEl(ctx: MktgPrintBrandKitContext, box: MktgPrintPageBox, text: string): MktgPrintPageEl {
  return mktgPrintTextEl(box, mktgPrintRich(ctx.look, [mktgPrintEyebrowPara(ctx.look, text)]));
}

/** The logo-system prose without its sentence on the stacked lockup: the pages draw no stacked slot. */
export function mktgPrintBrandKitWithoutStackedLockup(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/\bstacked\b/i.test(s))
    .join(' ')
    .trim();
}

/** The ink that reads on a colour: the kit's label ink (white or the dark by contrast), or the dark on a named ground. */
function inkOn(hex: string, dark: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? brandKitLabelInk(hex, dark) : dark;
}

// ---------------------------------------------------------------------------
// The pages
// ---------------------------------------------------------------------------

function contentsPage(ctx: MktgPrintBrandKitContext, rows: Array<{ number: string; title: string }>): MktgPrintPage {
  const { look } = ctx;
  const half = Math.ceil(rows.length / 2);
  const column = (items: typeof rows, x: number): MktgPrintPageEl =>
    mktgPrintTextEl(
      { x, y: RIGHT.y, w: 216, h: RIGHT.h },
      mktgPrintRich(
        look,
        items.map((r, i) => ({
          text: `${r.number}   ${r.title}`,
          size: 12,
          above: i === 0 ? 0 : 7,
          runs: [{ text: r.number, color: look.muted }, { text: `   ${r.title}` }],
        }))
      )
    );
  return mktgPrintContentPage(look, 'What’s inside', head(ctx, null), [
    mktgPrintProseColumn(look, mktgPrintProseParas([ctx.view.builtFrom])),
    column(rows.slice(0, half), RIGHT.x),
    column(rows.slice(half), RIGHT.x + 233),
  ]);
}

function logoSystemPage(ctx: MktgPrintBrandKitContext): MktgPrintPage {
  const { look, view } = ctx;
  const els: MktgPrintPageEl[] = [
    mktgPrintProseColumn(
      look,
      mktgPrintProseParas([
        mktgPrintWithSentence(mktgPrintBrandKitWithoutStackedLockup(view.logo.system), 'Logo artwork is supplied as files. Never retype the wordmark.'),
      ])
    ),
  ];
  if (has(ctx, 'primary')) {
    els.push(eyebrowEl(ctx, { x: RIGHT.x, y: 89, w: RIGHT.w, h: 24 }, 'Primary · horizontal lockup'));
    els.push(...logoTile(ctx, { x: RIGHT.x, y: 115, w: RIGHT.w, h: 114 }, 'primary'));
  }
  if (has(ctx, 'symbol')) {
    els.push(eyebrowEl(ctx, { x: RIGHT.x, y: 233, w: 216, h: 24 }, 'Symbol'));
    els.push(...logoTile(ctx, { x: RIGHT.x, y: 259, w: 216, h: 97 }, 'symbol'));
  }
  return mktgPrintContentPage(look, 'Logo system', head(ctx, 'logo'), els);
}

/** The colorways in the contract's order, each with its ground and the variant drawn on it. */
export function mktgPrintBrandKitColorwaySlots(look: MktgPrintPageLook): Array<{ ground: string; variant: MktgPrintBrandKitLogoVariant }> {
  return [
    { ground: WHITE, variant: 'primary' },
    { ground: look.dark, variant: 'reversed' },
    { ground: look.tint, variant: 'primary' },
    { ground: WHITE, variant: 'one_color' },
  ];
}

function colorwaysPage(ctx: MktgPrintBrandKitContext): MktgPrintPage {
  const { look, view } = ctx;
  const els: MktgPrintPageEl[] = [
    mktgPrintProseColumn(
      look,
      mktgPrintProseParas([
        `Full color on white and light grounds. Reversed (white) on ${view.darkName} and dark imagery. One-color black for print, engraving and embossing only.`,
        'Accent colors are never logo colors.',
      ])
    ),
  ];
  const slots = mktgPrintBrandKitColorwaySlots(look);
  const w = (RIGHT.w - 16) / 2;
  const h = 106;
  let k = 0;
  view.logo.colorways.slice(0, 4).forEach((c, i) => {
    const slot = slots[i];
    if (!has(ctx, slot.variant)) return;
    const x = RIGHT.x + (k % 2) * (w + 16);
    const y = RIGHT.y + Math.floor(k / 2) * (h + 30);
    k++;
    els.push(...logoTile(ctx, { x, y, w, h }, slot.variant, slot.ground));
    els.push(caption(ctx, { x, y: y + h + 2, w, h: 26 }, c.name));
  });
  return mktgPrintContentPage(look, 'Colorways', head(ctx, 'logo'), els);
}

function clearSpacePage(ctx: MktgPrintBrandKitContext): MktgPrintPage {
  const { look, view } = ctx;
  const m = view.logo.minimum_size;
  const minimum = /^minimum size/i.test(m.rule)
    ? m.rule
    : `Minimum size: ${m.screen_px} px tall on screen, ${m.print_mm} mm in print.${m.rule ? ` ${m.rule}` : ''} (minimum ${m.symbol_px} px).`;
  const frame = { x: RIGHT.x, y: 91, w: RIGHT.w, h: 160 };
  const mark = (text: string, bx: number, by: number) =>
    mktgPrintTextEl(
      { x: bx, y: by, w: 26, h: 26 },
      mktgPrintRich(look, [mktgPrintPara(text, 9, { color: look.muted })], { align: 'CENTER', anchor: 'MIDDLE' })
    );
  const els: MktgPrintPageEl[] = [mktgPrintProseColumn(look, mktgPrintProseParas([view.logo.clear_space, minimum]))];
  if (has(ctx, 'primary')) {
    els.push(mktgPrintShapeEl('RECTANGLE', frame, null, { color: look.muted, weight: 1, dash: true }));
    els.push(
      mark('X', frame.x + frame.w / 2 - 13, frame.y + 2),
      mark('X', frame.x + frame.w / 2 - 13, frame.y + frame.h - 28),
      mark('X', frame.x + 4, frame.y + frame.h / 2 - 12),
      mark('X', frame.x + frame.w - 30, frame.y + frame.h / 2 - 12)
    );
    els.push(...logoTile(ctx, { x: frame.x + 90, y: frame.y + 38, w: frame.w - 180, h: frame.h - 76 }, 'primary', look.tint));
  }
  if (has(ctx, 'primary') || has(ctx, 'symbol')) els.push(eyebrowEl(ctx, { x: RIGHT.x, y: 256, w: RIGHT.w, h: 24 }, 'Scaling'));
  let cx = RIGHT.x;
  const base = 322;
  if (has(ctx, 'primary')) {
    const sizes = [48, 40, m.screen_px].map((px) => ({ label: `${px} px`, h: px * 0.75, w: px * 0.75 * (10 / 3) }));
    for (const s of sizes) {
      els.push(...logoEl(ctx, 'primary', { x: cx, y: base - s.h, w: s.w, h: s.h }));
      els.push(caption(ctx, { x: cx - 4, y: base + 2, w: Math.max(s.w + 8, 50), h: 26 }, s.label));
      cx += s.w + 24;
    }
  }
  if (has(ctx, 'symbol')) {
    const sym = m.symbol_px * 0.75;
    els.push(...logoEl(ctx, 'symbol', { x: cx, y: base - sym, w: sym, h: sym }));
    els.push(caption(ctx, { x: cx - 4, y: base + 2, w: Math.min(90, RIGHT.x + RIGHT.w - cx + 4), h: 26 }, `Symbol ${m.symbol_px} px`));
  }
  return mktgPrintContentPage(look, 'Clear space & minimum size', head(ctx, 'logo'), els);
}

/** The symbol variant that reads on a ground: the reversed symbol on a dark one, the symbol on a light one. */
export function mktgPrintBrandKitSymbolOn(ground: string): MktgPrintBrandKitLogoVariant {
  return isLightGround(ground) ? 'symbol' : 'symbol_reversed';
}

function symbolPage(ctx: MktgPrintBrandKitContext): MktgPrintPage {
  const { look, view } = ctx;
  const els: MktgPrintPageEl[] = [
    mktgPrintProseColumn(
      look,
      mktgPrintProseParas([
        mktgPrintWithSentence(view.logo.symbol, 'For contained uses, place the symbol in a circle or rounded square, with one X of padding to the edge.'),
      ])
    ),
  ];
  const variants = [
    { colorway: view.logo.colorways[0], variant: 'symbol' as const, ground: WHITE },
    { colorway: view.logo.colorways[1], variant: 'symbol_reversed' as const, ground: look.dark },
  ].filter((t) => has(ctx, t.variant));
  const w = (RIGHT.w - 24) / 3;
  if (variants.length) els.push(eyebrowEl(ctx, { x: RIGHT.x, y: 89, w: RIGHT.w, h: 24 }, 'Variants'));
  variants.forEach((t, k) => {
    const x = RIGHT.x + k * (w + 12);
    els.push(...logoTile(ctx, { x, y: 115, w, h: 86 }, t.variant, t.ground));
    if (t.colorway) els.push(caption(ctx, { x, y: 203, w, h: 26 }, t.colorway.name));
  });
  const s = 98;
  const shapes = [
    { shape: 'ELLIPSE' as const, fill: look.dark, line: null },
    { shape: 'ROUND_RECTANGLE' as const, fill: look.tint, line: { color: look.rule, weight: 0.75 } },
    { shape: 'ROUND_RECTANGLE' as const, fill: look.accent, line: null },
  ]
    .map((sh) => ({ ...sh, variant: mktgPrintBrandKitSymbolOn(sh.fill) }))
    .filter((sh) => has(ctx, sh.variant));
  if (shapes.length) els.push(eyebrowEl(ctx, { x: RIGHT.x, y: 231, w: RIGHT.w, h: 24 }, 'In shape'));
  shapes.forEach((sh, k) => {
    const box = { x: RIGHT.x + k * (s + 24), y: 258, w: s, h: s };
    els.push(mktgPrintShapeEl(sh.shape, box, sh.fill, sh.line));
    els.push(...logoEl(ctx, sh.variant, { x: box.x + s * 0.2, y: box.y + s * 0.2, w: s * 0.6, h: s * 0.6 }));
  });
  return mktgPrintContentPage(look, 'Symbol & symbol in shape', head(ctx, 'logo'), els);
}

function partnershipPage(ctx: MktgPrintBrandKitContext): MktgPrintPage {
  const { look, view } = ctx;
  const els: MktgPrintPageEl[] = [mktgPrintProseColumn(look, mktgPrintBulletParas(view.logo.partnership, 10.5))];
  const h = 125;
  const tiles = [
    { ground: WHITE, ink: look.ink, muted: look.muted, variant: 'primary' as const },
    { ground: look.dark, ink: look.onDark, muted: look.onDark, variant: 'reversed' as const },
  ].filter((t) => has(ctx, t.variant));
  tiles.forEach((t, k) => {
    const y = 91 + k * (h + 15);
    els.push(tile(ctx, { x: RIGHT.x, y, w: RIGHT.w, h }, t.ground));
    const cx = RIGHT.x + RIGHT.w / 2;
    const slot = { y: y + 28, w: 150, h: h - 56 };
    els.push(...logoEl(ctx, t.variant, { x: cx - 30 - slot.w, y: slot.y, w: slot.w, h: slot.h }));
    els.push(mktgPrintShapeEl('RECTANGLE', { x: cx - 1, y: y + 30, w: 2, h: h - 60 }, t.ink));
    els.push(
      mktgPrintTextEl(
        { x: cx + 30, y: slot.y, w: slot.w, h: slot.h },
        mktgPrintRich(look, [mktgPrintEyebrowPara(look, 'Partner logo', { color: t.muted })], { align: 'CENTER', anchor: 'MIDDLE' }),
        {
          shape: 'ROUND_RECTANGLE',
          fill: null,
          line: { color: t.muted, weight: 1, dash: true },
        }
      )
    );
  });
  return mktgPrintContentPage(look, 'Partnership lockup', head(ctx, 'logo'), els);
}

function watchoutsPage(ctx: MktgPrintBrandKitContext): MktgPrintPage {
  const { look, view, projectName } = ctx;
  const els: MktgPrintPageEl[] = [
    mktgPrintProseColumn(look, [
      ...mktgPrintProseParas([
        `Consistency is what makes the mark recognizable. When in doubt: full color on white, or reversed on ${view.darkName}, with X of clear space.`,
      ]),
      ...mktgPrintBulletParas(view.logo.watchouts, 10.5, 8),
    ]),
  ];
  const w = (RIGHT.w - 24) / 3;
  const h = 100;
  const captionH = 40;
  const primary = has(ctx, 'primary');
  let k = 0;
  view.logo.watchouts.slice(0, 6).forEach((label, i) => {
    const x = RIGHT.x + (k % 3) * (w + 12);
    const y = RIGHT.y + Math.floor(k / 3) * (h + 33);
    const box = { x, y, w, h };
    const inner = { x: x + w * 0.2, y: y + h * 0.3, w: w * 0.6, h: h * 0.4 };
    let art: MktgPrintPageEl[] = [];
    if (i === 5) {
      art = [
        mktgPrintTextEl(
          { x: x + 6, y: y + 20, w: w - 12, h: h - 40 },
          mktgPrintRich(look, [mktgPrintPara(projectName, 13, { weight: 700, font: MKTG_PRINT_BRAND_KIT_RETYPED_FONT })], { align: 'CENTER', anchor: 'MIDDLE' })
        ),
      ];
    } else if (primary && i === 0) art = logoEl(ctx, 'primary', { x: x + w * 0.3, y: inner.y, w: w * 0.4, h: inner.h }, 'scaleX(1.45)');
    else if (primary && i === 2) art = logoEl(ctx, 'primary', inner, 'rotate(-14deg)');
    if (!art.length) return;
    k++;
    els.push(tile(ctx, box, WHITE), ...art);
    els.push(caption(ctx, { x, y: y + h + 2, w, h: captionH }, label));
    els.push(
      mktgPrintTextEl(
        { x: x + w - 28, y: y + 1, w: 28, h: 28 },
        mktgPrintRich(look, [mktgPrintPara('✕', 11, { color: look.accent, weight: 700 })], { align: 'CENTER' })
      )
    );
  });
  return mktgPrintContentPage(look, 'Watchouts', head(ctx, 'logo'), els);
}

function palettePage(ctx: MktgPrintBrandKitContext): MktgPrintPage {
  const { look, view } = ctx;
  const els: MktgPrintPageEl[] = [mktgPrintProseColumn(look, mktgPrintProseParas([mktgPrintWithoutSourceSentences(view.color.summary)]))];
  const palette = view.color.palette.slice(0, 6);
  const n = Math.max(1, palette.length);
  const w = (RIGHT.w - (n - 1) * 10) / n;
  palette.forEach((c, i) => {
    const x = RIGHT.x + i * (w + 10);
    els.push(
      mktgPrintTextEl(
        { x, y: 91, w, h: 92 },
        mktgPrintRich(look, [mktgPrintPara(c.name, 9, { weight: 600, color: inkOn(c.hex, look.dark) })], { anchor: 'BOTTOM' }),
        {
          shape: 'ROUND_RECTANGLE',
          fill: c.hex,
          line: isLightGround(c.hex) ? { color: look.rule, weight: 0.75 } : null,
        }
      )
    );
    const sourceLine = MKTG_PRINT_BRAND_KIT_SOURCE_LINES[c.found_in.kind];
    const source = sourceLine ? [mktgPrintPara(sourceLine, MKTG_PRINT_PAGE_SIZE.caption, { above: 3, color: look.muted })] : [];
    els.push(
      mktgPrintTextEl(
        { x, y: 187, w, h: 96 },
        mktgPrintRich(look, [
          mktgPrintPara(`HEX ${c.hex}`, 8.5, { weight: 600 }),
          mktgPrintPara(`RGB ${c.rgb.join(' ')}`, 8.5, { above: 1 }),
          mktgPrintPara(c.role, 8, { above: 3, color: look.muted }),
          ...source,
        ])
      )
    );
  });
  els.push(eyebrowEl(ctx, { x: RIGHT.x, y: 284, w: RIGHT.w, h: 24 }, 'Proportion'));
  let px = RIGHT.x;
  const total = view.color.proportion.reduce((a, r) => a + r.share, 0) || 100;
  for (const r of view.color.proportion) {
    const pw = (RIGHT.w * r.share) / total;
    if (pw > 0) els.push(mktgPrintShapeEl('RECTANGLE', { x: px, y: 308, w: pw, h: 16 }, r.hex));
    px += pw;
  }
  els.push(mktgPrintShapeEl('RECTANGLE', { x: RIGHT.x, y: 308, w: RIGHT.w, h: 16 }, null, { color: look.rule, weight: 0.75 }));
  els.push(
    mktgPrintTextEl(
      { x: RIGHT.x, y: 326, w: RIGHT.w, h: 30 },
      mktgPrintRich(look, [
        mktgPrintPara(view.color.proportion.map((r) => `${r.name} ${r.share}%`).join('     '), MKTG_PRINT_PAGE_SIZE.caption, { color: look.muted }),
      ])
    )
  );
  return mktgPrintContentPage(look, 'Color palette', head(ctx, 'color'), els);
}

function contrastPages(ctx: MktgPrintBrandKitContext): MktgPrintPage[] {
  const { look, view } = ctx;
  const hexOf = new Map(view.color.palette.map((p) => [p.name, p.hex]));
  // A kit with no pairs still gets its one page, the rule alone, so the contents' row for it points at a page (the deck's
  // paginate yields no slide for an empty list and its contents still list one: a departure, named).
  const paginated = mktgPrintPaginate(view.color.contrast.pairs, (rows) => rows.length <= MKTG_PRINT_BRAND_KIT_CONTRAST_ROWS_PER_PAGE);
  const pages = paginated.length ? paginated : [[]];
  return pages.map((rows, pi) => {
    const els: MktgPrintPageEl[] = [mktgPrintProseColumn(look, mktgPrintProseParas([view.color.contrast.rule]))];
    rows.forEach((r, j) => {
      const y = 91 + j * 24;
      const mid = y + 12;
      const passes = r.grade === 'AAA' || r.grade === 'AA';
      const fg = hexOf.get(r.foreground) ?? look.dark;
      const bg = hexOf.get(r.background) ?? WHITE;
      els.push(mktgPrintShapeEl('ROUND_RECTANGLE', { x: RIGHT.x, y: y + 3, w: 36, h: 18 }, bg, { color: look.rule, weight: 0.75 }));
      els.push(
        mktgPrintTextEl(
          { x: RIGHT.x - 4, y: mid - 15, w: 44, h: 30 },
          mktgPrintRich(look, [mktgPrintPara('Aa', 10, { weight: 700, color: fg })], { align: 'CENTER', anchor: 'MIDDLE' })
        )
      );
      els.push(
        mktgPrintTextEl(
          { x: RIGHT.x + 44, y: mid - 15, w: 230, h: 30 },
          mktgPrintRich(look, [mktgPrintPara(`${r.foreground} on ${r.background}`, 10)], { anchor: 'MIDDLE' })
        )
      );
      els.push(
        mktgPrintTextEl(
          { x: RIGHT.x + 274, y: mid - 15, w: 70, h: 30 },
          mktgPrintRich(look, [mktgPrintPara(`${r.ratio.toFixed(1)}:1`, 10)], { anchor: 'MIDDLE', align: 'END' })
        )
      );
      els.push(
        mktgPrintTextEl(
          { x: RIGHT.x + 344, y: mid - 15, w: 105, h: 30 },
          mktgPrintRich(look, [mktgPrintPara(r.grade, 9, { weight: passes ? 600 : 400, color: passes ? look.ink : look.muted })], {
            anchor: 'MIDDLE',
            align: 'END',
          })
        )
      );
      els.push(mktgPrintHairline(look, RIGHT.x, y + 24, RIGHT.w));
    });
    return mktgPrintContentPage(look, mktgPrintContinued('Color contrast', pi), head(ctx, 'color'), els);
  });
}

function typographyPage(ctx: MktgPrintBrandKitContext): MktgPrintPage {
  const { look, view, brand } = ctx;
  const type = view.type;
  const family = type.family || brand.fontFamily || '';
  const left = [...mktgPrintProseParas([mktgPrintWithoutNote(type.summary, type.note)]), ...mktgPrintBulletParas(type.rules, 10.5, 8)];
  const els: MktgPrintPageEl[] = [mktgPrintProseColumn(look, left)];
  const font = view.fontStack;
  els.push(mktgPrintTextEl({ x: RIGHT.x, y: 84, w: RIGHT.w, h: 52 }, { ...mktgPrintRich(look, [mktgPrintPara(family, 30, { weight: 500 })]), font }));
  els.push(
    mktgPrintTextEl(
      { x: RIGHT.x, y: 134, w: RIGHT.w, h: 26 },
      { ...mktgPrintRich(look, [mktgPrintPara(mktgPrintOneLine(BRAND_KIT_TYPE_SPECIMEN, RIGHT.w, 9.5), 9.5)]), font }
    )
  );
  // The view's weights (the kit's, unique and sorted, or the shared defaults), the first six, each with its label.
  view.weights.slice(0, 6).forEach((wgt, i) => {
    const x = RIGHT.x + i * 74;
    els.push(mktgPrintTextEl({ x, y: 157, w: 72, h: 40 }, { ...mktgPrintRich(look, [mktgPrintPara('Aa', 20, { weight: wgt.weight })]), font }));
    els.push(mktgPrintTextEl({ x, y: 192, w: 74, h: 24 }, mktgPrintRich(look, [mktgPrintPara(wgt.label, 7.5, { color: look.muted })])));
  });
  const scale = type.scale.slice(0, 6);
  if (scale.length) {
    const top = 222;
    const rowH = (356 - top) / scale.length;
    const sample = view.voice.line || family;
    scale.forEach((st, i) => {
      const y = top + i * rowH;
      const mid = y + rowH / 2;
      const size = Math.min(15, Math.max(7, Math.round(st.size * 0.42 * 2) / 2), Math.floor(((rowH - 1) / 1.22) * 2) / 2);
      els.push(mktgPrintHairline(look, RIGHT.x, y, RIGHT.w));
      els.push(mktgPrintTextEl({ x: RIGHT.x, y: mid - 14, w: 84, h: 28 }, mktgPrintRich(look, [mktgPrintPara(st.label, 8.5)], { anchor: 'MIDDLE' })));
      els.push(
        mktgPrintTextEl(
          { x: RIGHT.x + 84, y: mid - 14, w: 96, h: 28 },
          mktgPrintRich(look, [mktgPrintPara(`${st.weight}${st.caps ? ' caps' : ''} · ${st.size}/${st.line_height}`, 8, { color: look.muted })], {
            anchor: 'MIDDLE',
          })
        )
      );
      const sh = size * 1.22 + 2 * MKTG_PRINT_PAGE_INSET + 1;
      els.push(
        mktgPrintTextEl(
          { x: RIGHT.x + 180, y: mid - sh / 2, w: RIGHT.w - 180, h: sh },
          {
            ...mktgPrintRich(
              look,
              [mktgPrintPara(mktgPrintOneLine(sample, RIGHT.w - 180, size, { weight: st.weight, caps: st.caps }), size, { weight: st.weight, caps: st.caps })],
              { anchor: 'MIDDLE' }
            ),
            font,
          }
        )
      );
    });
  }
  return mktgPrintContentPage(look, 'Typography', head(ctx, 'type'), els);
}

function iconographyPage(ctx: MktgPrintBrandKitContext): MktgPrintPage {
  const { look, view } = ctx;
  const els: MktgPrintPageEl[] = [mktgPrintProseColumn(look, mktgPrintBulletParas(view.visual.icons.rules, 10.5))];
  // The upstream renderer's layout (book.js), as the deck draws it from the PNGs: eight labelled tiles, 4 × 2, each a
  // bordered rounded rectangle on white holding the icon over its label in the muted caption ink; then the strip on the
  // kit's dark with the eight icons in white, the third in the highlight; then the recommended set in the caption size.
  // Each icon is a slot the print fills with the shared icon sample (`lfx-mktg-brand-kit-icon`), in the kit's colours
  // (`view.iconColours`, the same three roles the web card and the portrait sheet take).
  const g = MKTG_PRINT_BRAND_KIT_ICON_GRID;
  const colours = view.iconColours;
  const w = (RIGHT.w - (g.cols - 1) * g.gap) / g.cols;
  const icon = (index: number, color: string, box: MktgPrintPageBox): MktgPrintPageEl => ({
    t: 'slot',
    slot: MKTG_PRINT_BRAND_KIT_ICON_SLOT,
    box,
    context: { index, color },
  });
  BRAND_KIT_ICON_SAMPLES.forEach((sample, i) => {
    const x = RIGHT.x + (i % g.cols) * (w + g.gap);
    const y = RIGHT.y + Math.floor(i / g.cols) * (g.tileH + g.gap);
    els.push(tile(ctx, { x, y, w, h: g.tileH }, WHITE));
    els.push(icon(i, colours.tileInk, { x: x + (w - g.icon) / 2, y: y + 12, w: g.icon, h: g.icon }));
    els.push(caption(ctx, { x, y: y + 12 + g.icon + 1, w, h: g.labelH }, sample.label, 'CENTER'));
  });
  const stripY = RIGHT.y + 2 * g.tileH + g.gap + g.stripGap;
  els.push(mktgPrintShapeEl('ROUND_RECTANGLE', { x: RIGHT.x, y: stripY, w: RIGHT.w, h: g.stripH }, colours.stripGround));
  BRAND_KIT_ICON_SAMPLES.forEach((_, i) => {
    const box = { x: RIGHT.x + g.stripPad + i * g.stripStep, y: stripY + (g.stripH - g.stripIcon) / 2, w: g.stripIcon, h: g.stripIcon };
    els.push(icon(i, i === BRAND_KIT_ICON_HIGHLIGHT_INDEX ? colours.highlight : BRAND_KIT_ICON_STRIP_INK, box));
  });
  const captionY = stripY + g.stripH + g.captionGap;
  if (view.visual.icons.recommended)
    els.push(caption(ctx, { x: RIGHT.x, y: captionY, w: RIGHT.w, h: RIGHT.y + RIGHT.h - captionY }, `Recommended set: ${view.visual.icons.recommended}`));
  return mktgPrintContentPage(look, 'Iconography', head(ctx, 'visual'), els);
}

function imageryPage(ctx: MktgPrintBrandKitContext): MktgPrintPage {
  const { look, view } = ctx;
  const left = [
    ...mktgPrintProseParas([view.visual.imagery.rule]),
    ...(view.visual.imagery.avoid.length ? [mktgPrintEyebrowPara(look, 'Avoid', { above: 10 })] : []),
    ...mktgPrintBulletParas(view.visual.imagery.avoid, 10.5, 4),
  ];
  const line = view.voice.line || ctx.projectName;
  const x2 = RIGHT.x + 233;
  const els: MktgPrintPageEl[] = [
    mktgPrintProseColumn(look, left),
    mktgPrintTextEl(
      { x: RIGHT.x, y: 91, w: RIGHT.w, h: 150 },
      mktgPrintRich(
        look,
        [mktgPrintEyebrowPara(look, '— Eyebrow', { color: look.onDark }), mktgPrintPara(line, 18, { weight: 500, color: look.onDark, above: 4 })],
        { anchor: 'BOTTOM' }
      ),
      { shape: 'ROUND_RECTANGLE', fill: look.dark, line: null }
    ),
    eyebrowEl(ctx, { x: RIGHT.x, y: 247, w: 216, h: 24 }, 'Buttons'),
    mktgPrintTextEl(
      { x: RIGHT.x, y: 272, w: 124, h: 28 },
      mktgPrintRich(look, [mktgPrintPara('Primary button', 10, { weight: 500, color: look.onDark })], { align: 'CENTER', anchor: 'MIDDLE' }),
      {
        shape: 'ROUND_RECTANGLE',
        fill: look.dark,
        line: null,
      }
    ),
    mktgPrintTextEl(
      { x: RIGHT.x, y: 308, w: 104, h: 28 },
      mktgPrintRich(look, [mktgPrintPara('Secondary', 10, { weight: 500 })], { align: 'CENTER', anchor: 'MIDDLE' }),
      {
        shape: 'ROUND_RECTANGLE',
        fill: WHITE,
        line: { color: look.dark, weight: 1 },
      }
    ),
    eyebrowEl(ctx, { x: x2, y: 247, w: 216, h: 24 }, 'Call-out card'),
    mktgPrintShapeEl('ROUND_RECTANGLE', { x: x2, y: 272, w: 216, h: 64 }, look.tint),
    mktgPrintShapeEl('RECTANGLE', { x: x2, y: 272, w: 4, h: 64 }, look.accent),
    mktgPrintTextEl(
      { x: x2 + 8, y: 272, w: 206, h: 64 },
      mktgPrintRich(look, [mktgPrintPara('One per view, for the main call to action.', 10)], { anchor: 'MIDDLE' })
    ),
  ];
  return mktgPrintContentPage(look, 'Imagery & graphic elements', head(ctx, 'visual'), els);
}

/** The ground a usage example sits on: the kit's `ground` word — white or light → white, accent → the accent, anything else → the dark. */
export function mktgPrintBrandKitUsageGround(look: MktgPrintPageLook, ground: string): string {
  if (/white|light/i.test(ground)) return WHITE;
  if (/accent/i.test(ground)) return look.accent;
  return look.dark;
}

/** The host as the Social card's pill: a small rounded rectangle in the kit's dark with the host in the ink that reads on it, as wide as the host needs (capped at `maxW`). */
function hostPill(look: MktgPrintPageLook, host: string, x: number, y: number, maxW: number): MktgPrintPageEl {
  const w = Math.min(maxW, Math.ceil(host.length * MKTG_PRINT_PAGE_SIZE.caption * mktgPrintCharEm({ weight: 600 }) + 2 * MKTG_PRINT_PAGE_INSET));
  return mktgPrintTextEl(
    { x, y, w, h: MKTG_PRINT_BRAND_KIT_PILL.h },
    mktgPrintRich(look, [mktgPrintPara(host, MKTG_PRINT_PAGE_SIZE.caption, { weight: 600, color: look.onDark })], { align: 'CENTER', anchor: 'MIDDLE' }),
    {
      shape: 'ROUND_RECTANGLE',
      fill: look.dark,
      line: null,
    }
  );
}

function usagePage(ctx: MktgPrintBrandKitContext): MktgPrintPage {
  const { look, view, projectName } = ctx;
  const els: MktgPrintPageEl[] = [mktgPrintProseColumn(look, mktgPrintProseParas([view.usage.summary]))];
  const layouts = ['keynote', 'social', 'report', 'announcement'];
  const w = (RIGHT.w - 16) / 2;
  const h = 106;
  const line = view.voice.line || projectName;
  const host = view.host;
  const inkOnAccent = brandKitInkOnAccent(look.accent, look.dark);
  view.usage.examples.slice(0, 4).forEach((ex, i) => {
    const x = RIGHT.x + (i % 2) * (w + 16);
    const y = RIGHT.y + Math.floor(i / 2) * (h + 30);
    const fill = mktgPrintBrandKitUsageGround(look, ex.ground);
    const white = fill === WHITE;
    const onAccent = /accent/i.test(ex.ground) && !white;
    const ink = usageInk(look, white, onAccent, inkOnAccent);
    const soft = white ? look.muted : ink;
    let paras: MktgPrintPara[];
    let bar = false;
    let pill = false;
    switch (layouts[i]) {
      case 'social':
        pill = host !== '';
        paras = [mktgPrintPara(line, 13, { weight: 500, color: ink })];
        break;
      case 'report':
        paras = [
          mktgPrintEyebrowPara(look, '— Report', { color: soft }),
          mktgPrintPara(`${projectName} annual report · [year]`, 13, { weight: 500, color: ink, above: 4 }),
        ];
        break;
      case 'announcement':
        bar = true;
        paras = [mktgPrintPara(`[Partner] joins ${projectName}`, 13, { weight: 500, color: ink })];
        break;
      default:
        bar = true;
        paras = [mktgPrintPara(line, 13, { weight: 500, color: ink })];
    }
    const outline = white ? { color: look.rule, weight: 0.75 } : null;
    if (pill) {
      els.push(mktgPrintShapeEl('ROUND_RECTANGLE', { x, y, w, h }, fill, outline));
      els.push(
        mktgPrintTextEl({ x, y, w, h: h - MKTG_PRINT_BRAND_KIT_PILL.h - MKTG_PRINT_BRAND_KIT_PILL.inset - 4 }, mktgPrintRich(look, paras, { anchor: 'BOTTOM' }))
      );
      els.push(
        hostPill(
          look,
          host,
          x + MKTG_PRINT_BRAND_KIT_PILL.inset,
          y + h - MKTG_PRINT_BRAND_KIT_PILL.inset - MKTG_PRINT_BRAND_KIT_PILL.h,
          w - 2 * MKTG_PRINT_BRAND_KIT_PILL.inset
        )
      );
    } else {
      els.push(mktgPrintTextEl({ x, y, w, h }, mktgPrintRich(look, paras, { anchor: 'BOTTOM' }), { shape: 'ROUND_RECTANGLE', fill, line: outline }));
    }
    if (bar) els.push(mktgPrintShapeEl('RECTANGLE', { x: x + 12, y: y + 14, w: 30, h: 3 }, onAccent ? inkOnAccent : look.accent));
    els.push(caption(ctx, { x, y: y + h + 2, w, h: 26 }, `${ex.name} · ${ex.format}`));
  });
  return mktgPrintContentPage(look, 'Example usage', head(ctx, 'usage'), els);
}

function attributeRich(ctx: MktgPrintBrandKitContext, a: BrandKitVoiceAttribute, size: number): MktgPrintRich {
  return mktgPrintRich(ctx.look, [mktgPrintPara(a.name, size + 1, { weight: 600 }), mktgPrintPara(a.line, size, { above: 2 })]);
}

/** The voice attributes in a grid, `cols` to a row: the name, then how it shows in copy. */
function attributeEls(ctx: MktgPrintBrandKitContext, attrs: BrandKitVoiceAttribute[], box: MktgPrintPageBox, cols: number, size: number): MktgPrintPageEl[] {
  const rows = Math.ceil(attrs.length / cols);
  const cellH = rows ? (box.h - (rows - 1) * 8) / rows : 0;
  const w = (box.w - (cols - 1) * 12) / cols;
  return attrs.map((a, i) =>
    mktgPrintTextEl({ x: box.x + (i % cols) * (w + 12), y: box.y + Math.floor(i / cols) * (cellH + 8), w, h: cellH }, attributeRich(ctx, a, size))
  );
}

function voicePages(ctx: MktgPrintBrandKitContext): MktgPrintPage[] {
  const { look, view } = ctx;
  const v = view.voice;
  const left = mktgPrintProseColumn(look, [
    ...mktgPrintProseParas([v.note]),
    ...(v.source ? [mktgPrintPara(v.source, MKTG_PRINT_PAGE_SIZE.caption, { color: look.muted, above: 8 })] : []),
  ]);
  const els: MktgPrintPageEl[] = [left];
  const blocks = [
    ...(v.umbrella
      ? [{ rich: mktgPrintRich(look, [mktgPrintEyebrowPara(look, 'Umbrella message'), mktgPrintPara(v.umbrella, 14, { weight: 500, above: 4 })]) }]
      : []),
    ...(v.line
      ? [{ rich: mktgPrintRich(look, [mktgPrintEyebrowPara(look, 'Brand line'), mktgPrintPara(v.line, 14, { weight: 500, above: 4 })]), gap: 10 }]
      : []),
  ];
  let top = RIGHT.y;
  if (blocks.length) {
    const s = mktgPrintStack(blocks, RIGHT.x, RIGHT.y, RIGHT.w, 130);
    els.push(...s.els);
    els.push(mktgPrintHairline(look, RIGHT.x, s.bottom + 5, RIGHT.w));
    top = s.bottom + 12;
  }
  const attrs = v.attributes.slice(0, 4);
  const grid = { x: RIGHT.x, y: top, w: RIGHT.w, h: 356 - top };
  const fitsGrid = (g: { cols: number; size: number }) => {
    const rows = Math.ceil(attrs.length / g.cols);
    const cellH = rows ? (grid.h - (rows - 1) * 8) / rows : 0;
    const w = (grid.w - (g.cols - 1) * 12) / g.cols;
    return attrs.every((a) => mktgPrintFits(attributeRich(ctx, a, g.size), w, cellH));
  };
  const g = MKTG_PRINT_BRAND_KIT_ATTRIBUTE_GRIDS.find(fitsGrid);
  if (g || attrs.length === 0) {
    els.push(...attributeEls(ctx, attrs, grid, g?.cols ?? 2, g?.size ?? 9.5));
    return [mktgPrintContentPage(look, 'Voice in brief', head(ctx, 'voice'), els)];
  }
  return [
    mktgPrintContentPage(look, 'Voice in brief', head(ctx, 'voice'), els),
    mktgPrintContentPage(look, mktgPrintContinued('Voice in brief', 1), head(ctx, 'voice'), attributeEls(ctx, attrs, MKTG_PRINT_PAGE_AREA, 2, 11)),
  ];
}

/** The ink of an example's text: the look's on white, the accent's contrast-safe ink on the accent, the on-dark ink elsewhere. */
function usageInk(look: MktgPrintPageLook, white: boolean, onAccent: boolean, inkOnAccent: string): string {
  if (white) return look.ink;
  if (onAccent) return inkOnAccent;
  return look.onDark;
}

/** The content pages each book page id builds (the back cover is a page of its own, lfx-mktg-print-back-cover). */
const PAGE_BUILDERS: Record<string, (ctx: MktgPrintBrandKitContext) => MktgPrintPage[]> = {
  'logo-system': (c) => [logoSystemPage(c)],
  colorways: (c) => [colorwaysPage(c)],
  'clear-space': (c) => [clearSpacePage(c)],
  symbol: (c) => [symbolPage(c)],
  partnership: (c) => [partnershipPage(c)],
  watchouts: (c) => [watchoutsPage(c)],
  palette: (c) => [palettePage(c)],
  contrast: contrastPages,
  typography: (c) => [typographyPage(c)],
  iconography: (c) => [iconographyPage(c)],
  imagery: (c) => [imageryPage(c)],
  usage: (c) => [usagePage(c)],
  voice: voicePages,
};

/** The context the kit pages are built in. */
export function mktgPrintBrandKitContext(view: BrandKitBookView, brand: MktgPrintBrand, projectName: string): MktgPrintBrandKitContext {
  return { view, brand, look: mktgPrintPageLook(brand), projectName, logos: mktgPrintBrandKitLogos(view) };
}

/**
 * The kit book's content pages, in the deck's order, each with its footer
 * (the project's line left, its page number right), numbered by position in
 * the assembly with the cover counted: the cover is `firstPage`, the contents
 * `firstPage + 1`, the pages from `firstPage + 2`. The cover and the back
 * cover are not in the list: the document mounts them as pages of their own
 * (lfx-mktg-print-cover, lfx-mktg-print-back-cover) around these; the
 * contents list the back cover's row when it is included (kit-book.ts builds
 * the rows over every BOOK_PAGES id).
 */
export function buildBrandKitPrintPages(
  view: BrandKitBookView,
  brand: MktgPrintBrand,
  projectName: string,
  options: MktgPrintBrandKitOptions = {}
): MktgPrintPage[] {
  const first = options.firstPage ?? 1;
  const ctx = mktgPrintBrandKitContext(view, brand, projectName);
  const backCover = options.backCover !== false;
  const ids = BRAND_KIT_BOOK_PAGES.filter((p) => p.id !== 'back-cover' || backCover);
  const pages = ids.map((p) => ({ id: p.id, title: p.title, pages: PAGE_BUILDERS[p.id]?.(ctx) ?? [] }));
  const rows: Array<{ number: string; title: string }> = [];
  let n = first + 2;
  for (const p of pages) {
    rows.push({ number: String(n).padStart(2, '0'), title: p.title });
    n += p.pages.length;
  }
  const out: MktgPrintPage[] = [contentsPage(ctx, rows), ...pages.flatMap((p) => p.pages)];
  const line = mktgPrintFooterLine(projectName);
  return out.map((page, i) => mktgPrintWithFooter(page, line, first + 1 + i));
}

/** How many pages the kit book prints: the cover, the content pages (buildBrandKitPrintPages) and, when included, the back cover. */
export function mktgBrandKitBookPageCount(view: BrandKitBookView, brand: MktgPrintBrand, projectName: string, options: MktgPrintBrandKitOptions = {}): number {
  return 1 + buildBrandKitPrintPages(view, brand, projectName, options).length + (options.backCover === false ? 0 : 1);
}

/** The kit cover's lines, as the deck's cover sets them (kit-book.ts coverSlide): the subtitle, the eyebrow, the version and the footer's two lines. */
export function mktgPrintBrandKitCover(
  view: BrandKitBookView,
  projectName: string
): { title: string; subtitle: string; eyebrow: string; topRight: string; footerLeft: string; footerRight: string } {
  const line = mktgPrintTrimTrailing(view.voice.line, '.');
  return {
    title: 'Brand Kit',
    subtitle: `${line ? `${line}. ` : ''}Logos, color, type and usage on one reference, for members, partners and the press.`,
    eyebrow: `${projectName} · A Linux Foundation project`,
    topRight: view.versionLabel,
    footerLeft: mktgPrintFooterLine(projectName),
    footerRight: [view.host, view.versionLabel, view.monthYear].filter(Boolean).join(' · '),
  };
}
