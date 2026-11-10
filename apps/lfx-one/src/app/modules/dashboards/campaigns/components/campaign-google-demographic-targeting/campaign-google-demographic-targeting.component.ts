// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import {
  GOOGLE_ADS_AGE_RANGE_LABELS,
  GOOGLE_ADS_AGE_RANGES,
  GOOGLE_ADS_GENDER_LABELS,
  GOOGLE_ADS_GENDERS,
  GOOGLE_ADS_INCOME_RANGE_LABELS,
  GOOGLE_ADS_INCOME_RANGES,
  GOOGLE_ADS_PARENTAL_STATUS_LABELS,
  GOOGLE_ADS_PARENTAL_STATUSES,
} from '@lfx-one/shared/constants';
import type { GoogleDemographicTargetingGroupView, GoogleDisplayDemographics, GoogleExclusionOptionView } from '@lfx-one/shared/interfaces';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';

/**
 * Positive demographic targeting as four groups of checkboxes — age, gender, household income and
 * parental status — each ticked value one the ad group narrows to. Shared by Display's targeting in
 * `lfx-campaign-google-demographics-panel` (linuxfoundation/lfx-v2-campaign-service#499) and a Demand Gen
 * ad group's demographics on the Implement tab (#498, #518), which take the same four lists. It renders
 * straight from the object it is given and writes every tick back through it; the caller owns the
 * object, its legend and the refusal.
 */
@Component({
  selector: 'lfx-campaign-google-demographic-targeting',
  imports: [UiCheckboxComponent],
  templateUrl: './campaign-google-demographic-targeting.component.html',
})
export class CampaignGoogleDemographicTargetingComponent {
  public readonly legend = input.required<string>();
  /** The outer fieldset's test id; each group's is `optionTestIdPrefix` + its key, and each box's adds `-` + its value. */
  public readonly testId = input.required<string>();
  public readonly optionTestIdPrefix = input.required<string>();
  public readonly describedBy = input<string | null>(null);

  public readonly targeting = model.required<GoogleDisplayDemographics>();

  protected readonly groups: Signal<GoogleDemographicTargetingGroupView[]> = computed(() => {
    const target = this.targeting();
    return [
      { key: 'ageRanges', legend: 'Age', rows: this.rows(GOOGLE_ADS_AGE_RANGES, GOOGLE_ADS_AGE_RANGE_LABELS, target.ageRanges ?? []) },
      { key: 'genders', legend: 'Gender', rows: this.rows(GOOGLE_ADS_GENDERS, GOOGLE_ADS_GENDER_LABELS, target.genders ?? []) },
      { key: 'incomeRanges', legend: 'Household income', rows: this.rows(GOOGLE_ADS_INCOME_RANGES, GOOGLE_ADS_INCOME_RANGE_LABELS, target.incomeRanges ?? []) },
      {
        key: 'parentalStatuses',
        legend: 'Parental status',
        rows: this.rows(GOOGLE_ADS_PARENTAL_STATUSES, GOOGLE_ADS_PARENTAL_STATUS_LABELS, target.parentalStatuses ?? []),
      },
    ];
  });

  protected onTarget(key: keyof GoogleDisplayDemographics, value: string, checked: boolean): void {
    this.targeting.update((target) => {
      const others = (target[key] ?? []).filter((entry: string) => entry !== value);
      return { ...target, [key]: checked ? [...others, value] : others };
    });
  }

  private rows(values: readonly string[], labels: Readonly<Record<string, string>>, ticked: readonly string[]): GoogleExclusionOptionView[] {
    const set = new Set(ticked);
    return values.map((value) => ({ value, label: labels[value] ?? value, checked: set.has(value) }));
  }
}
