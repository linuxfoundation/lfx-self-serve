// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Download PDF for the Marketing OS asset views: each asset prints as a
// document through the browser's print dialog ("Save as PDF"), in the
// project's brand when the project has a Brand Kit (its colours, typeface and
// logo) and in the LF look otherwise. The Brand Kit's own book keeps its
// constants in brand-kit.constants.ts; these are the Messaging Framework's
// print and the look every print shares.

import { lfxColors } from './colors.constants';

/** The body class set while the Messaging Framework prints, so the page shows its print document alone (see styles.scss). */
export const FOUNDATION_MESSAGE_PRINT_BODY_CLASS = 'lfx-print-framework';

/** The class of the framework print document's wrapper: never shown on screen, shown only while the framework prints (see styles.scss). */
export const FOUNDATION_MESSAGE_PRINT_ONLY_CLASS = 'lfx-framework-print-only';

/**
 * The framework view's tabs that print, in order: the framework, the ICPs,
 * the message house and the key numbers. The run's sources and gaps (and the
 * reviewer's note) stay on screen: they are for the reviewer, not the reader.
 */
export const FOUNDATION_MESSAGE_PRINT_TAB_IDS = ['framework', 'icps', 'message-house', 'numbers'] as const;

/** The document's title on the cover and in the running heads. */
export const FOUNDATION_MESSAGE_PRINT_TITLE = 'Messaging Framework';

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

/** The weights the print sets the brand's typeface in, loaded before the print dialog opens. */
export const MKTG_PRINT_FONT_WEIGHTS = [400, 600] as const;
