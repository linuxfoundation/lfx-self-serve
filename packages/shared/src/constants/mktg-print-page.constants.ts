// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The landscape print grammar's constants: the deck's page plan
// (marketing-os-agents agents/slides-export src/fit.ts and src/pages.ts at
// 7839d985), ported value for value, on the 720 × 405 pt canvas; and how that
// canvas is put on paper. The PDF prints and the Slides export share the
// plan, so a printed page is the slide.

import type { MktgPrintPageBox } from '../interfaces/mktg-print-page.interface';
import { lfxColors } from './colors.constants';

/** The deck's canvas (pt): the 16:9 slide every page plan is laid out on. */
export const MKTG_PRINT_PAGE_CANVAS = { w: 720, h: 405 } as const;

/**
 * The printed page: US Letter landscape, no margin (`@page { size: 11in 8.5in;
 * margin: 0 }`, 792 × 612 pt), so the browser's header and footer stay off
 * the saved PDF. A4 landscape (842 × 595 pt) is the other common paper, and a
 * PDF printed to it (the print dialog's paper, or Playwright's `format`)
 * ignores the CSS size: a frame as tall as Letter would spill a blank sheet
 * per page there. So every page frame is the narrower width (Letter's 11in)
 * and a hair under the shorter height (A4's 8.27in): 792 × 594 pt, which
 * fits both papers whole, the frame's own `break-after: page` turning the
 * page. On Letter the 18 pt left over is a white band under the frame.
 */
export const MKTG_PRINT_LANDSCAPE_PAGE_PT = { w: 792, h: 612 } as const;
export const MKTG_PRINT_PAGE_FRAME_PT = { w: 792, h: 594 } as const;

/**
 * The scale the renderer applies ONCE to the canvas: the frame's width over the
 * canvas's (792 / 720 = 1.1), so the slide fills the page's width; the slide
 * area (792 × 445.5 pt) sits centred in the frame with equal white bands
 * above and below.
 */
export const MKTG_PRINT_PAGE_SCALE = MKTG_PRINT_PAGE_FRAME_PT.w / MKTG_PRINT_PAGE_CANVAS.w;

/**
 * The CSS custom property the page shell sets to MKTG_PRINT_PAGE_SCALE on its host: every box a consumer
 * sizes on a page is in deck points and scaled through it (`mktgPagePt`), never by a hard-coded factor.
 */
export const MKTG_PRINT_PAGE_SCALE_PROPERTY = '--mktg-page-scale';

/** The slide area's offset from the frame's top (pt): half the room the 16:9 slide leaves in the frame. */
export const MKTG_PRINT_PAGE_SLIDE_TOP_PT = (MKTG_PRINT_PAGE_FRAME_PT.h - MKTG_PRINT_PAGE_CANVAS.h * MKTG_PRINT_PAGE_SCALE) / 2;

/**
 * The hidden print frame's viewport for a landscape print, in CSS inches:
 * Letter landscape's width and a hair under its height (as
 * MKTG_PRINT_FRAME_PAPER_IN for the portrait prints: WebKit lays a subframe
 * out at the frame's own size, so a frame of the portrait size would lay the
 * landscape pages out against the wrong box). The fixed page frames never
 * size from the viewport, so the slack only guards against rounding.
 */
export const MKTG_PRINT_FRAME_LANDSCAPE_PAPER_IN = { width: 11, height: 8.4 } as const;

/**
 * The landscape page setup the print frame writes as its unnamed `@page` rule
 * for the deck-page prints: Letter landscape with no margin (CSS Paged Media
 * Level 3 `size`; the margin keeps the browser's header and footer off the
 * PDF). One setup for every engine: the fixed page frames paginate by
 * `break-after: page` and need no table head or foot, so WebKit's bug 17205
 * (a table's head and foot printed once) does not reach them. Kept beside
 * MKTG_PRINT_PAGE_SETUPS, which the portrait documents choose from.
 */
export const MKTG_PRINT_LANDSCAPE_PAGE_SETUP = 'size: 11in 8.5in; margin: 0;';

/** Text box insets (pt): the Slides API's 0.1 in at the sides, taken at the top and bottom too. */
export const MKTG_PRINT_PAGE_INSET = 7.2;
/** Line height as a multiple of the font size, at the 100% line spacing the deck sets. */
export const MKTG_PRINT_PAGE_LINE = 1.22;
/** The indent of a bulleted paragraph (pt). */
export const MKTG_PRINT_PAGE_BULLET_INDENT = 18;
/** The smallest share of its preferred size a text is set at before it is cut. */
export const MKTG_PRINT_PAGE_MIN_SCALE = 0.72;
/** The step the fit tries between 1 and the floor. */
export const MKTG_PRINT_PAGE_SCALE_STEP = 0.04;

/** The content area under the title band, above the logo lockup and the page number (pt). */
export const MKTG_PRINT_PAGE_AREA: MktgPrintPageBox = { x: 25, y: 91, w: 671, h: 265 };
/** The book's text column (30%) and the visual beside it. */
export const MKTG_PRINT_PAGE_LEFT: MktgPrintPageBox = { x: 25, y: 91, w: 200, h: 265 };
export const MKTG_PRINT_PAGE_RIGHT: MktgPrintPageBox = { x: 247, y: 91, w: 449, h: 265 };
/** The title band under the eyebrow lines: where the template's title placeholder sits on the content layout. */
export const MKTG_PRINT_PAGE_TITLE_BOX: MktgPrintPageBox = { x: 25, y: 34, w: 671, h: 52 };
/** The two eyebrow lines of the running head: left the chapter or section, right the document. */
export const MKTG_PRINT_PAGE_HEAD_LEFT_BOX: MktgPrintPageBox = { x: 25, y: 6, w: 420, h: 26 };
export const MKTG_PRINT_PAGE_HEAD_RIGHT_BOX: MktgPrintPageBox = { x: 446, y: 6, w: 250, h: 26 };
/**
 * The LF 2025 template's "Title Only" layout keeps a logo image in its
 * bottom-left corner (frame x 18.4–86.3, y 366.0–388.4 pt); the deck swaps the
 * project lockup into that frame on every content page, and the footer line
 * starts clear of it.
 */
export const MKTG_PRINT_PAGE_LOGO_FRAME: MktgPrintPageBox = { x: 18.4, y: 366, w: 67.9, h: 22.4 };
/** Where the footer line starts: 6 pt after the logo frame. */
export const MKTG_PRINT_PAGE_FOOTER_LEFT_X = 92;
/** The footer's boxes: the line left of the logo frame, the page number right. */
export const MKTG_PRINT_PAGE_FOOTER_LEFT_BOX: MktgPrintPageBox = { x: MKTG_PRINT_PAGE_FOOTER_LEFT_X, y: 362, w: 445 - MKTG_PRINT_PAGE_FOOTER_LEFT_X, h: 26 };
export const MKTG_PRINT_PAGE_FOOTER_RIGHT_BOX: MktgPrintPageBox = { x: 446, y: 362, w: 250, h: 26 };

/** The cover's title and subtitle placeholders (the template's TITLE layout): the title large, the subtitle under it. */
export const MKTG_PRINT_PAGE_COVER_TITLE_BOX: MktgPrintPageBox = { x: 38, y: 150, w: 560, h: 70 };
export const MKTG_PRINT_PAGE_COVER_SUBTITLE_BOX: MktgPrintPageBox = { x: 38, y: 224, w: 580, h: 80 };
/**
 * The cover's own lines, the deck's boxes (kit-book.ts and framework-print.ts coverSlide): the eyebrow top-left
 * (capitals), a line top-right (a version, a month), the footer line bottom-left and a line bottom-right.
 */
export const MKTG_PRINT_PAGE_COVER_EYEBROW_BOX: MktgPrintPageBox = { x: 38, y: 12, w: 470, h: 26 };
export const MKTG_PRINT_PAGE_COVER_TOP_RIGHT_BOX: MktgPrintPageBox = { x: 508, y: 12, w: 154, h: 26 };
export const MKTG_PRINT_PAGE_COVER_FOOTER_LEFT_BOX: MktgPrintPageBox = { x: 38, y: 362, w: 330, h: 26 };
export const MKTG_PRINT_PAGE_COVER_FOOTER_RIGHT_BOX: MktgPrintPageBox = { x: 368, y: 362, w: 294, h: 26 };
/** The project lockup on the cover: above the title, left-aligned with it (the deck's cover layout carries the template's logo there). */
export const MKTG_PRINT_PAGE_COVER_LOGO_BOX: MktgPrintPageBox = { x: 38, y: 96, w: 140, h: 44 };
/** The back cover's lines (kit-book.ts backCoverSlide): the site's host under the title, the notice near the foot, both centred. */
export const MKTG_PRINT_PAGE_BACK_HOST_BOX: MktgPrintPageBox = { x: 25, y: 238, w: 671, h: 26 };
export const MKTG_PRINT_PAGE_BACK_NOTICE_BOX: MktgPrintPageBox = { x: 70, y: 312, w: 580, h: 40 };
/** The back cover's title: the brand line, centred in the slide's upper half. */
export const MKTG_PRINT_PAGE_BACK_TITLE_BOX: MktgPrintPageBox = { x: 60, y: 160, w: 600, h: 70 };

/** The preferred sizes (pt): what the print sets, scaled to the slide. */
export const MKTG_PRINT_PAGE_SIZE = { title: 22, prose: 11, eyebrow: 7.5, caption: 8, card: 9.5, head: 8, coverTitle: 44, coverSubtitle: 15 } as const;

/** The space between table-like rows (pt). */
export const MKTG_PRINT_PAGE_ROW_GAP = 7;

/** The gap between stacked blocks when a block names none (pt). */
export const MKTG_PRINT_PAGE_STACK_GAP = 8;

/** The share of a paragraph kept at each cut when a block still does not fit at the floor. */
export const MKTG_PRINT_PAGE_CUT_SHARE = 0.85;

/** The shortest paragraph the fit will cut (characters). */
export const MKTG_PRINT_PAGE_CUT_MIN_CHARS = 12;

/** The muted ink (eyebrows, footers) and the hairline rule when the brand's dark is no `#RRGGBB` colour to mix from: the app's grays. */
export const MKTG_PRINT_PAGE_MUTED_INK = lfxColors.gray[500];
export const MKTG_PRINT_PAGE_RULE_INK = lfxColors.gray[200];
