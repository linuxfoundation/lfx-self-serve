// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import {
  GOOGLE_ADS_INCOME_RANGE_LABELS,
  GOOGLE_ADS_INCOME_RANGES,
  GOOGLE_ADS_OBSERVED_DEMOGRAPHIC_LABELS,
  GOOGLE_ADS_OBSERVED_DEMOGRAPHICS,
  GOOGLE_ADS_PARENTAL_STATUS_LABELS,
  GOOGLE_ADS_PARENTAL_STATUSES,
} from '@lfx-one/shared/constants';
import type {
  GoogleAdsIncomeRange,
  GoogleAdsObservedDemographic,
  GoogleAdsParentalStatus,
  GoogleDisplayDemographics,
  GoogleExclusionOptionView,
} from '@lfx-one/shared/interfaces';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';

import { CampaignGoogleDemographicTargetingComponent } from '../campaign-google-demographic-targeting/campaign-google-demographic-targeting.component';

/**
 * The Google campaign's ad-group demographics on the Implement tab: income-range and parental-status
 * exclusions (linuxfoundation/lfx-v2-campaign-service#473), Search's observed dimensions (#497) and
 * Display's positive targeting (#499). A sibling of `campaign-google-exclusions-panel`, on the same
 * contract: it renders straight from the lists it is given and writes every edit back through them,
 * and the tab owns the lists, the channel gates and the shared refusal the BFF refuses a create with.
 */
@Component({
  selector: 'lfx-campaign-google-demographics-panel',
  imports: [UiCheckboxComponent, CampaignGoogleDemographicTargetingComponent],
  templateUrl: './campaign-google-demographics-panel.component.html',
})
export class CampaignGoogleDemographicsPanelComponent {
  public readonly showIncomeExclusions = input.required<boolean>();
  public readonly showParentalExclusions = input.required<boolean>();
  public readonly showObserved = input.required<boolean>();
  public readonly showTargeting = input.required<boolean>();
  public readonly error = input<string | null>(null);

  public readonly excludedIncomeRanges = model.required<GoogleAdsIncomeRange[]>();
  public readonly excludedParentalStatuses = model.required<GoogleAdsParentalStatus[]>();
  public readonly observedDemographics = model.required<GoogleAdsObservedDemographic[]>();
  public readonly displayDemographics = model.required<GoogleDisplayDemographics>();

  protected readonly incomeRows: Signal<GoogleExclusionOptionView[]> = computed(() =>
    this.rows(GOOGLE_ADS_INCOME_RANGES, GOOGLE_ADS_INCOME_RANGE_LABELS, this.excludedIncomeRanges())
  );
  protected readonly parentalRows: Signal<GoogleExclusionOptionView[]> = computed(() =>
    this.rows(GOOGLE_ADS_PARENTAL_STATUSES, GOOGLE_ADS_PARENTAL_STATUS_LABELS, this.excludedParentalStatuses())
  );
  protected readonly observedRows: Signal<GoogleExclusionOptionView[]> = computed(() =>
    this.rows(GOOGLE_ADS_OBSERVED_DEMOGRAPHICS, GOOGLE_ADS_OBSERVED_DEMOGRAPHIC_LABELS, this.observedDemographics())
  );
  /** Whether any section is on show, so the always-mounted live region has a panel to belong to. */
  protected readonly anyShown: Signal<boolean> = computed(
    () => this.showIncomeExclusions() || this.showParentalExclusions() || this.showObserved() || this.showTargeting()
  );
  protected readonly describedBy: Signal<string> = computed(() =>
    this.error() === null ? 'google-ad-group-demographics-hint' : 'google-ad-group-demographics-hint google-ad-group-demographics-error'
  );

  protected onIncome(value: string, checked: boolean): void {
    this.excludedIncomeRanges.update((list) => this.toggled(list, value as GoogleAdsIncomeRange, checked));
  }

  protected onParental(value: string, checked: boolean): void {
    this.excludedParentalStatuses.update((list) => this.toggled(list, value as GoogleAdsParentalStatus, checked));
  }

  protected onObserved(value: string, checked: boolean): void {
    this.observedDemographics.update((list) => this.toggled(list, value as GoogleAdsObservedDemographic, checked));
  }

  private rows(values: readonly string[], labels: Readonly<Record<string, string>>, ticked: readonly string[]): GoogleExclusionOptionView[] {
    const set = new Set(ticked);
    return values.map((value) => ({ value, label: labels[value] ?? value, checked: set.has(value) }));
  }

  private toggled<T extends string>(list: T[], value: T, checked: boolean): T[] {
    const others = list.filter((entry) => entry !== value);
    return checked ? [...others, value] : others;
  }
}
