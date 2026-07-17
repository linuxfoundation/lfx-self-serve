// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { ATTRIBUTION_CHANNEL_DESCRIPTIONS, ATTRIBUTION_MODEL_OPTIONS, FOCUS_TO_CLASSIFICATION } from '@lfx-one/shared/constants';
import { formatCurrency, formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, finalize, of, startWith, switchMap } from 'rxjs';

import type {
  AttributionChannelRow,
  AttributionModel,
  AttributionModelOption,
  MarketingAttributionResponse,
  MarketingImpactFocusProgram,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-attribution-section',
  imports: [DecimalPipe, ReactiveFormsModule, SelectComponent, ButtonComponent, TooltipModule],
  templateUrl: './attribution-section.component.html',
  styleUrl: './attribution-section.component.scss',
})
export class AttributionSectionComponent {
  private static readonly revenueKeyByModel: Record<AttributionModel, 'linearRevenue' | 'firstTouchRevenue' | 'lastTouchRevenue' | 'timeDecayRevenue'> = {
    linear: 'linearRevenue',
    firstTouch: 'firstTouchRevenue',
    lastTouch: 'lastTouchRevenue',
    timeDecay: 'timeDecayRevenue',
  };

  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);
  private readonly fb = inject(FormBuilder);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly selectedPeriod = input<string>('');
  public readonly foundationName = input<string>('');
  public readonly focusProgram = input<MarketingImpactFocusProgram>('all');
  // When a parent has already fetched the same attribution response (e.g. the
  // Overview tab, which also renders this section), it passes it in so we reuse
  // it instead of issuing a duplicate request. `undefined` means "self-fetch".
  public readonly attributionOverride = input<MarketingAttributionResponse | null | undefined>(undefined);
  // When using a parent override, the parent also passes its in-flight state so
  // we show the skeleton (not the empty state) while the parent request runs and
  // its override is still the initial/previous-period `null`.
  public readonly loadingOverride = input<boolean>(false);

  // === Forms ===
  protected readonly modelForm = this.fb.nonNullable.group({
    model: ['linear' as AttributionModel],
  });

  protected readonly modelOptions: AttributionModelOption[] = ATTRIBUTION_MODEL_OPTIONS;

  // === WritableSignals ===
  // Tracks the component's own fetch; the template reads `loading` (below), which
  // also folds in the parent's loadingOverride when running in override mode.
  private readonly selfLoading = signal(false);

  // === Computed Signals ===
  protected readonly attributionData: Signal<MarketingAttributionResponse | null> = this.initAttributionData();
  protected readonly selectedModel: Signal<AttributionModel> = this.initSelectedModel();
  protected readonly channelRows: Signal<AttributionChannelRow[]> = this.initChannelRows();
  protected readonly totalRevenue: Signal<string> = this.initTotalRevenue();
  protected readonly hasData = computed(() => this.channelRows().length > 0);
  // In override mode, defer to the parent's in-flight state; otherwise use our own.
  protected readonly loading = computed(() => (this.attributionOverride() !== undefined ? this.loadingOverride() : this.selfLoading()));

  // === Protected Methods ===
  /** Tooltip text describing what a consolidated channel groups; empty when no definition exists (no tooltip shown). */
  protected channelDescription(channel: string): string {
    return ATTRIBUTION_CHANNEL_DESCRIPTIONS[channel] ?? '';
  }

  // === Private Initializers ===
  private initAttributionData(): Signal<MarketingAttributionResponse | null> {
    const override$ = toObservable(this.attributionOverride);
    const slug$ = toObservable(this.foundationSlug);
    const focus$ = toObservable(this.focusProgram);
    const period$ = toObservable(this.selectedPeriod);

    return toSignal(
      combineLatest([override$, slug$, focus$, period$]).pipe(
        switchMap(([override, slug, focus, period]) => {
          // A parent-supplied response short-circuits our own fetch (no duplicate
          // query). Loading is driven by the parent's loadingOverride in this mode.
          if (override !== undefined) {
            this.selfLoading.set(false);
            return of(override);
          }
          if (!slug) {
            this.selfLoading.set(false);
            return of(null);
          }
          this.selfLoading.set(true);
          const classification = FOCUS_TO_CLASSIFICATION[focus];
          return this.analyticsService.getMarketingAttribution(slug, classification, period || undefined).pipe(
            catchError(() => of(null)),
            finalize(() => this.selfLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initSelectedModel(): Signal<AttributionModel> {
    return toSignal(this.modelForm.controls.model.valueChanges.pipe(startWith('linear' as AttributionModel)), {
      initialValue: 'linear' as AttributionModel,
    });
  }

  private initChannelRows(): Signal<AttributionChannelRow[]> {
    return computed(() => {
      const data = this.attributionData();
      const model = this.selectedModel();
      if (!data?.channels?.length) return [];

      const revenueKey = this.getRevenueKey(model);
      const total = data.channels.reduce((sum, ch) => sum + (ch[revenueKey] ?? 0), 0);

      return data.channels
        .map((ch): AttributionChannelRow => {
          const revenue = ch[revenueKey] ?? 0;
          return {
            channel: ch.channel,
            revenue,
            revenueFormatted: formatCurrency(revenue),
            sharePercent: total > 0 ? (revenue / total) * 100 : 0,
            sessions: ch.sessions,
            sessionsFormatted: formatNumber(ch.sessions),
            raw: ch,
          };
        })
        .sort((a, b) => b.revenue - a.revenue);
    });
  }

  private initTotalRevenue(): Signal<string> {
    return computed(() => {
      const rows = this.channelRows();
      const total = rows.reduce((sum, r) => sum + r.revenue, 0);
      return formatCurrency(total);
    });
  }

  // === Private Helpers ===
  private getRevenueKey(model: AttributionModel): 'linearRevenue' | 'firstTouchRevenue' | 'lastTouchRevenue' | 'timeDecayRevenue' {
    return AttributionSectionComponent.revenueKeyByModel[model];
  }
}
