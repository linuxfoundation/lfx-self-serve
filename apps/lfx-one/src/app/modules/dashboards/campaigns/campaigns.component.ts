// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';

import { CAMPAIGN_PROGRAM_TYPES, CAMPAIGN_TABS } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignProgramType, CampaignTab } from '@lfx-one/shared/interfaces';

import { ImplementationTabComponent } from './components/implementation-tab/implementation-tab.component';
import { MonitoringTabComponent } from './components/monitoring-tab/monitoring-tab.component';
import { OptimizationTabComponent } from './components/optimization-tab/optimization-tab.component';
import { PlanningTabComponent } from './components/planning-tab/planning-tab.component';

@Component({
  selector: 'lfx-campaigns',
  imports: [PlanningTabComponent, ImplementationTabComponent, MonitoringTabComponent, OptimizationTabComponent],
  templateUrl: './campaigns.component.html',
  styleUrl: './campaigns.component.scss',
})
export class CampaignsComponent {
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly tabs = CAMPAIGN_TABS;
  protected readonly programTypes = CAMPAIGN_PROGRAM_TYPES;
  protected readonly selectedTab = signal<CampaignTab>('planning');
  protected readonly selectedProgramType = signal<CampaignProgramType>('events');
  protected readonly briefOutput = signal<CampaignBriefOutput | null>(null);

  protected readonly activeProgramTypeConfig = computed(() => this.programTypes.find((pt) => pt.id === this.selectedProgramType()) ?? this.programTypes[0]);

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
      if (isPlatformBrowser(this.platformId)) {
        const target = (event.target as HTMLElement).parentElement?.children[newIndex] as HTMLElement | undefined;
        target?.focus();
      }
    }
  }

  protected onProgramTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as CampaignProgramType;
    this.selectedProgramType.set(value);
  }

  protected onProceedToImplementation(brief: CampaignBriefOutput): void {
    this.briefOutput.set(brief);
    this.selectedTab.set('implementation');
  }
}
