// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, contentChildren, inject, input, Signal } from '@angular/core';

import { UiOptionHost } from './option-host';
import { UiOptionComponent } from './option.component';

/**
 * A labelled group of `lfx-ui-option` rows inside a select or combobox. It is a `role="group"` named by its title; the rows stay in one arrow-key
 * order. A combobox hides a group whose rows are all filtered out, title included; a select shows every row, so its groups stay.
 */
@Component({
  selector: 'lfx-ui-option-group',
  templateUrl: './option-group.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    class: 'flex shrink-0 flex-col',
    '[class.hidden]': 'hidden()',
    '[attr.aria-labelledby]': 'labelId',
    'data-testid': 'ui-option-group',
  },
})
export class UiOptionGroupComponent {
  /** Small heading above the group, such as "Foundations". */
  public readonly label = input.required<string>();

  protected readonly labelId = inject(_IdGenerator).getId('lfx-ui-option-group-');
  private readonly host = inject(UiOptionHost, { optional: true });
  private readonly options = contentChildren(UiOptionComponent, { descendants: true });
  /** True when the list filters and none of the group's rows is visible, so the title goes with them. A list that does not filter never hides a group. */
  protected readonly hidden: Signal<boolean> = computed(() => !!this.host?.isVisible && !this.options().some((option) => this.host?.isVisible?.(option.item)));
}
