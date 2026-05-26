// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, viewChild } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES,
  CROWDFUNDING_FUND_TYPE_COLOR_CLASSES,
  CROWDFUNDING_FUND_TYPE_ICONS,
  CROWDFUNDING_FUND_TYPE_LABELS,
} from '@lfx-one/shared/constants';
import { InitiativeDetail, InitiativeMenuItem, TabOption } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-initiative-detail-header',
  imports: [AvatarComponent, CardComponent, TagComponent, ButtonComponent, MenuComponent],
  templateUrl: './initiative-detail-header.component.html',
  styleUrl: './initiative-detail-header.component.scss',
})
export class InitiativeDetailHeaderComponent {
  public readonly initiative = input.required<InitiativeDetail>();
  public readonly activeTab = input.required<string>();
  public readonly tabChange = output<string>();
  public readonly settingsClick = output<void>();

  private readonly moreMenu = viewChild<MenuComponent>('moreMenu');

  protected readonly tabOptions: TabOption<string>[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'financials', label: 'Financials' },
    { value: 'announcements', label: 'Announcements' },
  ];

  protected readonly moreMenuItems: InitiativeMenuItem[] = [
    {
      label: 'Pause fundraising',
      icon: 'fa-solid fa-pause',
      description: 'Temporarily stop accepting new donations. Your initiative stays visible but the "Donate" button is hidden.',
    },
    {
      label: 'Close initiative',
      icon: 'fa-solid fa-circle-xmark',
      description: 'Permanently close this initiative and stop all recurring donations. Remaining balance is handled per LF policy.',
      danger: true,
    },
  ];

  protected readonly fundTypeLabel = computed(() => CROWDFUNDING_FUND_TYPE_LABELS[this.initiative().initiativeType]);
  protected readonly fundTypeIcon = computed(() => CROWDFUNDING_FUND_TYPE_ICONS[this.initiative().initiativeType]);
  protected readonly fundTypeColorClass = computed(() => CROWDFUNDING_FUND_TYPE_COLOR_CLASSES[this.initiative().initiativeType]);
  protected readonly avatarStyleClass = computed(() => CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES[this.initiative().initiativeType]);

  protected onMoreClick(event: Event): void {
    this.moreMenu()?.toggle(event);
  }
}
