// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
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
  public readonly projectSlug = input('');

  // === WritableSignals ===
  protected readonly loading = signal(false);
  protected readonly data = signal<AudienceDemographics | null>(null);
  protected readonly error = signal<string | null>(null);

  // === Computed Signals ===
  // At least one BUCKET, not merely a non-null response. The cutover returns a valid
  // `{ age: [], gender: [], device: [] }` for a project campaign-service knows no campaigns for,
  // and `!!this.data()` is true for that -- so the empty state never rendered and the operator got
  // three blank cards instead of "No audience data" (Copilot).
  protected readonly hasData = computed(() => {
    const d = this.data();
    return !!d && (d.age.length > 0 || d.gender.length > 0 || d.device.length > 0);
  });
  protected readonly ageBuckets = computed(() => this.data()?.age ?? []);
  protected readonly genderBuckets = computed(() => this.data()?.gender ?? []);
  protected readonly deviceBuckets = computed(() => this.data()?.device ?? []);
  protected readonly pulledAt = computed(() => this.data()?.pulledAt ?? '');

  private readonly refreshInputs = computed(() => ({ days: this.days(), projectSlug: this.projectSlug() }));

  public constructor() {
    // toObservable + subscribe per frontend-checklist §5 ("No effect() — use toObservable() with
    // RxJS pipes instead") — mirrors the pattern already used for foundation-switch refetches in
    // the sibling campaign tabs (e.g. monitoring-tab.component.ts).
    toObservable(this.refreshInputs)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ days }) => this.refresh(days));
  }

  // === Protected Methods ===
  protected refresh(days?: number): void {
    this.audienceSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.data.set(null);
    this.audienceSub = this.campaignService
      .getAudience(this.projectSlug(), days ?? this.days())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.data.set(result);
          this.error.set(null);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          const httpErr = err as { error?: { message?: string }; message?: string };
          // `extractErrorMessage`, for the reason the sibling campaign loaders now carry:
          // BaseApiError.toResponse serialises operator text as `{ error: string }`, so
          // `.error.message` is undefined here and the operator saw Angular's generic "Http
          // failure response" instead of the upstream reason. This loader was the one my earlier
          // sweep of the two tabs missed -- it lives in its own component (Copilot).
          this.error.set(extractErrorMessage(httpErr, 'Failed to load audience data'));
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
}
