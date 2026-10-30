// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

/** A labelled group of `lfx-ui-option` rows inside a select. It is a `role="group"` named by its title; the rows stay in one arrow-key order. */
@Component({
  selector: 'lfx-ui-option-group',
  templateUrl: './option-group.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    // A group whose rows are all filtered out disappears with them.
    class: 'flex shrink-0 flex-col [&:not(:has([role=option]:not(.hidden)))]:hidden',
    '[attr.aria-labelledby]': 'labelId',
    'data-testid': 'ui-option-group',
  },
})
export class UiOptionGroupComponent {
  /** Small heading above the group, such as "Foundations". */
  public readonly label = input.required<string>();

  protected readonly labelId = inject(_IdGenerator).getId('lfx-ui-option-group-');
}
