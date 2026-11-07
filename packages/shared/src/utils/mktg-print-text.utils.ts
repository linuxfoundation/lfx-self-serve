// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The one text rule every marketing print shares: parts joined with the
// middle dot (MKTG_PRINT_DOT). On its own so the constants file exports
// values only and the layout utils and the print utils both import it
// without a cycle (mktg-print.utils.ts imports the layout utils).

import { MKTG_PRINT_DOT } from '../constants/mktg-print.constants';

/** Parts joined with the one middle dot, each trimmed, the empty ones left out: `Goal 1 · Events`. */
export function mktgPrintJoin(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(MKTG_PRINT_DOT);
}
