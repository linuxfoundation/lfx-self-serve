// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { UiCollapseSize, UiHeadingLevel } from '@lfx-one/shared/interfaces';

/**
 * An accordion group: headings that reveal their section when clicked. Put `lfx-ui-collapse-item` elements inside it.
 * Items start closed. The two components are a compound pair: `lfx-ui-collapse-item` takes `value` and `title` and projects its section content.
 * Use `[(open)]` to read and set the open items by value; `exclusive` keeps one open at a time, and only the last value in `open` counts as open.
 */
@Component({
  selector: 'lfx-ui-collapse',
  templateUrl: './collapse.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col shadow-[inset_0_1px_0_0] shadow-ui-neutral-alpha-200', 'data-testid': 'ui-collapse' },
})
export class UiCollapseComponent {
  /** Values of the open items. Supports two-way binding with `[(open)]`. */
  public readonly open = model<string[]>([]);
  /** Opening an item closes the others (one at a time). Off lets several items stay open. */
  public readonly exclusive = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** `default` has 20px headings; `small` has 14px headings and tighter padding. Applies to every item in the group. */
  public readonly size = input<UiCollapseSize>('default');

  /** Heading level (`aria-level`) of every item's trigger, 1 to 6. Pick the level that fits the page outline. */
  public readonly headingLevel = input<UiHeadingLevel>(3);

  public isOpen(value: string): boolean {
    const open = this.open();
    // When exclusive, only the last value counts as open.
    return this.exclusive() ? open.at(-1) === value : open.includes(value);
  }

  public toggle(value: string): void {
    if (this.isOpen(value)) {
      this.open.set(this.exclusive() ? [] : this.open().filter((v) => v !== value));
    } else {
      this.open.set(this.exclusive() ? [value] : [...this.open(), value]);
    }
  }
}
