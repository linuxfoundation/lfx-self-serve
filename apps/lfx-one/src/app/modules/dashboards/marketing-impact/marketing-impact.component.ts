// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { SelectComponent } from '@components/select/select.component';
import { MARKETING_IMPACT_FOCUS_OPTIONS, MARKETING_IMPACT_TABS } from '@lfx-one/shared/constants';
import { buildMarketingImpactMonthOptions, formatCurrency, getDefaultMarketingImpactMonth } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { map, of, startWith, switchMap, tap } from 'rxjs';

import type {
  FilterPillOption,
  MarketingImpactFocusProgram,
  MarketingImpactMonthOption,
  MarketingImpactTab,
  MarketingImpactTabOption,
  PerformanceSummaryKpi,
  RevenueImpactResponse,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-marketing-impact',
  imports: [ReactiveFormsModule, SelectComponent, ButtonComponent, FilterPillsComponent],
  templateUrl: './marketing-impact.component.html',
  styleUrl: './marketing-impact.component.scss',
})
export class MarketingImpactComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly fb = inject(FormBuilder);
  private readonly defaultMonth = getDefaultMarketingImpactMonth();

  protected readonly headerForm = this.fb.nonNullable.group({
    month: [this.defaultMonth],
  });

  protected readonly monthOptions: MarketingImpactMonthOption[] = buildMarketingImpactMonthOptions();
  protected readonly focusOptions: FilterPillOption[] = MARKETING_IMPACT_FOCUS_OPTIONS;
  protected readonly tabs: MarketingImpactTabOption[] = MARKETING_IMPACT_TABS;

  protected readonly selectedFocus = signal<MarketingImpactFocusProgram>('all');
  protected readonly selectedTab = signal<MarketingImpactTab>('overview');
  protected readonly loading = signal(false);

  protected readonly hasFoundation = computed(() => !!this.projectContextService.selectedFoundation());
  protected readonly foundationName = computed(() => this.projectContextService.selectedFoundation()?.name ?? '');
  protected readonly selectedTabLabel = computed(() => this.tabs.find((t) => t.id === this.selectedTab())?.label ?? '');

  protected readonly selectedMonth: Signal<string> = this.initSelectedMonth();
  protected readonly contextLabel: Signal<string> = this.initContextLabel();
  protected readonly revenueImpactData: Signal<RevenueImpactResponse | null> = this.initRevenueImpactData();
  protected readonly performanceSummaryKpis: Signal<PerformanceSummaryKpi[]> = this.initPerformanceSummaryKpis();

  protected onFocusChange(focusId: string): void {
    if (this.focusOptions.some((o) => o.id === focusId)) {
      this.selectedFocus.set(focusId as MarketingImpactFocusProgram);
    }
  }

  protected onTabChange(tabId: MarketingImpactTab): void {
    this.selectedTab.set(tabId);
  }

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
      return `Cross-channel performance for ${name} \u00B7 ${monthLabel}`;
    });
  }

  private initRevenueImpactData(): Signal<RevenueImpactResponse | null> {
    const foundation$ = toObservable(this.projectContextService.selectedFoundation).pipe(map((f) => f?.slug));

    return toSignal(
      foundation$.pipe(
        switchMap((slug) => {
          if (!slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          return this.analyticsService.getRevenueImpact(slug).pipe(tap(() => this.loading.set(false)));
        })
      ),
      { initialValue: null }
    );
  }

  private initPerformanceSummaryKpis(): Signal<PerformanceSummaryKpi[]> {
    return computed(() => {
      const data = this.revenueImpactData();
      if (!data) return [];

      const change = data.changePercentage;
      let trend: PerformanceSummaryKpi['trend'] = 'neutral';
      let trendClass = 'text-gray-500';
      if (change > 0) {
        trend = 'up';
        trendClass = 'text-green-600';
      } else if (change < 0) {
        trend = 'down';
        trendClass = 'text-red-600';
      }

      return [
        {
          id: 'attributed-revenue',
          label: 'Attributed Revenue',
          icon: 'fa-light fa-dollar-sign',
          iconClass: 'bg-green-100 text-green-600',
          value: formatCurrency(data.revenueAttributed),
          momChange: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
          trend,
          trendClass,
          previousLabel: 'vs prior period',
        },
      ];
    });
  }
}
