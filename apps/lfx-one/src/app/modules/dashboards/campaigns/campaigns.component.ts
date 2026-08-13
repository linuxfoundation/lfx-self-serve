// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { CAMPAIGN_DELIVERY_TYPES, CAMPAIGN_PROGRAM_TYPES, CAMPAIGN_TABS } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignDeliveryType, CampaignProgramType, CampaignTab, CampaignTabOption } from '@lfx-one/shared/interfaces';

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

  /**
   * The Email side's current tab.
   *
   * Typed to exclude 'optimization' rather than merely documenting that it is never set: the
   * exclusion is the whole reason this signal exists separately, so the compiler should be the
   * thing that enforces it. `selectTab` narrows before assigning.
   */
  protected readonly selectedEmailTab = signal<Exclude<CampaignTab, 'optimization'>>('planning');
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
   * Whether the Email delivery type is the one on screen.
   *
   * One computed rather than repeated `=== 'email'` comparisons, and the template is the
   * reason: the two container bindings are INVERSIONS of each other, which is where a mistake
   * would hide. `isEmail()` / `!isEmail()` reads as the opposition it is.
   */
  protected readonly isEmail = computed(() => this.selectedDeliveryType() === 'email');

  /**
   * The Email side's tab set — a plain field, NOT a computed over the active delivery type.
   *
   * That distinction is the whole point. Both containers stay MOUNTED, so a list keyed on
   * `isEmail()` would describe *the page* rather than *this container*: while Paid Marketing is
   * showing, the hidden Email tablist would render the unfiltered four — including the Optimize
   * button this channel must never offer — and the keyboard handler's bounds would disagree
   * with the DOM it indexes into. A per-container constant cannot drift with ambient state.
   *
   * Email drops **Optimize** because the tab has no meaning here, not because it is unbuilt.
   * Optimize drives keyword and status actions, and `HubSpotDispatcher` implements no
   * `StatusToggler`: campaign create STAGES a draft that a human reviews and sends, so nothing
   * is running to pause. A Pause/Resume would be answered `ErrToggleUnsupported` → 400, over
   * keyword and metrics data that is not this channel's to begin with.
   *
   * Monitor stays, but as a pending panel rather than the paid Monitor component.
   * campaign-service CAN read HubSpot email metrics (`HubSpotDispatcher.ReadMetrics`,
   * LFXV2-3058) — this application has no route to it, so there is nothing to render yet.
   * Stated at both layers deliberately: an earlier version of this comment reasoned from the
   * backend capability straight to a frontend guarantee, and that missing step is exactly what
   * made reusing `MonitoringTabComponent` here look safe. It is not — that component's
   * `PlatformType` is `'google' | 'linkedin' | 'reddit' | 'meta'`.
   */
  protected readonly emailTabs: readonly CampaignTabOption[] = CAMPAIGN_TABS.filter((t) => t.id !== 'optimization');

  public constructor() {
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
    // differ: Email has no Optimize (see emailTabs). A shared signal would leave the page on
    // a tab this side does not render after a switch away from Optimize — a blank panel with a
    // tablist that agrees with nothing.
    this.selectorForm.controls.deliveryType.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (value === this.selectedDeliveryType()) {
        return;
      }
      this.selectedDeliveryType.set(value);
    });
  }

  /**
   * Set the current tab on the container that OWNS the tablist, named explicitly by the caller.
   *
   * Not inferred from `selectedDeliveryType()`. Both containers are mounted, so the hidden one's
   * buttons still dispatch — and a handler that routes by ambient state writes the hidden
   * tablist's click into the VISIBLE side's signal. `display:none` keeps that out of reach of an
   * ordinary pointer or Tab press, but not of a programmatic `.click()`, which is exactly what
   * an E2E locator resolving a duplicated testid performs.
   */
  protected selectTab(tab: CampaignTab, owner: CampaignDeliveryType): void {
    if (owner === 'email') {
      // Narrowed, never cast: `selectedEmailTab` excludes 'optimization' by type, and the only
      // way to arrive here with it is a caller iterating the wrong list — the very bug the
      // exclusion exists to catch, so it must not be asserted away.
      if (tab !== 'optimization') {
        this.selectedEmailTab.set(tab);
      }
      return;
    }
    this.selectedTab.set(tab);
  }

  /**
   * Roving-tabindex keyboard navigation over one tablist.
   *
   * The owner is passed in for the same reason `selectTab` takes it, plus one specific to this
   * handler: `currentIndex` comes from the firing tablist's `@for`, and the DOM focus lookup
   * below indexes that same tablist's children. If the bounding list came from ambient state
   * instead, those three would be indexing into collections of different lengths — the email
   * tablist passing index 2 against a four-length list would select Optimize and focus nothing.
   */
  protected onTabKeydown(event: KeyboardEvent, currentIndex: number, owner: CampaignDeliveryType): void {
    const tabs = owner === 'email' ? this.emailTabs : this.tabs;
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
      this.selectTab(tabs[newIndex].id, owner);
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

  /**
   * Discard both sides' briefs and return both to Plan.
   *
   * BOTH, not just the visible one. A program switch changes the brief context for every
   * delivery type — the URL scrape and the generated copy are program-specific — and the two
   * containers stay mounted, so resetting only the side on screen leaves an Events brief sitting
   * under Education on the other, waiting to be handed to Implement the next time the user
   * switches delivery type.
   */
  private resetToPlanning(): void {
    this.briefOutput.set(null);
    this.selectedTab.set('planning');
    this.emailBriefOutput.set(null);
    this.selectedEmailTab.set('planning');
  }
}
