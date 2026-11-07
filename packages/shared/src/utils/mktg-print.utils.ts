// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Download PDF for the Marketing OS asset views. Pure: the print's brand and
// the Messaging Framework's print view model are computed here, so the print
// templates bind properties only and the layout is unit-testable without a
// browser.

import type { MktgBoilerplatesAsset, MktgFaqAsset } from '../interfaces/mktg-run.interface';
import type { BoilerplatesPrintView, FaqPrintView } from '../interfaces/mktg-print.interface';
import { boilerplatesLengthRows } from './boilerplates.utils';
import { faqGroupViews } from './faq.utils';
import { BRAND_KIT_HEX_REGEX } from '../constants/brand-kit.constants';
import { FOUNDATION_MESSAGE_VIEW_TABS } from '../constants/foundation-message.constants';
import {
  FOUNDATION_MESSAGE_PRINT_COUNT_WORDS,
  FOUNDATION_MESSAGE_PRINT_TAB_IDS,
  FOUNDATION_MESSAGE_PRINT_SOURCE_TYPES,
  FOUNDATION_MESSAGE_PRINT_TITLE,
  MKTG_PRINT_BODY_INK_MIN_CONTRAST,
  MKTG_PRINT_INK_ON_DARK,
  MKTG_PRINT_INK_ON_LIGHT,
  MKTG_PRINT_LF_LOOK,
  MKTG_PRINT_MONTHS,
} from '../constants/mktg-print.constants';
import type { BrandKitRevision } from '../interfaces/brand-kit.interface';
import type { FoundationMessageContent, FoundationMessageNumberRow, FoundationMessageReport } from '../interfaces/foundation-message.interface';
import type {
  FoundationMessagePrintFactRow,
  FoundationMessagePrintGoal,
  FoundationMessagePrintIcp,
  FoundationMessagePrintMatrixRow,
  FoundationMessagePrintNumber,
  FoundationMessagePrintSection,
  FoundationMessagePrintView,
  MktgPrintBrand,
  MktgPrintLogo,
} from '../interfaces/mktg-print.interface';
import { brandKitContrastRatio, brandKitLuminance, brandKitTint, buildBrandKitBookView } from './brand-kit-book.utils';
import { brandKitPortraitArtwork } from './brand-kit-portrait.utils';
import { brandKitFontStack, brandKitGoogleFontsUrl, brandKitWebsiteHost, brandKitWeights } from './brand-kit.utils';
import { frameworkPortraitIcpWhoWidth } from './mktg-framework-portrait-layout.utils';
import {
  foundationMessageAudienceRows,
  foundationMessageAvoidRows,
  foundationMessageGoalViews,
  foundationMessageIcpViews,
  foundationMessageNumberRows,
  foundationMessagePillarViews,
} from './foundation-message.utils';

/** Reuse the asset views' labels, order and unanswered/source policy. */
export function buildBoilerplatesPrintView(asset: MktgBoilerplatesAsset, brand: MktgPrintBrand): BoilerplatesPrintView {
  return { brand, lengths: boilerplatesLengthRows(asset) };
}

export function buildFaqPrintView(asset: MktgFaqAsset, brand: MktgPrintBrand): FaqPrintView {
  return { brand, groups: faqGroupViews(asset.content) };
}

/**
 * The title of a printed Marketing OS document, which the browser gives the
 * saved PDF as its file name: `<Project> · <Asset> · v<N> · <YYYY-MM-DD>`,
 * the shape of the deck's title (`mktgSlidesExportDeckTitle`), with the
 * revision the page shows and that revision's own date (UTC), never the
 * download's: the same version always yields the same file name. A part the
 * document lacks is left out: the version for the family PDF, which binds
 * several revisions; the date when the revision carries none.
 */
export function mktgPrintDocumentTitle(projectName: string, asset: string, version: number | null, revisionAt: string | null): string {
  const time = Date.parse(revisionAt ?? '');
  const date = Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10);
  const parts = [projectName.trim(), asset.trim(), version === null ? '' : `v${version}`, date];
  return parts.filter((part) => part !== '').join(' · ');
}

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

/** The ink, light or dark, with the higher contrast against a background color. */
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
/**
 * Whether a user agent string is a WebKit engine (Safari on macOS and every
 * browser on iOS and iPadOS, which all run WebKit; Playwright's webkit too):
 * `AppleWebKit/` present and none of the tokens the other engines add to
 * their WebKit-shaped strings (Blink's `Chrome/`, `HeadlessChrome/`, `Chromium/`,
 * `Edg/`, `OPR/`; Gecko's `Firefox/`). iOS Chrome (`CriOS/`), Firefox (`FxiOS/`) and Edge
 * (`EdgiOS/`) carry none of those tokens and are WebKit, which is the point:
 * the print engine, not the brand. A feature test cannot tell what a printed
 * page repeats, so the engine is read from the user agent (the documented
 * fallback for engine-specific layout bugs), once, at print time.
 */
export function mktgPrintIsWebKit(userAgent: string): boolean {
  return /AppleWebKit\//.test(userAgent) && !/(?:Chrome|Chromium|Edg|OPR|Firefox)\//.test(userAgent);
}

export function mktgPrintBrand(kit: BrandKitRevision | null): MktgPrintBrand {
  if (!kit) {
    return lfPrintBrand();
  }
  const { dark, accent } = kit.kit;
  const type = kit.chapters.type;
  const fontUrl = brandKitGoogleFontsUrl(type.family, brandKitWeights(type.weights), type.google_fonts);
  // The logo a print draws is the portrait grammar's lockup artwork (brandKitPortraitArtwork: the supplied reversed
  // file on a dark ground, else the primary filtered to white; the primary as it is on a light one; null when the kit
  // has no drawable file for it), named for the project; the kit's placeholder flag draws none.
  const alt = `${kit.projectName} logo`;
  const artwork = (mode: 'full' | 'reversed'): MktgPrintLogo | null => {
    const logo = kit.chapters.logo.placeholder ? null : brandKitPortraitArtwork(buildBrandKitBookView(kit), 'lockup', mode);
    return logo ? { ...logo, alt } : null;
  };
  const logoOnDark = artwork('reversed');
  const darkIsHex = BRAND_KIT_HEX_REGEX.test(dark);
  // Text on the kit's dark panels takes whichever ink reads better against it:
  // a mid-gray "dark" can be too light for white text yet not light enough to count as light.
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
    logoOnLight: artwork('full'),
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
  // The references are trimmed once here, as the screen's views trim them to resolve names: the validator tolerates
  // padding on a reference (a hand-edited version), and every print match (the served cards, the matrix) reads these.
  return foundationMessageGoalViews(content).map((goal) => ({ ...goal, icps: goal.icps.map((id) => id.trim()), segmentLabel: goal.segmentNames.join(', ') }));
}

/** The segments with their goals and channels as one line each, and a `Goal n` chip per goal served, so the template joins nothing. */
export function foundationMessagePrintIcps(content: FoundationMessageContent): FoundationMessagePrintIcp[] {
  return foundationMessageIcpViews(content).map((icp) => {
    const goals = icp.goals.map((id) => id.trim());
    const goalChips = content.mf.goals.filter((goal) => goals.includes(goal.id)).map((goal) => `Goal ${goal.n}`);
    return {
      ...icp,
      goals,
      goalLabel: icp.goalTitles.join(', '),
      channelsLabel: icp.channels.join(' · '),
      goalChips,
      whoWidth: frameworkPortraitIcpWhoWidth([icp.kind, ...goalChips]),
    };
  });
}

/** The approval's date as the cover prints it (`6 Nov 2026`, UTC), '' when there is none to read. */
export function mktgPrintApprovedDate(approvedAt: string | null): string {
  const time = Date.parse(approvedAt ?? '');
  if (Number.isNaN(time)) return '';
  const date = new Date(time);
  return `${date.getUTCDate()} ${MKTG_PRINT_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * A source as the Sources & gaps page prints it: as the run stored it, with
 * only its type prefix (`Website: `, `Link: `, `Press release: `) taken off.
 * Nothing is renamed or invented: a URL prints as the URL.
 */
export function foundationMessagePrintSourceLabel(source: string): string {
  const trimmed = source.trim();
  const type = FOUNDATION_MESSAGE_PRINT_SOURCE_TYPES.find((prefix) => trimmed.startsWith(`${prefix}: `));
  return type ? trimmed.slice(type.length + 2).trim() : trimmed;
}

/** The say-and-avoid page's intro, counting the anchor questions as the mock's sentence does ("the three questions every piece of content answers"). */
export function foundationMessagePrintAnchorIntro(count: number): string {
  const words = FOUNDATION_MESSAGE_PRINT_COUNT_WORDS[count] ?? String(count);
  return `The words the framework uses, the ones it replaces, and the ${words} question${count === 1 ? '' : 's'} every piece of content answers.`;
}

/** Every goal's proof points with their sources and the goal that uses each, in the framework's order. */
export function foundationMessagePrintFacts(goals: FoundationMessagePrintGoal[]): FoundationMessagePrintFactRow[] {
  return goals.flatMap((goal) => goal.proofRows.map((proof) => ({ fact: proof.fact, source: proof.source, usedBy: `Goal ${goal.n} · ${goal.t}` })));
}

/**
 * The key numbers with each figure's source: the source of the proof points that state the figure as a whole number (`299` in
 * `299 member organizations`, `10,000+` in `More than 10,000 published MCP servers`; never `8` in `188`, `299` in `299.5` or
 * `1,299`, while a sentence's own comma or period after the figure is no part of it), when they agree on one. A figure no
 * proof point states, or that proof points source differently, carries '' and prints no pill: the record's own key numbers
 * have no source of their own, and none is invented.
 */
export function foundationMessagePrintNumbers(numbers: FoundationMessageNumberRow[], facts: FoundationMessagePrintFactRow[]): FoundationMessagePrintNumber[] {
  return numbers.map((row) => {
    const figure = row.number.trim().replace(/\+$/, '');
    const token = new RegExp(`(?:^|[^\\d,.])${figure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d|[,.]\\d)`);
    const sources = new Set(facts.filter((fact) => figure !== '' && token.test(fact.fact)).map((fact) => fact.source));
    return { ...row, source: sources.size === 1 ? [...sources][0] : '' };
  });
}

/** Goals × profiles: one row per profile, a cell per goal (in the framework's order), true where the goal's messaging is written for the profile. */
export function foundationMessagePrintMatrix(goals: FoundationMessagePrintGoal[], icps: FoundationMessagePrintIcp[]): FoundationMessagePrintMatrixRow[] {
  return icps.map((icp) => ({ name: icp.name, cells: goals.map((goal) => goal.icps.includes(icp.id)) }));
}

/**
 * The Messaging Framework as one printed document: the portrait book's
 * pages (`frameworkPortraitPlan`) — the view's tabs, with the run's report
 * on the last page and the reviewer's note left out. `version` is the
 * number the page shows (the Documents revision, or the run's version), so
 * the print says what the screen says; `kit` is the project's stored Brand
 * Kit, or null for the LF look; `approvedAt` is when that revision was
 * approved, which the cover and the sources page date; `report` and
 * `dateRead` are the run's, from the stored record (null when the caller
 * does not know them: the label is then empty, the report stays null and
 * the Sources & gaps page prints no report blocks).
 */
export function buildFoundationMessagePrintView(
  content: FoundationMessageContent,
  projectName: string,
  version: number | null,
  kit: BrandKitRevision | null,
  approvedAt: string | null = null,
  report: FoundationMessageReport | null = null,
  dateRead: string | null = null
): FoundationMessagePrintView {
  const name = projectName.trim();
  const goals = foundationMessagePrintGoals(content);
  const icps = foundationMessagePrintIcps(content);
  const facts = foundationMessagePrintFacts(goals);
  const dateLabel = mktgPrintApprovedDate(approvedAt);
  const dateReadLabel = mktgPrintApprovedDate(dateRead);
  return {
    brand: mktgPrintBrand(kit),
    projectName: name,
    eyebrow: name ? `${name} · a Linux Foundation project` : 'A Linux Foundation project',
    title: FOUNDATION_MESSAGE_PRINT_TITLE,
    versionLabel: version === null ? '' : `V${version}.0`,
    approvedLabel: dateLabel ? `Approved ${dateLabel}` : '',
    dateLabel,
    website: kit ? brandKitWebsiteHost(kit.websiteUrl) : '',
    dateReadLabel,
    report,
    runningHead: `${name} ${FOUNDATION_MESSAGE_PRINT_TITLE}`.trim(),
    sections: foundationMessagePrintSections(),
    facts,
    mf: content.mf,
    mh: content.mh,
    goals,
    icps,
    pillars: foundationMessagePillarViews(content),
    avoidRows: foundationMessageAvoidRows(content),
    numbers: foundationMessagePrintNumbers(foundationMessageNumberRows(content), facts),
    audiences: foundationMessageAudienceRows(content),
  };
}
