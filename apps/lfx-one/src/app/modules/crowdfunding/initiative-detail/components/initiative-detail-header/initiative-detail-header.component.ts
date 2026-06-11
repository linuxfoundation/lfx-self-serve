// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, viewChild } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES,
  CROWDFUNDING_FUND_TYPE_COLOR_CLASSES,
  CROWDFUNDING_FUND_TYPE_ICONS,
  CROWDFUNDING_FUND_TYPE_LABELS,
} from '@lfx-one/shared/constants';
import { CrowdfundingInitiativeStatus, InitiativeDetail, InitiativeMenuItem, TabOption } from '@lfx-one/shared/interfaces';
import { environment } from '@environments/environment';

@Component({
  selector: 'lfx-initiative-detail-header',
  imports: [AvatarComponent, CardComponent, TagComponent, ButtonComponent, MenuComponent, MarkdownRendererComponent],
  templateUrl: './initiative-detail-header.component.html',
  styleUrl: './initiative-detail-header.component.scss',
})
export class InitiativeDetailHeaderComponent {
  public readonly initiative = input.required<InitiativeDetail>();
  public readonly activeTab = input.required<string>();
  public readonly tabChange = output<string>();
  public readonly settingsClick = output<void>();
  public readonly statusChange = output<CrowdfundingInitiativeStatus>();

  private readonly moreMenu = viewChild<MenuComponent>('moreMenu');

  protected readonly tabOptions: TabOption<string>[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'financials', label: 'Financials' },
  ];

  protected readonly moreMenuItems = computed<InitiativeMenuItem[]>(() => {
    const status = this.initiative().status;
    if (status === 'submitted' || status === 'declined' || status === 'pending') return [];
    if (status === 'hidden') {
      return [
        {
          label: 'Activate Initiative',
          icon: 'fa-solid fa-circle-check',
          description: 'Make this initiative publicly visible and accept donations again.',
          command: () => this.statusChange.emit('published'),
        },
      ];
    }
    return [
      {
        label: 'Archive Initiative',
        icon: 'fa-solid fa-box-archive',
        description: 'Hide this initiative from public view. No new donations will be accepted while archived.',
        command: () => this.statusChange.emit('hidden'),
      },
    ];
  });

  protected readonly fundTypeLabel = computed(() => CROWDFUNDING_FUND_TYPE_LABELS[this.initiative().initiativeType]);
  protected readonly fundTypeIcon = computed(() => CROWDFUNDING_FUND_TYPE_ICONS[this.initiative().initiativeType]);
  protected readonly fundTypeColorClass = computed(() => CROWDFUNDING_FUND_TYPE_COLOR_CLASSES[this.initiative().initiativeType]);
  protected readonly avatarStyleClass = computed(() => CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES[this.initiative().initiativeType]);
  protected readonly publicPageUrl = computed(() => `${environment.urls.crowdfunding.replace(/\/+$/, '')}/initiatives/${this.initiative().slug}`);
  protected readonly industryTags = computed(() =>
    (this.initiative().industry ?? '').split(',').map((t) => t.trim()).filter(Boolean)
  );

  protected onMoreClick(event: Event): void {
    this.moreMenu()?.toggle(event);
  }
}
