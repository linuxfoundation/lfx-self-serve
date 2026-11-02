// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { UiChipComponent } from './chip.component';

/** What an `lfx-ui-chip-group` offers the chips inside it, so a chip does not import the group that imports it. */
export abstract class UiChipHost {
  /** The chips whose × could take focus when `chip` is removed, in order: the ones after it, then the ones before it, nearest first. Chips being removed and chips without a × do not count. */
  public abstract successorsOf(chip: UiChipComponent): UiChipComponent[];
  /** Moves focus to the × of the first of `candidates` that can take it, else of any chip left, else to the group's fallback. Called by a chip once it is gone. */
  public abstract restoreFocus(candidates: UiChipComponent[]): void;
}
