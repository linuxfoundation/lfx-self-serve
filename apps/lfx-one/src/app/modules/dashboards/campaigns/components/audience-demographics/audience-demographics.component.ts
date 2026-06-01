// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Subscription } from 'rxjs';
import { CampaignService } from '@services/campaign.service';

import type { AudienceBucket, AudienceDemographics } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-audience-demographics',
  imports: [],
  templateUrl: './audience-demographics.component.html',
  styleUrl: './audience-demographics.component.scss',
})
export class AudienceDemographicsComponent {
  // === Services ===
  private readonly campaignService = inject(CampaignService);
  private readonly destroyRef = inject(DestroyRef);
  private audienceSub: Subscription | null = null;

  // === Inputs ===
  public readonly days = input(30);

  // === WritableSignals ===
  protected readonly loading = signal(false);
  protected readonly data = signal<AudienceDemographics | null>(null);

  // === Computed Signals ===
  protected readonly hasData = computed(() => !!this.data());
  protected readonly ageBuckets = computed(() => this.data()?.age ?? []);
  protected readonly genderBuckets = computed(() => this.data()?.gender ?? []);
  protected readonly deviceBuckets = computed(() => this.data()?.device ?? []);
  protected readonly pulledAt = computed(() => this.data()?.pulledAt ?? '');

  // === Effects ===
  private readonly fetchOnDaysChange = effect(() => {
    const days = this.days();
    this.refresh(days);
  });

  // === Protected Methods ===
  protected refresh(days?: number): void {
    this.audienceSub?.unsubscribe();
    this.loading.set(true);
    this.audienceSub = this.campaignService
      .getAudience(days ?? this.days())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.data.set(result);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  protected barWidthPct(bucket: AudienceBucket, buckets: AudienceBucket[]): number {
    const maxImpressions = Math.max(...buckets.map((b) => b.impressions), 1);
    return (bucket.impressions / maxImpressions) * 100;
  }

  protected formatNumber(value: number): string {
    return value.toLocaleString('en-US');
  }

  protected formatPct(value: number): string {
    return `${value.toFixed(2)}%`;
  }

  protected formatCurrency(value: number): string {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
