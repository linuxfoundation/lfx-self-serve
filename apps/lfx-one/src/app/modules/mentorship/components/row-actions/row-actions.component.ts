// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { MentorshipRowAction } from '@lfx-one/shared/interfaces';
import { MenuItem } from 'primeng/api';

/**
 * The trailing row-actions cell shared by the program-detail people tables — an
 * ellipsis trigger and its popup menu, or an em dash when a row has no action left.
 *
 * The tab passes resolved actions and handles the one picked, which `actionSelect`
 * hands back with its `value`, so the menu stays free of any tab's action union.
 */
@Component({
  selector: 'lfx-mentorship-row-actions',
  imports: [ButtonComponent, MenuComponent],
  templateUrl: './row-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowActionsComponent {
  public readonly personName = input.required<string>();
  public readonly actions = input.required<MentorshipRowAction[]>();
  public readonly testId = input.required<string>();

  public readonly actionSelect = output<MentorshipRowAction>();

  protected readonly menuItems = computed<MenuItem[]>(() =>
    this.actions().map((action) => ({
      label: action.label,
      icon: action.icon,
      command: () => this.actionSelect.emit(action),
    }))
  );
}
