// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { CdkMenuGroup } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

/** A labelled group of items inside a `lfx-ui-menu`. The label names the group for screen readers; items stay in one arrow-key order. */
@Component({
  selector: 'lfx-ui-menu-group',
  templateUrl: './menu-group.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [CdkMenuGroup],
  host: {
    class: 'flex flex-col',
    '[attr.aria-labelledby]': 'label() ? labelId : null',
    'data-testid': 'ui-menu-group',
  },
})
export class UiMenuGroupComponent {
  /** Small heading above the group, such as "Share". */
  public readonly label = input<string>('');

  protected readonly labelId = inject(_IdGenerator).getId('lfx-ui-menu-group-');
}
