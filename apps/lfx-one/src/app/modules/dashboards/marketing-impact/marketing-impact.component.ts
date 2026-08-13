// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { SelectComponent } from '@components/select/select.component';
import {
  COMING_SOON_FOCUS_PROGRAMS,
  EVENTS_SPLIT_FOCUS,
  EVENTS_SPLIT_OPTIONS,
  FOCUS_VISIBLE_TABS,
  MARKETING_IMPACT_FOCUS_OPTIONS,
  MARKETING_IMPACT_TABS,
} from '@lfx-one/shared/constants';
import { buildMarketingImpactPeriodOptions, getDefaultMarketingImpactPeriod } from '@lfx-one/shared/utils';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { startWith } from 'rxjs';

import type {
  EventsSplitOption,
  EventsSplitView,
  FilterPillOption,
  MarketingImpactFocusProgram,
  MarketingImpactPeriodOption,
  MarketingImpactTab,
  MarketingImpactTabOption,
} from '@lfx-one/shared/interfaces';

import { EmailTabComponent } from './components/email-tab/email-tab.component';
import { OverviewTabComponent } from './components/overview-tab/overview-tab.component';
import { PerformanceMarketingTabComponent } from './components/performance-marketing-tab/performance-marketing-tab.component';
import { SocialAccountsTabComponent } from './components/social-accounts-tab/social-accounts-tab.component';
import { SocialListeningTabComponent } from './components/social-listening-tab/social-listening-tab.component';
import { WebActivityTabComponent } from './components/web-activity-tab/web-activity-tab.component';

@Component({
  selector: 'lfx-marketing-impact',
  imports: [
    ReactiveFormsModule,
    SelectComponent,
    FilterPillsComponent,
    OverviewTabComponent,
    PerformanceMarketingTabComponent,
    EmailTabComponent,
    WebActivityTabComponent,
    SocialAccountsTabComponent,
    SocialListeningTabComponent,
  ],
  templateUrl: './marketing-impact.component.html',
  styleUrl: './marketing-impact.component.scss',
})
export class MarketingImpactComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly fb = inject(FormBuilder);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly defaultPeriod = getDefaultMarketingImpactPeriod();

  // === Forms ===
  protected readonly headerForm = this.fb.nonNullable.group({
    period: [this.defaultPeriod],
  });

  protected readonly periodOptions: MarketingImpactPeriodOption[] = buildMarketingImpactPeriodOptions();
  protected readonly focusOptions: FilterPillOption[] = MARKETING_IMPACT_FOCUS_OPTIONS;
  protected readonly tabs: MarketingImpactTabOption[] = MARKETING_IMPACT_TABS;
  protected readonly eventsSplitOptions: EventsSplitOption[] = EVENTS_SPLIT_OPTIONS;

  // === WritableSignals ===
  protected readonly selectedFocus = signal<MarketingImpactFocusProgram>('all');
  protected readonly selectedTab = signal<MarketingImpactTab>('all');
  /** Attendance vs sponsorship sub-view; only meaningful while the Events campaign type is active. */
  protected readonly selectedEventsSplit = signal<EventsSplitView>('attendance');

  // === Computed Signals ===
  protected readonly hasFoundation = computed(() => !!this.projectContextService.selectedFoundation());
  protected readonly foundationName = computed(() => this.projectContextService.selectedFoundation()?.name ?? '');
  protected readonly foundationSlug = computed(() => this.projectContextService.selectedFoundation()?.slug);
  protected readonly selectedPeriod: Signal<string> = this.initSelectedPeriod();
  protected readonly contextLabel: Signal<string> = this.initContextLabel();
  protected readonly visibleTabs: Signal<MarketingImpactTabOption[]> = this.initVisibleTabs();
  protected readonly isExecutiveDirector: Signal<boolean> = this.initIsExecutiveDirector();
  /** True when the selected Campaign Type has no dashboard content built yet. */
  protected readonly isComingSoon = computed(() => COMING_SOON_FOCUS_PROGRAMS.has(this.selectedFocus()));
  /**
   * The attendance/sponsorship split is scoped to the Events campaign type on the "All" channel.
   * The per-channel tabs render their own components, which have no attendance/sponsorship dimension.
   */
  protected readonly showEventsSplit = computed(() => this.selectedFocus() === EVENTS_SPLIT_FOCUS && this.selectedTab() === 'all');
  /** Display label of the selected Campaign Type, used in the coming-soon copy. */
  protected readonly selectedFocusLabel = computed(() => this.focusOptions.find((o) => o.id === this.selectedFocus())?.label ?? '');

  /**
   * ids that name the shared tabpanel. The channel tab always names it; when the Events split is
   * showing, its selected tab is appended so the panel is announced as (for example)
   * "All Event Sponsorship" rather than just "All" — both tabs control this one panel.
   */
  protected readonly panelLabelledBy = computed(() => {
    const channel = `mi-tab-${this.selectedTab()}`;
    return this.showEventsSplit() ? `${channel} mi-events-tab-${this.selectedEventsSplit()}` : channel;
  });

  // === Protected Methods ===
  protected onFocusChange(focusId: string): void {
    if (this.focusOptions.some((o) => o.id === focusId)) {
      const focus = focusId as MarketingImpactFocusProgram;
      this.selectedFocus.set(focus);

      const allowed = FOCUS_VISIBLE_TABS[focus];
      if (!allowed.has(this.selectedTab())) {
        this.selectedTab.set(this.tabs.find((t) => allowed.has(t.id))?.id ?? 'all');
      }
    }
  }

  protected onTabChange(tabId: MarketingImpactTab): void {
    this.selectedTab.set(tabId);
  }

  protected onEventsSplitChange(view: EventsSplitView): void {
    this.selectedEventsSplit.set(view);
  }

  /**
   * Roving-tabindex keyboard handling for the Events split tablist, mirroring the person-detail
   * drawer's tabs. Only the selected tab is in the tab order, so without Arrow/Home/End movement a
   * keyboard-only user could reach Attendance and never Sponsorship. Focus follows selection,
   * which is what the roving pattern requires.
   */
  protected onEventsSplitKeydown(event: KeyboardEvent): void {
    const views = this.eventsSplitOptions;
    const current = views.findIndex((view) => view.id === this.selectedEventsSplit());
    let next = current;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % views.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + views.length) % views.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = views.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.selectedEventsSplit.set(views[next].id);
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById(`mi-events-tab-${views[next].id}`)?.focus();
    }
  }

  // === Private Initializers ===
  private initSelectedPeriod(): Signal<string> {
    return toSignal(this.headerForm.controls.period.valueChanges.pipe(startWith(this.defaultPeriod)), {
      initialValue: this.defaultPeriod,
    });
  }

  private initVisibleTabs(): Signal<MarketingImpactTabOption[]> {
    return computed(() => {
      const allowed = FOCUS_VISIBLE_TABS[this.selectedFocus()];
      return this.tabs.filter((t) => allowed.has(t.id));
    });
  }

  // Uses currentPersona() not canViewExecutiveDashboards() — LF Staff keep their contributor persona and fall into the !isExecutiveDirector() Social-Listening-only branch.
  private initIsExecutiveDirector(): Signal<boolean> {
    return computed(() => this.personaService.currentPersona() === 'executive-director');
  }

  private initContextLabel(): Signal<string> {
    return computed(() => {
      const name = this.foundationName();
      const periodValue = this.selectedPeriod();
      const option = this.periodOptions.find((o) => o.value === periodValue);
      const periodLabel = option?.label ?? '';
      if (!name || !periodLabel) return '';
      return `Cross-channel performance for ${name} · ${periodLabel}`;
    });
  }
}
