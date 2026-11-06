// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Messaging Framework's landscape print pages: the framework-only
// constants of the deck's framework print (marketing-os-agents
// agents/slides-export src/framework-print.ts), ported value for value. The
// page grammar they are laid out in is mktg-print-page.constants.ts; the
// document's title is FOUNDATION_MESSAGE_PRINT_TITLE (mktg-print.constants.ts).

import type { MktgPrintFrameworkSection } from '../interfaces/mktg-print-framework.interface';

/**
 * The print's sections, numbered as the cover lists them (framework-print.ts
 * PRINT_SECTIONS): the deck prints the ICPs and the message house, which the
 * framework's screen tabs (FOUNDATION_MESSAGE_VIEW_TABS) and the portrait
 * print's sections (FOUNDATION_MESSAGE_PRINT_TAB_IDS) leave out. A section
 * prints when the framework has its content (mktgPrintFrameworkSections).
 */
export const MKTG_PRINT_FRAMEWORK_SECTIONS: readonly MktgPrintFrameworkSection[] = [
  { id: 'framework', number: '01', title: 'Framework' },
  { id: 'icps', number: '02', title: 'ICPs' },
  { id: 'message-house', number: '03', title: 'Message house' },
  { id: 'numbers', number: '04', title: 'Key numbers' },
] as const;

/** The cover title's size, pt: the framework's cover sets "Messaging Framework" smaller than the kit's "Brand Kit" (framework-print.ts coverSlide). */
export const MKTG_PRINT_FRAMEWORK_COVER_TITLE_SIZE = 36;

/** Key number tiles per page: two rows of three (framework-print.ts NUMBERS_PER_SLIDE). */
export const MKTG_PRINT_FRAMEWORK_NUMBERS_PER_PAGE = 6;

/** A card's outline weight, pt (framework-print.ts card). */
export const MKTG_PRINT_FRAMEWORK_CARD_LINE = 0.75;

/** The say chips: their text size and height, and the gaps between them, pt (framework-print.ts sayAvoidSlides). */
export const MKTG_PRINT_FRAMEWORK_CHIP = { size: 8.5, h: 20, gap: 6, inset: 14 } as const;
