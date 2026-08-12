// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { CAMPAIGN_DELIVERY_TYPES, CAMPAIGN_PROGRAM_TYPES, CAMPAIGN_TABS } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignDeliveryType, CampaignProgramType, CampaignTab } from '@lfx-one/shared/interfaces';

import { SelectComponent } from '../../../shared/components/select/select.component';
import { ImplementationTabComponent } from './components/implementation-tab/implementation-tab.component';
import { MonitoringTabComponent } from './components/monitoring-tab/monitoring-tab.component';
import { OptimizationTabComponent } from './components/optimization-tab/optimization-tab.component';
import { PlanningTabComponent } from './components/planning-tab/planning-tab.component';

@Component({
  selector: 'lfx-campaigns',
  imports: [ReactiveFormsModule, SelectComponent, PlanningTabComponent, ImplementationTabComponent, MonitoringTabComponent, OptimizationTabComponent],
  templateUrl: './campaigns.component.html',
  styleUrl: './campaigns.component.scss',
})
export class CampaignsComponent {
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly tabs = CAMPAIGN_TABS;
  protected readonly programTypes = CAMPAIGN_PROGRAM_TYPES;
  protected readonly deliveryTypes = CAMPAIGN_DELIVERY_TYPES;
  // lfx-select's `options` input is typed as a mutable `any[]`, so pass a shallow
  // mutable copy of the readonly constants rather than the `readonly` arrays directly.
  protected readonly programTypeOptions = [...CAMPAIGN_PROGRAM_TYPES];
  protected readonly deliveryTypeOptions = [...CAMPAIGN_DELIVERY_TYPES];

  // The two selectors are reactive-form controls so they can bind to the lfx-select
  // wrapper (form-driven). nonNullable keeps the value typed to the union, never `| null`.
  protected readonly selectorForm = new FormGroup({
    programType: new FormControl<CampaignProgramType>('events', { nonNullable: true }),
    deliveryType: new FormControl<CampaignDeliveryType>('paid-marketing', { nonNullable: true }),
  });

  /** The Paid Marketing side's current tab. Email keeps its own — see the delivery-type effect. */
  protected readonly selectedTab = signal<CampaignTab>('planning');

  /** The Email side's current tab. Never 'optimization': that tab is not offered here. */
  protected readonly selectedEmailTab = signal<CampaignTab>('planning');
  protected readonly selectedProgramType = signal<CampaignProgramType>('events');
  protected readonly selectedDeliveryType = signal<CampaignDeliveryType>('paid-marketing');
  protected readonly briefOutput = signal<CampaignBriefOutput | null>(null);

  /**
   * The Email side's approved brief. Separate from `briefOutput` for the same reason the tab
   * signals are separate: both containers stay mounted, so one shared signal would let a brief
   * approved under Paid Marketing appear in Email's Implement tab after a round-trip.
   */
  protected readonly emailBriefOutput = signal<CampaignBriefOutput | null>(null);

  protected readonly activeProgramTypeConfig = computed(() => this.programTypes.find((pt) => pt.id === this.selectedProgramType()) ?? this.programTypes[0]);
  protected readonly activeDeliveryTypeConfig = computed(() => this.deliveryTypes.find((dt) => dt.id === this.selectedDeliveryType()) ?? this.deliveryTypes[0]);

  /**
   * The tabs this delivery type actually has.
   *
   * Email drops **Optimize**, and not as a "coming soon" — the tab has no meaning for this
   * channel. Optimize drives keyword and status actions, and `HubSpotDispatcher` implements no
   * `StatusToggler`: campaign create STAGES a draft that a human reviews and sends, so there is
   * nothing running to pause. The service reports that as `ErrToggleUnsupported` → 400 rather
   * than a capability that is merely unwired. Offering the tab would promise an action the
   * backend correctly refuses.
   *
   * Monitor stays: the HubSpot metrics read landed with LFXV2-3058, so it has real data behind
   * it.
   */
  protected readonly visibleTabs = computed(() => (this.selectedDeliveryType() === 'email' ? this.tabs.filter((t) => t.id !== 'optimization') : this.tabs));

  constructor() {
    // Mirror the program control into the signal. A program switch changes the whole
    // brief context (URL scrape, copy), so it resets the brief + returns to planning.
    this.selectorForm.controls.programType.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (value === this.selectedProgramType()) {
        return;
      }
      this.selectedProgramType.set(value);
      this.resetToPlanning();
    });

    // Mirror the delivery-type control into the signal. Preserve ALL in-progress state on BOTH
    // sides of an Email <-> Paid Marketing round-trip: each container stays mounted (hidden via
    // an inline [style.display] binding, which wins the cascade over the `flex` utility that
    // otherwise overrides [hidden]), so we must NOT touch briefOutput OR either selectedTab.
    // Resetting a tab here would swap that side's inner @switch and destroy the
    // currently-mounted tab component (e.g. ImplementationTabComponent with its own
    // form/budget/creation state); leaving both alone means returning to either delivery type
    // restores the tab it was on, with its state.
    //
    // The two sides keep SEPARATE tab signals rather than sharing one, because their tab sets
    // differ: Email has no Optimize (see visibleTabs). A shared signal would leave the page on
    // a tab this side does not render after a switch away from Optimize — a blank panel with a
    // tablist that agrees with nothing.
    this.selectorForm.controls.deliveryType.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (value === this.selectedDeliveryType()) {
        return;
      }
      this.selectedDeliveryType.set(value);
    });
  }

  /** Set the current tab on whichever delivery type is showing. */
  protected selectTab(tab: CampaignTab): void {
    if (this.selectedDeliveryType() === 'email') {
      this.selectedEmailTab.set(tab);
      return;
    }
    this.selectedTab.set(tab);
  }

  /**
   * Roving-tabindex keyboard navigation over the tablist.
   *
   * Bounded by `visibleTabs`, not `tabs`: the Email tablist renders three buttons, so wrapping
   * modulo four would step ArrowRight from the last one onto an index with no button — the
   * focus call would find nothing and the selected tab would be one this side does not render.
   */
  protected onTabKeydown(event: KeyboardEvent, currentIndex: number): void {
    const tabs = this.visibleTabs();
    let newIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      newIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      newIndex = 0;
    } else if (event.key === 'End') {
      newIndex = tabs.length - 1;
    }

    if (newIndex !== null) {
      event.preventDefault();
      this.selectTab(tabs[newIndex].id);
      if (isPlatformBrowser(this.platformId)) {
        // `event.target` is typed `EventTarget | null`, and the cast asserted it away. Selecting
        // the tab is the part that matters; moving focus is the enhancement, so a synthetic or
        // retargeted event must not take the whole handler down with it.
        const source = event.target instanceof HTMLElement ? event.target : null;
        const target = source?.parentElement?.children[newIndex] as HTMLElement | undefined;
        target?.focus();
      }
    }
  }

  protected onProceedToImplementation(brief: CampaignBriefOutput): void {
    this.briefOutput.set(brief);
    this.selectedTab.set('implementation');
  }

  protected onEmailProceedToImplementation(brief: CampaignBriefOutput): void {
    this.emailBriefOutput.set(brief);
    this.selectedEmailTab.set('implementation');
  }

  private resetToPlanning(): void {
    this.briefOutput.set(null);
    this.selectedTab.set('planning');
  }
}
