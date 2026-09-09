// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { MentorshipRowAction } from '@lfx-one/shared/interfaces';
import { MenuItem } from 'primeng/api';

import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';

/**
 * The trailing row-actions cell shared by the program-detail people tables — an
 * ellipsis trigger and its popup menu, or an em dash when a row has no action left.
 *
 * The tabs pass resolved labels and icons rather than their own status unions, which
 * differ. Every action currently raises the shared "coming soon" toast, so the command
 * lives here; when the write endpoints land this gains an output and the tabs handle it.
 */
@Component({
  selector: 'lfx-mentorship-row-actions',
  imports: [ButtonComponent, MenuComponent],
  templateUrl: './row-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowActionsComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);

  public readonly personName = input.required<string>();
  public readonly actions = input.required<MentorshipRowAction[]>();
  public readonly testId = input.required<string>();

  protected readonly menuItems = computed<MenuItem[]>(() =>
    this.actions().map((action) => ({
      label: action.label,
      icon: action.icon,
      command: () => this.comingSoon.notify(`${action.label} ${this.personName()}`),
    }))
  );
}
