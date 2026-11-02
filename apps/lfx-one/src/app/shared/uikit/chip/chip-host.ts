// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { UiChipComponent } from './chip.component';

/** What an `lfx-ui-chip-group` offers the chips inside it, so a chip does not import the group that imports it. */
export abstract class UiChipHost {
  /** The chip whose × takes focus when `chip` is removed: the next one, else the previous one. Chips being removed and chips without a × do not count. */
  public abstract successorOf(chip: UiChipComponent): UiChipComponent | null;
  /** Moves focus to the × of `preferred`, else of any chip left, else to the group's fallback. Called by a chip once it is gone. */
  public abstract restoreFocus(preferred: UiChipComponent | null): void;
}
