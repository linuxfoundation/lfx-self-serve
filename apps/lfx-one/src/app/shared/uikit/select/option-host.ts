// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { UiOption } from '@lfx-one/shared/interfaces';

/**
 * What a list of uikit options (select today, combobox and multi-select later) offers to the `lfx-ui-option` rows inside it. Options inject this
 * instead of a concrete list, so each list keeps its own picking rules and options never import the list that owns them.
 */
export abstract class UiOptionHost {
  /** True when the option is the picked one (`aria-selected`, check mark). */
  public abstract isSelected(option: UiOption): boolean;
  /** True when the option holds the keyboard highlight (`aria-activedescendant`). */
  public abstract isActive(option: UiOption): boolean;
  /** Picks the option. A disabled option is ignored. */
  public abstract pick(option: UiOption): void;
  /** Moves the keyboard highlight to the option, for the pointer. A disabled option is ignored. */
  public abstract highlight(option: UiOption): void;
  /** False while the list filters and the option does not match; the row is hidden. A list that does not filter leaves it out and keeps every row visible. */
  public isVisible?(option: UiOption): boolean;
  /** The part of the option's label to emphasise, as `[start, end)`, or `null` for none. Only a row that shows its plain label is emphasised. */
  public matchRange?(option: UiOption): [number, number] | null;
}
