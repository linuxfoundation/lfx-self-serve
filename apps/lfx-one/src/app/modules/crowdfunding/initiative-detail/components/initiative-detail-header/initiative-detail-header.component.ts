// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, viewChild } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  CROWDFUNDING_ATTRIBUTION_TYPE_ICONS,
  CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES,
  CROWDFUNDING_FUND_TYPE_COLOR_CLASSES,
  CROWDFUNDING_FUND_TYPE_ICONS,
  CROWDFUNDING_FUND_TYPE_LABELS,
} from '@lfx-one/shared/constants';
import { CrowdfundingInitiativeStatus, InitiativeDetail, InitiativeMenuItem, TabOption } from '@lfx-one/shared/interfaces';
import { environment } from '@environments/environment';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-initiative-detail-header',
  imports: [AvatarComponent, CardComponent, TagComponent, ButtonComponent, MenuComponent, MarkdownRendererComponent, ConfirmDialogModule, TooltipModule],
  templateUrl: './initiative-detail-header.component.html',
  styleUrl: './initiative-detail-header.component.scss',
})
export class InitiativeDetailHeaderComponent {
  private readonly confirmationService = inject(ConfirmationService);

  public readonly initiative = input.required<InitiativeDetail>();
  public readonly activeTab = input.required<string>();
  /** Show the creator-only Edit attribution action (lfx-crowdfunding#342); the page decides lens, owner, status and flag. */
  public readonly canEditAttribution = input(false);
  public readonly tabChange = output<string>();
  public readonly settingsClick = output<void>();
  public readonly editAttributionClick = output<void>();
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
          description: 'Make this initiative publicly visible and allow it to accept donations again. Canceled recurring donations are not restored.',
          command: () => this.confirmActivate(),
        },
      ];
    }
    return [
      {
        label: 'Archive Initiative',
        icon: 'fa-solid fa-box-archive',
        description: 'Hide this initiative from public view. No new donations will be accepted and all active recurring donations will be canceled.',
        command: () => this.confirmArchive(),
      },
    ];
  });

  protected readonly fundTypeLabel = computed(() => CROWDFUNDING_FUND_TYPE_LABELS[this.initiative().initiativeType]);
  protected readonly fundTypeIcon = computed(() => CROWDFUNDING_FUND_TYPE_ICONS[this.initiative().initiativeType]);
  protected readonly fundTypeColorClass = computed(() => CROWDFUNDING_FUND_TYPE_COLOR_CLASSES[this.initiative().initiativeType]);
  protected readonly avatarStyleClass = computed(() => CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES[this.initiative().initiativeType]);
  protected readonly attributionIcon = computed(() => {
    const type = this.initiative().attribution?.type;
    return type ? CROWDFUNDING_ATTRIBUTION_TYPE_ICONS[type] : '';
  });
  protected readonly attributionTooltip = computed(() => {
    const entity = this.initiative().attribution?.type === 'project' ? 'project' : 'organization';
    return `This initiative is run on behalf of this ${entity}. Donors see it on the public initiative page.`;
  });
  protected readonly publicPageUrl = computed(() => `${environment.urls.crowdfunding.replace(/\/+$/, '')}/initiatives/${this.initiative().slug}`);
  protected readonly industryTags = computed(() =>
    (this.initiative().industry ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  );

  protected onMoreClick(event: Event): void {
    this.moreMenu()?.toggle(event);
  }

  private confirmActivate(): void {
    this.confirmationService.confirm({
      key: 'initiative-status',
      header: 'Activate Initiative',
      message:
        'Are you sure you want to activate this initiative? It will be publicly visible and accept donations again. Recurring donations canceled while it was archived will not resume; donors must subscribe again.',
      acceptLabel: 'Activate',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.statusChange.emit('published'),
    });
  }

  private confirmArchive(): void {
    this.confirmationService.confirm({
      key: 'initiative-status',
      header: 'Archive Initiative',
      message:
        'Are you sure you want to archive this initiative? It will be hidden from public view, no new donations will be accepted, and all active recurring donations will be canceled. Donors will have to subscribe again if you reactivate it.',
      acceptLabel: 'Archive',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.statusChange.emit('hidden'),
    });
  }
}
