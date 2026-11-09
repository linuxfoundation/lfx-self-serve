// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, ElementRef, input, model, signal, Signal, viewChild } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import {
  GOOGLE_ADS_AGE_RANGE_LABELS,
  GOOGLE_ADS_AGE_RANGES,
  GOOGLE_ADS_GENDER_LABELS,
  GOOGLE_ADS_GENDERS,
  GOOGLE_ADS_GEO_TARGET_MAP,
  GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS,
  googleAdsTrimSpace,
} from '@lfx-one/shared/constants';
import type { GoogleAdsAgeRange, GoogleAdsGender, GoogleExclusionOptionView, UiFocusable } from '@lfx-one/shared/interfaces';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';
import { UiChipGroupComponent } from '@shared/uikit/chip/chip-group.component';
import { UiChipComponent } from '@shared/uikit/chip/chip.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiMultiSelectComponent } from '@shared/uikit/multi-select/multi-select.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';

/**
 * The Google campaign's demographic exclusions and excluded locations on the Implement tab (#4991).
 *
 * A sibling of `campaign-google-targeting-panel` rather than two more sections in it: these are the
 * campaign's negative criteria, each gated on its own channel set, and the targeting panel's inputs
 * and errors are all about the schedule and the bid. Same contract as that panel, though: it renders
 * straight from the lists it is given and writes every edit back through them, and the tab owns the
 * lists — the draft, the reset for a new brief, the channel gate and the shared refusals
 * (`googleExcludedAgeRangesRefusal`, `googleExcludedGendersRefusal`, `googleExcludedGeoListRefusal`)
 * the BFF refuses a create with. The one value held here is the text typed into the geo target id
 * box before it is added, which is not part of any list yet.
 */
@Component({
  selector: 'lfx-campaign-google-exclusions-panel',
  imports: [ButtonComponent, UiCheckboxComponent, UiChipComponent, UiChipGroupComponent, UiInputComponent, UiMultiSelectComponent, UiOptionComponent],
  templateUrl: './campaign-google-exclusions-panel.component.html',
})
export class CampaignGoogleExclusionsPanelComponent {
  public readonly showDemographics = input.required<boolean>();
  public readonly showExcludedGeos = input.required<boolean>();
  public readonly demographicsError = input<string | null>(null);
  public readonly excludedGeosError = input<string | null>(null);

  public readonly excludedAgeRanges = model.required<GoogleAdsAgeRange[]>();
  public readonly excludedGenders = model.required<GoogleAdsGender[]>();
  public readonly excludedGeoTargets = model.required<string[]>();

  /** The geo target id typed but not yet added. */
  protected readonly geoIdDraft = signal('');
  private readonly geoIdInput = viewChild('geoIdInput', { read: ElementRef<HTMLElement> });
  /**
   * The chip group's `fallbackFocus`: removing the LAST excluded location unmounts the group, so focus
   * goes to the geo target id box, which stays, rather than falling to the page body.
   */
  protected readonly geoIdFocus: UiFocusable = { focus: () => this.geoIdInput()?.nativeElement.querySelector('input')?.focus() };

  protected readonly maxExcludedGeos = GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS;
  /** The same closed country list the targeted-countries select offers: upstream resolves a code only through this map. */
  protected readonly countryOptions = Object.keys(GOOGLE_ADS_GEO_TARGET_MAP).sort();

  protected readonly ageRangeRows: Signal<GoogleExclusionOptionView[]> = computed(() => {
    const ticked = new Set<string>(this.excludedAgeRanges());
    return GOOGLE_ADS_AGE_RANGES.map((range) => ({ value: range, label: GOOGLE_ADS_AGE_RANGE_LABELS[range] ?? range, checked: ticked.has(range) }));
  });
  protected readonly genderRows: Signal<GoogleExclusionOptionView[]> = computed(() => {
    const ticked = new Set<string>(this.excludedGenders());
    return GOOGLE_ADS_GENDERS.map((gender) => ({ value: gender, label: GOOGLE_ADS_GENDER_LABELS[gender], checked: ticked.has(gender) }));
  });
  /** The excluded entries the country picker shows as picked; the rest of the list is geo target ids (or text the shared judge refuses). */
  protected readonly excludedCountries: Signal<string[]> = computed(() => this.excludedGeoTargets().filter((entry) => this.isCountry(entry)));
  protected readonly geoIdDraftBlank: Signal<boolean> = computed(() => googleAdsTrimSpace(this.geoIdDraft()) === '');
  /** `aria-describedby` for each section: its hint, plus its error while there is one. */
  protected readonly demographicsDescribedBy: Signal<string> = computed(() =>
    this.demographicsError() === null ? 'google-demographics-hint' : 'google-demographics-hint google-demographics-error'
  );
  protected readonly excludedGeosDescribedBy: Signal<string> = computed(() =>
    this.excludedGeosError() === null ? 'google-excluded-geos-hint' : 'google-excluded-geos-hint google-excluded-geos-error'
  );

  protected onAgeRange(range: string, checked: boolean): void {
    this.excludedAgeRanges.update((list) => this.toggled(list, range as GoogleAdsAgeRange, checked));
  }

  protected onGender(gender: string, checked: boolean): void {
    this.excludedGenders.update((list) => this.toggled(list, gender as GoogleAdsGender, checked));
  }

  /** Countries first, then every other entry as it was, the order the targeted list keeps. */
  protected onExcludedCountries(countries: string[]): void {
    this.excludedGeoTargets.update((list) => [...countries, ...list.filter((entry) => !this.isCountry(entry))]);
  }

  /**
   * Adds the typed id, trimmed and upper-cased as the request normalizes it. Anything that is not a
   * canonical geo target id is still added, so the shared refusal names what is wrong with it and
   * Create waits, rather than the box silently ignoring the click. A repeat is not added twice.
   */
  protected addGeoId(): void {
    const entry = googleAdsTrimSpace(this.geoIdDraft()).toUpperCase();
    if (entry === '') return;
    if (!this.excludedGeoTargets().includes(entry)) this.excludedGeoTargets.update((list) => [...list, entry]);
    this.geoIdDraft.set('');
  }

  protected removeExcludedGeo(entry: string): void {
    this.excludedGeoTargets.update((list) => list.filter((e) => e !== entry));
  }

  private isCountry(entry: string): boolean {
    return Object.hasOwn(GOOGLE_ADS_GEO_TARGET_MAP, entry);
  }

  private toggled<T extends string>(list: T[], value: T, checked: boolean): T[] {
    const others = list.filter((entry) => entry !== value);
    return checked ? [...others, value] : others;
  }
}
