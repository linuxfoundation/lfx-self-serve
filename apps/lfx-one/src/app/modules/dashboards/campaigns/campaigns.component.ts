// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';

import { CAMPAIGN_TABS } from '@lfx-one/shared/constants';
import type { CampaignTab } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-campaigns',
  imports: [],
  templateUrl: './campaigns.component.html',
  styleUrl: './campaigns.component.scss',
})
export class CampaignsComponent {
  protected readonly tabs = CAMPAIGN_TABS;
  protected readonly selectedTab = signal<CampaignTab>('planning');

  protected selectTab(tab: CampaignTab): void {
    this.selectedTab.set(tab);
  }

  protected onTabKeydown(event: KeyboardEvent, currentIndex: number): void {
    let newIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      newIndex = (currentIndex + 1) % this.tabs.length;
    } else if (event.key === 'ArrowLeft') {
      newIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
    } else if (event.key === 'Home') {
      newIndex = 0;
    } else if (event.key === 'End') {
      newIndex = this.tabs.length - 1;
    }

    if (newIndex !== null) {
      event.preventDefault();
      this.selectTab(this.tabs[newIndex].id);
      const target = (event.target as HTMLElement).parentElement?.children[newIndex] as HTMLElement | undefined;
      target?.focus();
    }
  }
}
