// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { ATTRIBUTION_MODEL_OPTIONS } from '@lfx-one/shared/constants';
import { formatCurrency, formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { catchError, finalize, of, startWith, switchMap } from 'rxjs';

import type { AttributionChannelRow, AttributionModel, AttributionModelOption, MarketingAttributionResponse } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-attribution-section',
  imports: [DecimalPipe, ReactiveFormsModule, SelectComponent, ButtonComponent],
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
  public readonly foundationName = input<string>('');

  // === Forms ===
  protected readonly modelForm = this.fb.nonNullable.group({
    model: ['linear' as AttributionModel],
  });

  protected readonly modelOptions: AttributionModelOption[] = ATTRIBUTION_MODEL_OPTIONS;

  // === WritableSignals ===
  protected readonly loading = signal(false);

  // === Computed Signals ===
  protected readonly attributionData: Signal<MarketingAttributionResponse | null> = this.initAttributionData();
  protected readonly selectedModel: Signal<AttributionModel> = this.initSelectedModel();
  protected readonly channelRows: Signal<AttributionChannelRow[]> = this.initChannelRows();
  protected readonly totalRevenue: Signal<string> = this.initTotalRevenue();
  protected readonly hasData = computed(() => this.channelRows().length > 0);

  // === Private Initializers ===
  private initAttributionData(): Signal<MarketingAttributionResponse | null> {
    const slug$ = toObservable(this.foundationSlug);

    return toSignal(
      slug$.pipe(
        switchMap((slug) => {
          if (!slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          return this.analyticsService.getMarketingAttribution(slug).pipe(
            catchError(() => of(null)),
            finalize(() => this.loading.set(false))
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
