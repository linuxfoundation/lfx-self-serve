// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Download PDF for the Marketing OS asset views. Pure: the print's brand and
// the Messaging Framework's print view model are computed here, so the print
// templates bind properties only and the layout is unit-testable without a
// browser.

import { FOUNDATION_MESSAGE_VIEW_TABS } from '../constants/foundation-message.constants';
import {
  FOUNDATION_MESSAGE_PRINT_TAB_IDS,
  FOUNDATION_MESSAGE_PRINT_TITLE,
  MKTG_PRINT_BODY_INK_MIN_CONTRAST,
  MKTG_PRINT_INK_ON_DARK,
  MKTG_PRINT_INK_ON_LIGHT,
  MKTG_PRINT_LF_LOOK,
  MKTG_PRINT_REVERSED_FILTER,
} from '../constants/mktg-print.constants';
import type { BrandKitRevision } from '../interfaces/brand-kit.interface';
import type { FoundationMessageContent } from '../interfaces/foundation-message.interface';
import type {
  FoundationMessagePrintGoal,
  FoundationMessagePrintIcp,
  FoundationMessagePrintSection,
  FoundationMessagePrintView,
  MktgPrintBrand,
  MktgPrintLogo,
} from '../interfaces/mktg-print.interface';
import { brandKitContrastRatio, brandKitLuminance, brandKitTint } from './brand-kit-book.utils';
import { brandKitFontStack, brandKitGoogleFontsUrl, brandKitLogoImage, brandKitWeights } from './brand-kit.utils';
import {
  foundationMessageAudienceRows,
  foundationMessageAvoidRows,
  foundationMessageGoalViews,
  foundationMessageIcpViews,
  foundationMessageNumberRows,
  foundationMessagePillarViews,
} from './foundation-message.utils';

/** The LF look, for a project with no Brand Kit. */
function lfPrintBrand(): MktgPrintBrand {
  const look = MKTG_PRINT_LF_LOOK;
  return {
    source: 'lf',
    dark: look.dark,
    accent: look.accent,
    tint: look.tint,
    onDark: look.onDark,
    ink: look.dark,
    fontStack: look.fontStack,
    fontUrl: null,
    fontFamily: null,
    logoOnDark: { src: look.logoOnDark, alt: look.logoAlt, filter: '' },
    logoOnLight: { src: look.logoOnLight, alt: look.logoAlt, filter: '' },
  };
}

/** The ink, light or dark, with the higher contrast against a background colour. */
function betterInkOn(background: string): string {
  const ground = brandKitLuminance(background);
  const onLight = brandKitContrastRatio(ground, brandKitLuminance(MKTG_PRINT_INK_ON_LIGHT));
  const onDark = brandKitContrastRatio(ground, brandKitLuminance(MKTG_PRINT_INK_ON_DARK));
  return onLight >= onDark ? MKTG_PRINT_INK_ON_LIGHT : MKTG_PRINT_INK_ON_DARK;
}

/**
 * The brand a print is set in. With the project's Brand Kit: its dark and
 * accent, a tint of the dark, its typeface (from Google Fonts when the kit
 * says it is there), and its logo — on the dark cover the supplied reversed
 * artwork, else the primary lockup drawn white; on the white pages the
 * primary lockup. A logo with no drawable artwork (no SVG bytes, or the
 * kit's placeholder) is left out rather than drawn as a placeholder. The
 * white pages' body text is the dark only when it reaches WCAG AA on white:
 * a kit whose "dark" is light (`#F4F4F4`) would otherwise print its body
 * text near-invisible, so it takes the app's darkest gray there and keeps
 * its dark as the cover's ground. Without a kit: the LF look.
 */
export function mktgPrintBrand(kit: BrandKitRevision | null): MktgPrintBrand {
  if (!kit) {
    return lfPrintBrand();
  }
  const { dark, accent } = kit.kit;
  const type = kit.chapters.type;
  const fontUrl = brandKitGoogleFontsUrl(type.family, brandKitWeights(type.weights), type.google_fonts);
  const files = kit.chapters.logo.files;
  const alt = `${kit.projectName} logo`;
  const primary = kit.chapters.logo.placeholder ? null : brandKitLogoImage(files.primary);
  const reversed = kit.chapters.logo.placeholder ? null : brandKitLogoImage(files.reversed);
  let logoOnDark: MktgPrintLogo | null = null;
  if (reversed?.src) {
    logoOnDark = { src: reversed.src, alt, filter: '' };
  } else if (primary?.src) {
    logoOnDark = { src: primary.src, alt, filter: MKTG_PRINT_REVERSED_FILTER };
  }
  const darkIsHex = /^#[0-9a-f]{6}$/i.test(dark);
  // Text on the kit's dark panels takes whichever ink reads better against it:
  // a mid-grey "dark" can be too light for white text yet not light enough to count as light.
  const onDark = darkIsHex ? betterInkOn(dark) : MKTG_PRINT_INK_ON_DARK;
  const darkReadsOnWhite = !darkIsHex || brandKitContrastRatio(brandKitLuminance(dark), 1) >= MKTG_PRINT_BODY_INK_MIN_CONTRAST;
  return {
    source: 'kit',
    dark,
    accent,
    tint: brandKitTint(dark),
    onDark,
    ink: darkReadsOnWhite ? dark : MKTG_PRINT_INK_ON_LIGHT,
    fontStack: brandKitFontStack(type.family, type.fallback),
    fontUrl,
    fontFamily: fontUrl ? type.family.trim() : null,
    logoOnDark,
    logoOnLight: primary?.src ? { src: primary.src, alt, filter: '' } : null,
  };
}

/** The sections the framework print holds, numbered as the cover lists them. */
export function foundationMessagePrintSections(): FoundationMessagePrintSection[] {
  const printed: readonly string[] = FOUNDATION_MESSAGE_PRINT_TAB_IDS;
  return FOUNDATION_MESSAGE_VIEW_TABS.filter((tab) => printed.includes(tab.id)).map((tab, index) => ({
    id: tab.id,
    number: String(index + 1).padStart(2, '0'),
    title: tab.label,
  }));
}

/** The goal columns with their segments as one line, so the template joins nothing. */
export function foundationMessagePrintGoals(content: FoundationMessageContent): FoundationMessagePrintGoal[] {
  return foundationMessageGoalViews(content).map((goal) => ({ ...goal, segmentLabel: goal.segmentNames.join(', ') }));
}

/** The segments with their goals and channels as one line each, so the template joins nothing. */
export function foundationMessagePrintIcps(content: FoundationMessageContent): FoundationMessagePrintIcp[] {
  return foundationMessageIcpViews(content).map((icp) => ({
    ...icp,
    goalLabel: icp.goalTitles.join(', '),
    channelsLabel: icp.channels.join(' · '),
  }));
}

/**
 * The Messaging Framework as one printed document: a cover, then the
 * framework, the ICPs, the message house and the key numbers — the view's
 * tabs, less the run's report. `version` is the number the page shows (the
 * Documents revision, or the run's version), so the print says what the
 * screen says; `kit` is the project's stored Brand Kit, or null for the LF
 * look.
 */
export function buildFoundationMessagePrintView(
  content: FoundationMessageContent,
  projectName: string,
  version: number | null,
  kit: BrandKitRevision | null
): FoundationMessagePrintView {
  const name = projectName.trim();
  return {
    brand: mktgPrintBrand(kit),
    projectName: name,
    eyebrow: name ? `${name} · a Linux Foundation project` : 'A Linux Foundation project',
    title: FOUNDATION_MESSAGE_PRINT_TITLE,
    versionLabel: version === null ? '' : `Version ${version}`,
    runningHead: `${name} ${FOUNDATION_MESSAGE_PRINT_TITLE}`.trim(),
    sections: foundationMessagePrintSections(),
    mf: content.mf,
    mh: content.mh,
    goals: foundationMessagePrintGoals(content),
    icps: foundationMessagePrintIcps(content),
    pillars: foundationMessagePillarViews(content),
    avoidRows: foundationMessageAvoidRows(content),
    numbers: foundationMessageNumberRows(content),
    audiences: foundationMessageAudienceRows(content),
  };
}
