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
  BRAND_KIT_ICON_SAMPLES,
  BRAND_KIT_TYPE_SPECIMEN,
  BRAND_KIT_WEIGHT_NAMES,
} from '../constants/brand-kit.constants';
import {
  BrandKitBookView,
  BrandKitColorwayTile,
  BrandKitContrastView,
  BrandKitLogoSlot,
  BrandKitPaletteCard,
  BrandKitRevision,
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
  brandKitLogoImage,
  brandKitMonthYear,
  brandKitPageNumber,
  brandKitSymbolImage,
  brandKitWebsiteHost,
  brandKitWeights,
} from './brand-kit.utils';

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

/** True for a light colour — one whose label has to be dark. */
export function brandKitIsLight(hex: string): boolean {
  return brandKitLuminance(hex) > 0.5;
}

/** A px size on the 11 in page in container-width units, so the page scales with its box and prints at size. */
export function brandKitPageUnits(px: number): string {
  return `${((px / PAGE_WIDTH_PX) * 100).toFixed(3)}cqw`;
}

/** The light tint ground of the book: the dark mixed faintly into white. */
export function brandKitTint(dark: string): string {
  return `color-mix(in srgb, ${dark} 6%, white)`;
}

/** The four colorway tiles, in the contract's order: full colour on white, reversed on the dark, full colour on the tint, one-colour black. */
export function brandKitColorwayTiles(kit: BrandKitRevision, tint: string): BrandKitColorwayTile[] {
  const grounds = [
    { ground: 'white', light: true, logoFilter: '' },
    { ground: kit.kit.dark, light: false, logoFilter: 'brightness(0) invert(1)' },
    { ground: tint, light: true, logoFilter: '' },
    { ground: 'white', light: true, logoFilter: 'brightness(0)' },
  ];
  return kit.chapters.logo.colorways.map((colorway, index) => ({ name: colorway.name, ...(grounds[index] ?? grounds[0]) }));
}

/** The six watchout tiles: the rule, and the distortion each tile draws to show it. */
export function brandKitWatchoutTiles(kit: BrandKitRevision): BrandKitWatchoutView[] {
  const draws = [
    { transform: 'scaleX(1.45)', filter: '', ground: '', retyped: false },
    { transform: '', filter: 'hue-rotate(140deg) saturate(1.6)', ground: '', retyped: false },
    { transform: 'rotate(-14deg)', filter: '', ground: '', retyped: false },
    { transform: '', filter: 'drop-shadow(0.4cqw 0.4cqw 0.3cqw rgba(0, 0, 0, 0.55))', ground: '', retyped: false },
    { transform: '', filter: '', ground: `linear-gradient(135deg, ${kit.kit.accent}, ${kit.kit.dark} 55%, ${kit.kit.spark})`, retyped: false },
    { transform: '', filter: '', ground: '', retyped: true },
  ];
  return kit.chapters.logo.watchouts.map((label, index) => ({ label, ...(draws[index] ?? draws[0]) }));
}

/** The palette cards, with where each value was found. */
export function brandKitPaletteCards(kit: BrandKitRevision): BrandKitPaletteCard[] {
  return kit.chapters.color.palette.map((entry) => ({
    name: entry.name,
    hex: entry.hex,
    rgb: entry.rgb.join(' '),
    role: entry.role,
    source: entry.found_in.kind === 'page' ? BRAND_KIT_FOUND_IN_LABELS.page : `${BRAND_KIT_FOUND_IN_LABELS[entry.found_in.kind]} — ${entry.found_in.source}`,
    light: brandKitIsLight(entry.hex),
  }));
}

/** The contrast table with the colours to draw each sample. */
export function brandKitContrastRows(kit: BrandKitRevision): BrandKitContrastView[] {
  const hexByName = new Map(kit.chapters.color.palette.map((entry) => [entry.name, entry.hex]));
  return kit.chapters.color.contrast.pairs.map((pair) => ({
    foreground: pair.foreground,
    background: pair.background,
    foregroundHex: hexByName.get(pair.foreground) ?? kit.kit.dark,
    backgroundHex: hexByName.get(pair.background) ?? 'white',
    ratio: `${pair.ratio.toFixed(1)}:1`,
    grade: pair.grade,
    passes: pair.grade === 'AAA' || pair.grade === 'AA',
  }));
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

/** The contents page's note on what the kit was built from. */
export function brandKitBuiltFrom(kit: BrandKitRevision): string {
  const files = Object.values(kit.chapters.logo.files)
    .filter((file): file is NonNullable<typeof file> => file !== null)
    .map((file) => file.ref);
  const artwork = files.length > 0 ? [...new Set(files)].join(', ') : 'placeholder marks (no logo files yet)';
  // The voice always comes from the project's messaging framework — the run
  // never starts without one, so there is no site-derived stand-in.
  return `Built from ${artwork}, the messaging framework and the brand colors found in the logo artwork. For the full voice, persona and messaging rules, see the messaging framework.`;
}

/** The whole book, computed once from the kit. */
export function buildBrandKitBookView(kit: BrandKitRevision): BrandKitBookView {
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
  return {
    projectName: kit.projectName,
    projectCaps: kit.projectName.toUpperCase(),
    host: brandKitWebsiteHost(kit.websiteUrl),
    versionLabel: `V${kit.version}.0`,
    monthYear,
    runningHead: `${kit.projectName} Brand Kit`,
    footer: `${kit.projectName} · a Linux Foundation project`,
    dark,
    accent,
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
    placeholder: kit.chapters.logo.placeholder,
    logo: kit.chapters.logo,
    colorways: brandKitColorwayTiles(kit, tint),
    minimumSizes: [
      { label: '48 px', px: 48 },
      { label: '40 px', px: 40 },
      { label: `${kit.chapters.logo.minimum_size.screen_px} px`, px: kit.chapters.logo.minimum_size.screen_px },
    ],
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
    icons: BRAND_KIT_ICON_SAMPLES.map((sample) => ({ label: sample.label, icon: sample.icon })),
    usage: kit.chapters.usage,
    usageTiles: brandKitUsageTiles(kit),
    voice: kit.chapters.voice,
    backCoverNotice: brandKitForProject(BRAND_KIT_BACK_COVER_NOTICE, kit.projectName),
    report: kit.report,
  };
}
