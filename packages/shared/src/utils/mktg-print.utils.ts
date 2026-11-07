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
  FOUNDATION_MESSAGE_PRINT_SOURCE_TYPES,
  FOUNDATION_MESSAGE_PRINT_TITLE,
  MKTG_PRINT_BODY_INK_MIN_CONTRAST,
  MKTG_PRINT_INK_ON_DARK,
  MKTG_PRINT_INK_ON_LIGHT,
  MKTG_PRINT_DOT,
  MKTG_PRINT_LF_LOOK,
} from '../constants/mktg-print.constants';
import { mktgPrintFigure, mktgPrintJoin } from './mktg-print-text.utils';
import type { BrandKitRevision } from '../interfaces/brand-kit.interface';
import type { FoundationMessageContent, FoundationMessageNumberRow, FoundationMessageReport } from '../interfaces/foundation-message.interface';
import type {
  FoundationMessagePrintFactRow,
  FoundationMessagePrintGoal,
  FoundationMessagePrintIcp,
  FoundationMessagePrintMatrixRow,
  FoundationMessagePrintNumber,
  FoundationMessagePrintView,
  MktgPrintBrand,
  MktgPrintLogo,
} from '../interfaces/mktg-print.interface';
import { brandKitContrastRatio, brandKitLuminance, brandKitTint, buildBrandKitBookView } from './brand-kit-book.utils';
import { brandKitPortraitArtwork, brandKitPortraitDate } from './brand-kit-portrait.utils';
import { mktgReadableSourceName, mktgReadableSourceText } from './mktg-readable-source.utils';
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
  return mktgPrintJoin([projectName.trim(), asset.trim(), version === null ? '' : `v${version}`, date]);
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
  // file on a dark ground, else the primary filtered to white only when it is one colour — a multi-colour primary is
  // drawn in full colour, never flattened to one shape; the primary as it is on a light one; null when the kit has no
  // drawable file for it), named for the project; the kit's placeholder flag draws none.
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
      channelsLabel: mktgPrintJoin(icp.channels),
      goalChips,
      personaLines: icp.personaRows.map((persona) => mktgPrintJoin([persona.role, persona.cares])),
      whoWidth: frameworkPortraitIcpWhoWidth([icp.kind, ...goalChips]),
    };
  });
}

/** `aaif.io/md/about`, `docs.example.org`: a web address written without its scheme (a host with a dot, a path after it or nothing). */
const BARE_ADDRESS_REGEX = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?$/i;
/** A bare address with the record's remark on it in parentheses, or alone: `aaif.io (home)`, `docs.example.org`. Words after a dotted name make a phrase (`Node.js docs`), not an address. */
const BARE_ADDRESS_REMARK_REGEX = /^(\S+)(\s*\(.*\))?$/;
/** `host/path`, as the grammar's `mktgReadableSourceName` returns a page's address: the host is what the Sources page prints of it. */
const HOST_PATH_REGEX = /^[a-z0-9.-]+\//i;

/**
 * A source as the Sources & gaps page prints it, in words a reader knows and
 * never a path (the editor's rules, 7 November 2026): its type prefix
 * (`Website: `, `Link: `, `Press release: `) taken off; a web address as its
 * HOST alone (`aaif.io`), with the record's own remark on it after the middle
 * dot when it wrote one (`aaif.io · home`, `github.com · org page and repos
 * API`), never a humanised path: the record stores no page title, and no word
 * is invented for one; a press release named as the design's mock names it,
 * "The press release" with the site's host; a file, an archive or a hashed
 * address in the grammar's words (`mktgReadableSourceName`); the LFX record
 * by name, never its slug; anything else as written.
 */
export function foundationMessagePrintSourceLabel(source: string): string {
  const trimmed = source.trim();
  const type = FOUNDATION_MESSAGE_PRINT_SOURCE_TYPES.find((prefix) => trimmed.startsWith(`${prefix}: `));
  const rest = type ? trimmed.slice(type.length + 2).trim() : trimmed;
  // A bare token is an address only when the grammar has no word of its own for it: a file name (`a1b2c3d4e5f6.svg`,
  // `brand-guide.pdf`), an archive member (`brand.zip/logo.svg`) or the LFX record go to `mktgReadableSourceName` as written.
  const first = rest.split(/\s/)[0];
  const bare = BARE_ADDRESS_REGEX.test(first) && mktgReadableSourceName(first) === first ? rest.match(BARE_ADDRESS_REMARK_REGEX) : null;
  const url = rest.match(/^(https?:\/\/\S+)(.*)$/) ?? bare;
  if (!url) return mktgReadableSourceName(rest);
  const [, written, remarkRaw = ''] = url;
  const address = /^https?:\/\//i.test(written) ? written : `https://${written}`;
  const readable = mktgReadableSourceName(address);
  // A page's address comes back as `host/path`: the host alone. The grammar's words for a file or a stylesheet stay.
  const name = HOST_PATH_REGEX.test(readable) ? readable.split('/')[0] : readable;
  const remark = remarkRaw
    .trim()
    .replace(/^\((.*)\)$/, '$1')
    .trim();
  if (type === 'Press release') return `The press release (${name})${remark ? `${MKTG_PRINT_DOT}${remark}` : ''}`;
  return mktgPrintJoin([name, remark]);
}

/**
 * The Read list's rows: each source as `foundationMessagePrintSourceLabel`
 * prints it, and the sources that print the same (six pages of one site, all
 * `aaif.io`) gathered into one row that counts them (`aaif.io · 6 pages`), in
 * the first one's place, so no row repeats. A provisional call: the editor
 * asked for the host; a list of one host six times is not a list.
 */
export function foundationMessagePrintSourceRows(sources: readonly string[]): string[] {
  const rows: { label: string; host: string; count: number }[] = [];
  for (const source of sources) {
    const label = foundationMessagePrintSourceLabel(source);
    // The remark is the record's own word on one page; the count gathers the pages of one host whatever each remark said.
    // A row that is no address (the LFX record, a name the record wrote) is its own and never counted.
    const host = label.split(MKTG_PRINT_DOT)[0];
    const row = BARE_ADDRESS_REGEX.test(host) ? rows.find((entry) => entry.host === host) : undefined;
    if (row) row.count += 1;
    else rows.push({ label, host: BARE_ADDRESS_REGEX.test(host) ? host : '', count: 1 });
  }
  return rows.map((row) => (row.count > 1 ? `${row.host}${MKTG_PRINT_DOT}${row.count} pages` : row.label));
}

/** A sentence of the report (a failed source's reason, a gap) with every URL and file name in it in a reader's words (the grammar's rule). */
export function foundationMessagePrintReportText(text: string): string {
  return mktgReadableSourceText(text.trim());
}

/** The say-and-avoid page's intro, counting the anchor questions as the mock's sentence does ("the three questions every piece of content answers"). */
export function foundationMessagePrintAnchorIntro(count: number): string {
  const words = FOUNDATION_MESSAGE_PRINT_COUNT_WORDS[count] ?? String(count);
  return `The words the framework uses, the ones it replaces, and the ${words} question${count === 1 ? '' : 's'} every piece of content answers.`;
}

/** A profile continuation page's intro: `Profile 3 of 10.` for one card, `Profiles 3–4 of 10.` for a pair. */
export function foundationMessagePrintIcpPageIntro(start: number, count: number, total: number): string {
  return count === 1 ? `Profile ${start} of ${total}.` : `Profiles ${start}–${start + count - 1} of ${total}.`;
}

/** Every goal's proof points with their sources and the goal that uses each, in the framework's order. */
export function foundationMessagePrintFacts(goals: FoundationMessagePrintGoal[]): FoundationMessagePrintFactRow[] {
  return goals.flatMap((goal) =>
    goal.proofRows.map((proof) => ({ fact: proof.fact, source: proof.source, usedBy: mktgPrintJoin([`Goal ${goal.n}`, goal.t]) }))
  );
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
    // The figure prints with its thousands separators (the editor's rule); a fact states it in either form.
    const number = mktgPrintFigure(row.number);
    const figures = [...new Set([row.number.trim(), number].map((figure) => figure.replace(/\+$/, '')).filter((figure) => figure !== ''))];
    const tokens = figures.map((figure) => new RegExp(`(?:^|[^\\d,.])${figure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d|[,.]\\d)`));
    const sources = new Set(facts.filter((fact) => tokens.some((token) => token.test(fact.fact))).map((fact) => fact.source));
    return { ...row, number, source: sources.size === 1 ? [...sources][0] : '' };
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
  // The dates as the brand kit's book prints them (K's one date rule: UTC, a fixed month table), '' for none or an unreadable one.
  const dateLabel = brandKitPortraitDate(approvedAt ?? '');
  const dateReadLabel = brandKitPortraitDate(dateRead ?? '');
  return {
    brand: mktgPrintBrand(kit),
    projectName: name,
    eyebrow: name ? mktgPrintJoin([name, 'a Linux Foundation project']) : 'A Linux Foundation project',
    title: FOUNDATION_MESSAGE_PRINT_TITLE,
    versionLabel: version === null ? '' : `V${version}.0`,
    approvedLabel: dateLabel ? `Approved ${dateLabel}` : '',
    dateLabel,
    website: kit ? brandKitWebsiteHost(kit.websiteUrl) : '',
    dateReadLabel,
    report,
    runningHead: `${name} ${FOUNDATION_MESSAGE_PRINT_TITLE}`.trim(),
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
