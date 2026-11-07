// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Download PDF for the Marketing OS asset views: each asset prints as a
// document through the browser's print dialog ("Save as PDF"), in the
// project's brand when the project has a Brand Kit (its colours, typeface and
// logo) and in the LF look otherwise. The Brand Kit's own book keeps its
// constants in brand-kit.constants.ts; these are the Messaging Framework's
// print and what every print shares.

import { lfxColors } from './colors.constants';

/** The body class set while the Messaging Framework prints, so the page shows its print document alone (see styles.scss). */
export const FOUNDATION_MESSAGE_PRINT_BODY_CLASS = 'lfx-print-framework';

/** The class of the framework print document's wrapper: never shown on screen, shown only while the framework prints (see styles.scss). */
export const FOUNDATION_MESSAGE_PRINT_ONLY_CLASS = 'lfx-framework-print-only';

/**
 * The framework view's tabs that print, in order: the framework and the key
 * numbers. The run's sources and gaps (and the
 * reviewer's note) stay on screen: they are for the reviewer, not the reader.
 */
export const FOUNDATION_MESSAGE_PRINT_TAB_IDS = ['framework', 'numbers'] as const;

/** Printed marker for an unanswered FAQ; independent of the screen's tab labels. */
export const MKTG_FAQ_PRINT_UNANSWERED = 'Needs an answer';

/** The document's title on the cover and in the running heads. */
export const FOUNDATION_MESSAGE_PRINT_TITLE = 'Messaging Framework';

/**
 * The framework's portrait book: how many ideal customer profiles one page
 * holds (two full profile rows at reading size), so the page count follows
 * the data and no profile flows across a page edge.
 */
export const FOUNDATION_MESSAGE_PRINT_ICPS_PER_PAGE = 2;

/** The plan ids of the framework's portrait pages that are not numbered from the data (`goal-1`, `icps-2` are). */
export const FRAMEWORK_PORTRAIT_PAGE_IDS = {
  cover: 'cover',
  framework: 'framework',
  sayAvoid: 'say-avoid',
  messageHouse: 'message-house',
  keyNumbers: 'key-numbers',
  sources: 'sources',
} as const;

/** The running head's section labels of the framework's portrait chapters, in order. */
export const FRAMEWORK_PORTRAIT_SECTIONS = {
  framework: '01 Framework',
  icps: '02 ICPs',
  messageHouse: '03 Message house',
  keyNumbers: '04 Key numbers',
  sources: '05 Sources',
} as const;

/** The page titles of the framework's portrait book that are not the data's (a goal page is titled `Goal 1 · Events`). */
export const FRAMEWORK_PORTRAIT_TITLES = {
  framework: 'Framework',
  sayAvoid: 'Say and avoid · anchor questions',
  icps: 'Ideal customer profiles',
  messageHouse: 'Message house',
  keyNumbers: 'Key numbers',
  sources: 'Sources & gaps',
} as const;

/**
 * The key numbers page's tiles, px: 344 wide in pairs, 140 high, a 16 gap,
 * the first row at 210; the "Every figure and its source" table 28 under the
 * last row. An odd count's last tile spans the 704 column (never an orphan
 * half-tile).
 */
export const FRAMEWORK_PORTRAIT_NUMBER_TILE = { width: 344, height: 140, gap: 16, top: 210, tableGap: 28 } as const;

/**
 * The fixed tops of the framework's portrait pages whose blocks the fit
 * model bounds (the design's R(x, y) values, px): a goal page's key-message
 * bar, proof list, sound bite and "Who it's for" cards; the Sources & gaps
 * page's lists and approval card; and where the footer begins, which no
 * block may pass.
 */
export const FRAMEWORK_PORTRAIT_TOPS = {
  goalKey: 330,
  goalProofs: 450,
  goalBite: 690,
  goalServed: 810,
  sourcesLists: 210,
  sourcesApproval: 880,
  /** The first ICP page's rows start under the long intro; the later pages' under the short one. */
  icpRowsFirst: 214,
  icpRows: 190,
  icpMatrix: 560,
  /** The top of the footer's room: the last pixel any block may reach. */
  footer: 1000,
} as const;

/** The on-screen Sources card's empty state for the gaps, printed verbatim on the Sources & gaps page. */
export const FOUNDATION_MESSAGE_PRINT_NO_GAP_MESSAGE = 'The sources left no gap.';

/** The source types a run writes before a source (`Website: https://…`); the Sources & gaps page prints the source without the type. */
export const FOUNDATION_MESSAGE_PRINT_SOURCE_TYPES = ['Website', 'Link', 'Press release'] as const;

/** The fixed three-letter month names the prints date with (UTC), the same in every engine and locale. */
export const MKTG_PRINT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * The LF look: what a print uses when the project has no Brand Kit yet. The
 * LF navy as the dark, the LF blue as the accent, Inter (which the app
 * already loads), and the Linux Foundation logo from the app's own images.
 */
export const MKTG_PRINT_LF_LOOK = {
  dark: lfxColors.blue[900],
  accent: lfxColors.blue[500],
  tint: lfxColors.blue[50],
  onDark: lfxColors.white,
  fontStack: "'Inter', sans-serif",
  logoOnDark: '/images/logo_lf_white.svg',
  logoOnLight: '/images/logo_lf_horizontal_color.png',
  logoAlt: 'The Linux Foundation',
} as const;

/** The ink on a kit's dark ground when that "dark" is in fact light: the app's darkest gray. */
export const MKTG_PRINT_INK_ON_LIGHT = lfxColors.gray[900];

/** White ink on a dark ground. */
export const MKTG_PRINT_INK_ON_DARK = lfxColors.white;

/** The contrast a kit's dark must reach on white to set the white pages' body text: WCAG AA for normal text. Below it the body takes MKTG_PRINT_INK_ON_LIGHT. */
export const MKTG_PRINT_BODY_INK_MIN_CONTRAST = 4.5;

/** The CSS filter that draws a full-colour lockup reversed (white), when the kit supplies no reversed artwork. */
export const MKTG_PRINT_REVERSED_FILTER = 'brightness(0) invert(1)';

/** How long Download PDF waits for the brand's typeface before it opens the print dialog anyway (ms). */
export const MKTG_PRINT_FONT_WAIT_MS = 3000;

/**
 * How long the hidden print frame stays after its print dialog opened when no
 * `afterprint` arrives (ms): iOS Safari builds its preview asynchronously and
 * may never fire the event, so the frame is kept well past any preview, then
 * reclaimed. The next print, or the view's `clear`, removes it at once.
 */
export const MKTG_PRINT_FRAME_LINGER_MS = 5 * 60 * 1000;

/**
 * The hidden print frame's viewport in CSS inches: US Letter's width and a
 * hair under its height. WebKit lays a subframe out at the frame's own size
 * and resolves its viewport units there (Chromium paginates against the page
 * box whatever the frame measures), so a 1px frame collapsed every `100vh`
 * cover and shifted the page breaks. Letter is the SHORTER common paper (11in
 * against A4's 11.69in; it is the wider one, 8.5in against 8.27in), so a cover
 * sized from `vh` fills a Letter page and never spills a blank sheet on A4;
 * never size print rules from `vw`. Where the pages print with no `@page`
 * margin (`MKTG_PRINT_PAGE_SETUPS`), a page is `100vh` tall and holds its
 * 1.1in of head and foot room (0.55in each, repeated on every page by the
 * sheet tables) plus a cover of `calc(100vh - 1.2in)`: 0.1in of slack in the
 * cover itself, and the frame's own 0.1in under 11in behind it, so a fraction
 * of rounding never pushes an empty remainder onto a blank sheet. Where they
 * print on the page margins instead, the cover is `calc(100vh - 1.1in)`, the
 * page area under those margins.
 */
export const MKTG_PRINT_FRAME_PAPER_IN = { width: 8.5, height: 10.9 } as const;

/**
 * The page setups the print frame writes as the ONE unnamed `@page` rule of
 * its document (WebKit's support for named pages is doubtful, and on the
 * browser's default margins a cover sized to the page area spills a blank
 * sheet). `brand-kit` is the legacy landscape book; `mktg-framework` every
 * portrait document (the brand kit's own portrait print included) in
 * Chromium and every other non-WebKit engine, mirrored by the named
 * `@page mktg-framework` in styles.scss, which a matched named rule outranks
 * in Chrome with the same values. Both print with `margin: 0`: the browser
 * draws its header and footer (date, title, URL, page numbers) only in the
 * page margin area, so no margin is the standard way to keep them off a saved
 * PDF, and the room the portrait pages used to take from the margin (0.55in
 * top and bottom, 0.6in at the sides) is inside the documents, repeated per
 * page by their table head and foot groups (lfx-mktg-print-sheet, the kit's
 * chapters). WebKit does not repeat a table's head and foot on every printed
 * page (bug 17205, open), so in Safari the portrait documents print on
 * `mktg-framework-page-margins`, exactly the margins they had before, with
 * that in-document room collapsed under `MKTG_PRINT_PAGE_MARGINS_CLASS`: the
 * browser's header and footer stay, as before, and the user unticks them in
 * Safari's print dialog. `mktg-portrait` is the fixed-frame portrait book
 * (`MKTG_PORTRAIT_PRINT_CLASS`: the kit's 17 pages, and every document built
 * of `lfx-mktg-portrait-page` frames): US Letter with no margin in BOTH
 * engines, since each frame is the whole sheet and carries its own room;
 * the print frame writes it unnamed (WebKit) and as `@page mktg-portrait`
 * (Chromium, where the body's inherited named page would otherwise win).
 * Keep these in step with styles.scss and `_mktg-portrait.scss`, which
 * cannot read them.
 */
export const MKTG_PRINT_PAGE_SETUPS = {
  'brand-kit': 'size: letter landscape; margin: 0;',
  'mktg-framework': 'size: portrait; margin: 0;',
  'mktg-framework-page-margins': 'size: portrait; margin: 0.55in 0.6in;',
  'mktg-portrait': 'size: 8.5in 11in; margin: 0;',
} as const;

/**
 * The class the print frame sets on its body when the page prints on its
 * margins (`mktg-framework-page-margins`: WebKit), under which the documents'
 * own room collapses to nothing: the sheets' head and foot rows, the kit
 * chapters' head padding and foot, the print roots' side padding, the covers
 * sized back to the page area. Each room rule carries its collapse beside it.
 */
export const MKTG_PRINT_PAGE_MARGINS_CLASS = 'lfx-print-page-margins';

/**
 * The weights the framework print sets the brand's typeface in, loaded before
 * the print dialog opens: the body (400), the headings, tagline and key
 * numbers (`font-medium`, 500) and the labels (`font-semibold`, 600).
 */
export const MKTG_PRINT_FONT_WEIGHTS = [400, 500, 600] as const;

/**
 * The id prefix of a typeface's Google Fonts stylesheet link in the page's
 * head, followed by the stylesheet's encoded URL: one link per typeface,
 * whichever print (the framework's or the Brand Kit's book) loaded it first.
 */
export const MKTG_PRINT_FONT_LINK_ID_PREFIX = 'brand-kit-font-';
