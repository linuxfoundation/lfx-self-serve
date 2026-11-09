// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit book: the kit of one revision laid out as the reference kit's
// 16 letter pages (the Jupyter Foundation Brand Kit v1.0). Pure: the view
// model holds every string, colour and CSS value the pages bind, so the kit
// view's template binds properties only and the layout is unit-testable
// without a browser.

import {
  BRAND_KIT_BACK_COVER_NOTICE,
  BRAND_KIT_BOOK_PAGES,
  BRAND_KIT_CHAPTERS,
  BRAND_KIT_CONTRAST_AA,
  BRAND_KIT_CONTRAST_AAA,
  BRAND_KIT_CONTRAST_LARGE_TEXT,
  BRAND_KIT_LABEL_MIN_CONTRAST,
  BRAND_KIT_TYPE_SPECIMEN,
  BRAND_KIT_WEIGHT_NAMES,
} from '../constants/brand-kit.constants';
import { MKTG_PRINT_REVERSED_FILTER } from '../constants/mktg-print.constants';
import {
  BrandKitBookView,
  BrandKitChapters,
  BrandKitChapterSummary,
  BrandKitColorwayTile,
  BrandKitContrastGrade,
  BrandKitDerivable,
  BrandKitContrastView,
  BrandKitInkCandidate,
  BrandKitLogoImage,
  BrandKitLogoSlot,
  BrandKitPaletteCard,
  BrandKitPaletteEntry,
  BrandKitRevision,
  BrandKitTextInk,
  BrandKitTypeScaleView,
  BrandKitUsageView,
  BrandKitWatchoutView,
} from '../interfaces/brand-kit.interface';
import { BRAND_KIT_FOUND_IN_LABELS } from '../constants/brand-kit.constants';
import {
  brandKitBookPages,
  brandKitFontStack,
  brandKitForProject,
  brandKitGoogleFontsUrl,
  brandKitLogoFileName,
  brandKitLogoImage,
  brandKitMonthYear,
  brandKitPageNumber,
  brandKitSvgIsMonochrome,
  brandKitSymbolImage,
  brandKitWebsiteHost,
  brandKitWeights,
} from './brand-kit.utils';
import { brandKitIconColours } from './brand-kit-icons.utils';
import { mktgPortraitMeasure } from './mktg-measure.utils';

/** A letter page is 11 in wide: 1056 px at 96 dpi, which is what the type scale's px sizes are drawn against. */
const PAGE_WIDTH_PX = 1056;

/** WCAG relative luminance of a `#RRGGBB` colour. */
export function brandKitLuminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** True for a light colour — one that needs a border to stand off a white ground. */
export function brandKitIsLight(hex: string): boolean {
  return brandKitLuminance(hex) > 0.5;
}

/** WCAG contrast ratio of two relative luminances, lighter over darker. */
export function brandKitContrastRatio(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * The colour a swatch's name is set in, on the swatch: the kit's dark when
 * it reaches WCAG AA there, so the brand's own pairing shows wherever it is
 * legible; otherwise white or black, whichever contrasts more. A medium
 * colour (an orange) gets black: white, and often the dark, fall short.
 */
export function brandKitLabelInk(hex: string, dark: string): string {
  const ground = brandKitLuminance(hex);
  if (brandKitContrastRatio(ground, brandKitLuminance(dark)) >= BRAND_KIT_LABEL_MIN_CONTRAST) {
    return dark;
  }
  return brandKitContrastRatio(ground, 1) >= brandKitContrastRatio(ground, 0) ? 'white' : 'black';
}

/**
 * The text ink for a ground, from named candidates (white and the kit's
 * palette, say): the one with the highest WCAG contrast there, `readable`
 * when it reaches AA (4.5:1, normal text). One rule for every sample a book
 * sets on a colour, so a print never draws a pairing its own contrast table
 * grades as failing, and never claims one. The first of equal ratios wins,
 * so white, named first, is preferred where it reads as well.
 */
export function brandKitBestInkOn(ground: string, candidates: readonly BrandKitInkCandidate[]): BrandKitTextInk {
  const groundLuminance = brandKitLuminance(ground);
  let best: BrandKitTextInk = { name: 'Black', hex: '#000000', ratio: brandKitContrastRatio(groundLuminance, 0), readable: false };
  let found = false;
  for (const candidate of candidates) {
    const ratio = brandKitContrastRatio(groundLuminance, brandKitLuminance(candidate.hex));
    if (!found || ratio > best.ratio) {
      best = { ...candidate, ratio, readable: false };
      found = true;
    }
  }
  return { ...best, readable: best.ratio >= BRAND_KIT_LABEL_MIN_CONTRAST };
}

/**
 * The ink of text set on the kit's accent, as the upstream Brand Kit renderer
 * and the deck ink their Social card: white only when it reaches WCAG AA on
 * the accent (4.5:1, normal text), else the kit's dark. One rule for every
 * sample on the accent, so a print never draws a pairing its own contrast
 * table grades as failing (a coral `#FF702D` against white: 2.8:1).
 */
export function brandKitInkOnAccent(accent: string, dark: string): string {
  return brandKitContrastRatio(brandKitLuminance(accent), 1) >= BRAND_KIT_LABEL_MIN_CONTRAST ? 'white' : dark;
}

/** A px size on the 11 in page in container-width units, so the page scales with its box and prints at size. */
export function brandKitPageUnits(px: number): string {
  return `${((px / PAGE_WIDTH_PX) * 100).toFixed(3)}cqw`;
}

/** The light tint ground of the book: the dark mixed faintly into white. */
export function brandKitTint(dark: string): string {
  return `color-mix(in srgb, ${dark} 6%, white)`;
}

/**
 * The four colorway tiles, in the contract's order: full colour on white,
 * reversed on the dark, full colour on the tint, one-colour black. The
 * reversed tile draws the supplied reversed artwork as it is; only without
 * one does it filter the primary lockup to white.
 */
export function brandKitColorwayTiles(
  kit: BrandKitRevision,
  tint: string,
  logos: Record<BrandKitLogoSlot, BrandKitLogoImage | null>,
  derivable: BrandKitDerivable = { lockup: true, symbol: true }
): BrandKitColorwayTile[] {
  const primary = logos.primary;
  // The full-colour tiles draw the primary file; a kit without one (its only lockup file the reversed one) says so.
  const fullColor = { logo: primary, logoFilter: '', missing: primary ? '' : BRAND_KIT_NOT_SUPPLIED };
  // A colorway the kit did not supply is derived from the primary only when that is one ink; else the tile says so.
  const derived = (filter: string) =>
    derivable.lockup ? { logo: primary, logoFilter: filter, missing: '' } : { logo: null, logoFilter: '', missing: BRAND_KIT_NOT_SUPPLIED };
  const reversed = logos.reversed ? { logo: logos.reversed, logoFilter: '', missing: '' } : derived(MKTG_PRINT_REVERSED_FILTER);
  // The symbol is never the supplied reversed lockup: it takes the tile's own filter when its own artwork is one ink.
  const symbolFilter = (filter: string) => (derivable.symbol ? filter : '');
  const grounds = [
    { ground: 'white', light: true, ...fullColor, symbolFilter: '' },
    { ground: kit.kit.dark, light: false, ...reversed, symbolFilter: symbolFilter(MKTG_PRINT_REVERSED_FILTER) },
    { ground: tint, light: true, ...fullColor, symbolFilter: '' },
    { ground: 'white', light: true, ...derived('brightness(0)'), symbolFilter: symbolFilter('brightness(0)') },
  ];
  return kit.chapters.logo.colorways.map((colorway, index) => ({ name: colorway.name, ...(grounds[index] ?? grounds[0]) }));
}

/**
 * Which slots the book may derive a reversed or one-colour mark from by
 * filter: the lockup from the primary file, the symbol from its own file or,
 * cropped, from the primary. Each only when that artwork is one resolvable
 * ink with no background (`brandKitSvgIsMonochrome`); a PNG never is.
 */
export function brandKitDerivable(files: BrandKitChapters['logo']['files']): BrandKitDerivable {
  const lockup = !!files.primary?.svg && brandKitSvgIsMonochrome(files.primary.svg);
  const symbol = files.symbol ? !!files.symbol.svg && brandKitSvgIsMonochrome(files.symbol.svg) : lockup;
  return { lockup, symbol };
}

/** The plain line of a logo slot the kit has no file for, in the files table and on a tile the book cannot derive. */
export const BRAND_KIT_NOT_SUPPLIED = 'Not supplied';

/** The six watchout tiles: the rule, the distortion each tile shows (`kind`) and the on-screen draw of it. */
export function brandKitWatchoutTiles(kit: BrandKitRevision): BrandKitWatchoutView[] {
  const draws: Omit<BrandKitWatchoutView, 'label'>[] = [
    { kind: 'stretched', transform: 'scaleX(1.45)', filter: '', ground: '', retyped: false },
    { kind: 'recolored', transform: '', filter: 'hue-rotate(140deg) saturate(1.6)', ground: '', retyped: false },
    { kind: 'rotated', transform: 'rotate(-14deg)', filter: '', ground: '', retyped: false },
    { kind: 'shadowed', transform: '', filter: 'drop-shadow(0.4cqw 0.4cqw 0.3cqw rgba(0, 0, 0, 0.55))', ground: '', retyped: false },
    { kind: 'busy', transform: '', filter: '', ground: `linear-gradient(135deg, ${kit.kit.accent}, ${kit.kit.dark} 55%, ${kit.kit.spark})`, retyped: false },
    { kind: 'retyped', transform: '', filter: '', ground: '', retyped: true },
  ];
  return kit.chapters.logo.watchouts.map((label, index) => ({ label, ...(draws[index] ?? draws[0]) }));
}

/**
 * Where a palette value was found, in words — never a raw URL: a logo file by
 * its name, a page or stylesheet by its site's host, anything else as the kit
 * gives it.
 */
export function brandKitFoundIn(foundIn: BrandKitPaletteEntry['found_in']): string {
  const label = BRAND_KIT_FOUND_IN_LABELS[foundIn.kind];
  if (foundIn.kind === 'page') {
    return label;
  }
  const source = foundIn.source.trim();
  let where = source;
  if (foundIn.kind === 'logo') {
    where = brandKitLogoFileName(source) ?? 'the logo you supplied';
  } else if (/^https?:\/\//i.test(source)) {
    where = brandKitWebsiteHost(source) || 'the site';
  }
  return where ? `${label} — ${where}` : label;
}

/** The palette cards, with where each value was found. */
export function brandKitPaletteCards(kit: BrandKitRevision): BrandKitPaletteCard[] {
  return kit.chapters.color.palette.map((entry) => ({
    name: entry.name,
    hex: entry.hex,
    hexDigits: entry.hex.slice(1),
    rgb: entry.rgb.join(' '),
    role: entry.role,
    source: brandKitFoundIn(entry.found_in),
    light: brandKitIsLight(entry.hex),
    ink: brandKitLabelInk(entry.hex, kit.kit.dark),
  }));
}

/**
 * A contrast ratio's label to one decimal, cut not rounded (`4.46` → `4.4`, `2.83` → `2.8`): WCAG 1.4.3 never rounds a
 * ratio up to a threshold, and the kit prints one rounding everywhere the ratio appears (the on-screen contrast table,
 * the book's pairs row and the portrait matrix).
 */
export function brandKitRatioLabel(ratio: number): string {
  return (Math.floor(ratio * 10 + 1e-9) / 10).toFixed(1);
}

/** The grade of an unrounded contrast ratio, in the kit's own words: AAA from 7, AA from 4.5, large text only from 3, else a fail. */
export function brandKitContrastGradeOf(ratio: number): BrandKitContrastGrade {
  if (ratio >= BRAND_KIT_CONTRAST_AAA) return 'AAA';
  if (ratio >= BRAND_KIT_CONTRAST_AA) return 'AA';
  if (ratio >= BRAND_KIT_CONTRAST_LARGE_TEXT) return 'Large text only';
  return 'Fails';
}

/**
 * The contrast table with the colours to draw each sample. A pair of two
 * palette colours takes its ratio and grade from the hex values, unrounded,
 * as the book's matrix does (one source: the matrix once read Mid gray on
 * White 4.5 where the record's pair said 4.6); a pair naming a colour the
 * palette does not hold keeps the record's ratio and grade.
 */
export function brandKitContrastRows(kit: BrandKitRevision): BrandKitContrastView[] {
  const hexByName = new Map(kit.chapters.color.palette.map((entry) => [entry.name, entry.hex]));
  return kit.chapters.color.contrast.pairs.map((pair) => {
    const foregroundHex = hexByName.get(pair.foreground);
    const backgroundHex = hexByName.get(pair.background);
    const measured = foregroundHex && backgroundHex ? brandKitContrastRatio(brandKitLuminance(backgroundHex), brandKitLuminance(foregroundHex)) : null;
    const grade = measured === null ? pair.grade : brandKitContrastGradeOf(measured);
    return {
      foreground: pair.foreground,
      background: pair.background,
      foregroundHex: foregroundHex ?? kit.kit.dark,
      backgroundHex: backgroundHex ?? 'white',
      ratio: `${brandKitRatioLabel(measured ?? pair.ratio)}:1`,
      grade,
      passes: grade === 'AAA' || grade === 'AA',
    };
  });
}

/** The type scale rows with the CSS that draws them: sizes in page units, the line height as a ratio. */
export function brandKitTypeScaleRows(kit: BrandKitRevision, sample: string): BrandKitTypeScaleView[] {
  return kit.chapters.type.scale.map((step) => ({
    label: step.label,
    spec: `${step.weight}${step.caps ? ' caps' : ''} · ${step.size}/${step.line_height}`,
    sample: step.step === 'body' ? kit.chapters.voice.umbrella : sample,
    fontWeight: step.weight,
    fontSize: brandKitPageUnits(step.size),
    lineHeight: step.size > 0 ? (step.line_height / step.size).toFixed(2) : '1.2',
    textTransform: step.caps ? 'uppercase' : 'none',
    letterSpacing: step.caps ? '0.16em' : '0',
  }));
}

/** The four usage tiles, in the contract's order: keynote slide, social card, report cover, announcement header. */
export function brandKitUsageTiles(kit: BrandKitRevision): BrandKitUsageView[] {
  const layouts: BrandKitUsageView['layout'][] = ['keynote', 'social', 'report', 'announcement'];
  return kit.chapters.usage.examples.map((example, index) => ({
    layout: layouts[index] ?? 'keynote',
    caption: `${example.name} · ${example.format}`,
    dark: !/white|light/i.test(example.ground),
  }));
}

/** Items in words: `a`, `a and b`, `a, b and c`. */
export function brandKitInWords(items: readonly string[]): string {
  return inWords([...items]);
}

/** The items joined for reading, the last with "and" (an empty list is ''). */
function inWords(items: string[]): string {
  if (items.length <= 1) {
    return items.join('');
  }
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The logo artwork the kit was built from, in words: the files by their own
 * names, and the ones whose name is an opaque hash (a CDN upload) counted as
 * the logo files you supplied. Never a URL — a raw URL is one unbroken token
 * that runs across the page.
 */
export function brandKitArtworkInWords(kit: BrandKitRevision): string {
  const refs = [
    ...new Set(
      Object.values(kit.chapters.logo.files)
        .filter((file): file is NonNullable<typeof file> => file !== null)
        .map((file) => file.ref)
    ),
  ];
  if (refs.length === 0) {
    return 'placeholder marks (no logo files yet)';
  }
  const names = [...new Set(refs.map(brandKitLogoFileName).filter((name): name is string => name !== null))];
  const unnamed = refs.filter((ref) => brandKitLogoFileName(ref) === null).length;
  if (names.length === 0) {
    return unnamed === 1 ? 'the logo you supplied' : `the ${unnamed} logo files you supplied`;
  }
  const lead = names.length === 1 && unnamed === 0 ? 'the logo file' : 'the logo files';
  const rest = [...names];
  if (unnamed === 1) {
    rest.push('one more logo file you supplied');
  } else if (unnamed > 1) {
    rest.push(`${unnamed} more logo files you supplied`);
  }
  return `${lead} ${inWords(rest)}`;
}

/** The contents page's note on what the kit was built from (the web view's overview says the same). */
export function brandKitBuiltFrom(kit: BrandKitRevision): string {
  // The voice always comes from the project's messaging framework — the run
  // never starts without one, so there is no site-derived stand-in.
  return `Built from ${brandKitArtworkInWords(kit)}, the messaging framework and the brand colors found in the logo artwork. For the full voice, persona and messaging rules, see the messaging framework.`;
}

/** The six chapters as the web view's overview summarises them, each with the tab that opens it. */
export function brandKitChapterSummaries(kit: BrandKitRevision): BrandKitChapterSummary[] {
  const summaries: Record<(typeof BRAND_KIT_CHAPTERS)[number]['id'], string> = {
    logo: kit.chapters.logo.system,
    color: kit.chapters.color.summary,
    type: kit.chapters.type.summary,
    visual: kit.chapters.visual.imagery.rule,
    usage: kit.chapters.usage.summary,
    voice: kit.chapters.voice.umbrella,
  };
  return BRAND_KIT_CHAPTERS.map((chapter) => ({ id: chapter.id, number: chapter.number, title: chapter.title, summary: summaries[chapter.id] }));
}

/**
 * The whole book, computed once from the kit. `version` is the number the
 * page around the book shows — the Documents revision, or the run's version —
 * so the printed cover says what the screen says; the kit's own draft
 * version when none is given.
 */
export function buildBrandKitBookView(kit: BrandKitRevision, version?: number | null): BrandKitBookView {
  const { dark, accent } = kit.kit;
  const tint = brandKitTint(dark);
  const lightGray = kit.chapters.color.palette.find((entry) => /light/i.test(entry.name) && brandKitIsLight(entry.hex))?.hex ?? tint;
  const darkName = kit.chapters.color.palette.find((entry) => entry.hex === dark)?.name ?? 'the dark';
  const accentName = kit.chapters.color.palette.find((entry) => entry.hex === accent)?.name ?? 'the accent';
  const weights = brandKitWeights(kit.chapters.type.weights);
  const logos = Object.fromEntries(
    (Object.keys(kit.chapters.logo.files) as BrandKitLogoSlot[]).map((slot) => [slot, brandKitLogoImage(kit.chapters.logo.files[slot])])
  ) as BrandKitBookView['logos'];
  const monthYear = brandKitMonthYear(kit.generatedAt);
  const derivable = brandKitDerivable(kit.chapters.logo.files);
  return {
    projectName: kit.projectName,
    projectCaps: kit.projectName.toUpperCase(),
    host: brandKitWebsiteHost(kit.websiteUrl),
    versionLabel: `V${version ?? kit.version}.0`,
    monthYear,
    runningHead: `${kit.projectName} Brand Kit`,
    footer: `${kit.projectName} · a Linux Foundation project`,
    dark,
    accent,
    spark: kit.kit.spark,
    tint,
    lightGray,
    darkName,
    accentName,
    fontStack: brandKitFontStack(kit.chapters.type.family, kit.chapters.type.fallback),
    fontUrl: brandKitGoogleFontsUrl(kit.chapters.type.family, weights, kit.chapters.type.google_fonts),
    pages: brandKitBookPages(),
    contents: BRAND_KIT_BOOK_PAGES.map((page, index) => ({ number: brandKitPageNumber(index + 3), title: page.title })),
    builtFrom: brandKitBuiltFrom(kit),
    logos,
    symbol: brandKitSymbolImage(kit.chapters.logo.files, kit.chapters.logo.symbol_viewbox),
    derivable,
    placeholder: kit.chapters.logo.placeholder,
    logo: kit.chapters.logo,
    colorways: brandKitColorwayTiles(kit, tint, logos, derivable),
    minimumSizes: [48, 40, kit.chapters.logo.minimum_size.screen_px].map((px) => ({ label: mktgPortraitMeasure(px, 'px'), px })),
    watchouts: brandKitWatchoutTiles(kit),
    color: kit.chapters.color,
    palette: brandKitPaletteCards(kit),
    proportion: kit.chapters.color.proportion,
    contrast: brandKitContrastRows(kit),
    type: kit.chapters.type,
    weights: weights.map((weight) => ({ weight, label: `${BRAND_KIT_WEIGHT_NAMES[weight] ?? 'Weight'} ${weight}` })),
    scale: brandKitTypeScaleRows(kit, kit.chapters.voice.line),
    specimen: BRAND_KIT_TYPE_SPECIMEN,
    visual: kit.chapters.visual,
    iconColours: brandKitIconColours(kit),
    usage: kit.chapters.usage,
    usageTiles: brandKitUsageTiles(kit),
    voice: kit.chapters.voice,
    backCoverNotice: brandKitForProject(BRAND_KIT_BACK_COVER_NOTICE, kit.projectName),
    report: kit.report,
  };
}
