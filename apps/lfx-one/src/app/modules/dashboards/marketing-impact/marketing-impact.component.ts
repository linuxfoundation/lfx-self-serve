// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { SelectComponent } from '@components/select/select.component';
import { MARKETING_IMPACT_FOCUS_OPTIONS, MARKETING_IMPACT_TABS } from '@lfx-one/shared/constants';
import { buildMarketingImpactMonthOptions, getDefaultMarketingImpactMonth } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { startWith } from 'rxjs';

import type {
  FilterPillOption,
  MarketingImpactFocusProgram,
  MarketingImpactMonthOption,
  MarketingImpactTab,
  MarketingImpactTabOption,
} from '@lfx-one/shared/interfaces';

import { AttributionSectionComponent } from './components/attribution-section/attribution-section.component';
import { OverviewTabComponent } from './components/overview-tab/overview-tab.component';
import { PerformanceMarketingTabComponent } from './components/performance-marketing-tab/performance-marketing-tab.component';

@Component({
  selector: 'lfx-marketing-impact',
  imports: [
    ReactiveFormsModule,
    SelectComponent,
    ButtonComponent,
    FilterPillsComponent,
    OverviewTabComponent,
    AttributionSectionComponent,
    PerformanceMarketingTabComponent,
  ],
  templateUrl: './marketing-impact.component.html',
  styleUrl: './marketing-impact.component.scss',
})
export class MarketingImpactComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly fb = inject(FormBuilder);
  private readonly defaultMonth = getDefaultMarketingImpactMonth();

  // === Forms ===
  protected readonly headerForm = this.fb.nonNullable.group({
    month: [this.defaultMonth],
  });

  protected readonly monthOptions: MarketingImpactMonthOption[] = buildMarketingImpactMonthOptions();
  protected readonly focusOptions: FilterPillOption[] = MARKETING_IMPACT_FOCUS_OPTIONS;
  protected readonly tabs: MarketingImpactTabOption[] = MARKETING_IMPACT_TABS;

  // === WritableSignals ===
  protected readonly selectedFocus = signal<MarketingImpactFocusProgram>('all');
  protected readonly selectedTab = signal<MarketingImpactTab>('overview');

  // === Computed Signals ===
  protected readonly hasFoundation = computed(() => !!this.projectContextService.selectedFoundation());
  protected readonly foundationName = computed(() => this.projectContextService.selectedFoundation()?.name ?? '');
  protected readonly foundationSlug = computed(() => this.projectContextService.selectedFoundation()?.slug);
  protected readonly selectedTabLabel = computed(() => this.tabs.find((t) => t.id === this.selectedTab())?.label ?? '');
  protected readonly selectedMonth: Signal<string> = this.initSelectedMonth();
  protected readonly contextLabel: Signal<string> = this.initContextLabel();

  // === Protected Methods ===
  protected onFocusChange(focusId: string): void {
    if (this.focusOptions.some((o) => o.id === focusId)) {
      this.selectedFocus.set(focusId as MarketingImpactFocusProgram);
    }
  }

  protected onTabChange(tabId: MarketingImpactTab): void {
    this.selectedTab.set(tabId);
  }

  // === Private Initializers ===
  private initSelectedMonth(): Signal<string> {
    return toSignal(this.headerForm.controls.month.valueChanges.pipe(startWith(this.defaultMonth)), {
      initialValue: this.defaultMonth,
    });
  }

  private initContextLabel(): Signal<string> {
    return computed(() => {
      const name = this.foundationName();
      const monthValue = this.selectedMonth();
      const option = this.monthOptions.find((o) => o.value === monthValue);
      const monthLabel = option?.label ?? '';
      if (!name || !monthLabel) return '';
      return `Cross-channel performance for ${name} · ${monthLabel}`;
    });
  }
}
