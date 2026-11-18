// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  META_ADVANTAGE_AUDIENCE_MAX_AGE_MIN,
  META_AUDIENCE_MAX_AGE,
  META_AUDIENCE_MIN_AGE,
  META_CUSTOM_AUDIENCE_ID_PATTERN,
  META_CUSTOM_AUDIENCE_LISTS,
  META_CUSTOM_AUDIENCE_PICKER_EMPTY,
  META_CUSTOM_AUDIENCE_PICKER_LOADING,
  META_CUSTOM_AUDIENCE_PICKER_REASONS,
  META_CUSTOM_AUDIENCE_PICKER_TRUNCATED,
  META_MAX_CUSTOM_AUDIENCES,
} from '@lfx-one/shared/constants';
import type {
  MetaAudienceGender,
  MetaAudienceTargetingDraft,
  MetaAudienceTargetingRefusal,
  MetaCustomAudienceListKey,
  MetaCustomAudienceOption,
  MetaCustomAudiencePickerState,
} from '@lfx-one/shared/interfaces';
import { metaAudienceTargetingRefusal } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * Meta ad set audience targeting on the Implement tab (#5905), sent as `metaConfig.targeting`: an age
 * range, gender and Advantage+ audience for every campaign manager, and included/excluded custom
 * audiences only when `customAudiencesEnabled` (the caller holds `global_marketing_ops` on the project,
 * because the Meta ad account is shared by every foundation). Each custom-audience box picks from the ad
 * account's audiences and also takes a typed id, which is the way in when the list cannot be read. The
 * parent owns the draft, compacts it for the request and holds Create on {@link refusal}.
 */
@Component({
  selector: 'lfx-meta-audience-targeting',
  imports: [UiCheckboxComponent, UiComboboxComponent, UiOptionComponent, UiSelectComponent],
  templateUrl: './meta-audience-targeting.component.html',
})
export class MetaAudienceTargetingComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  public readonly customAudiencesEnabled = input<boolean>(false);

  public readonly targeting = model.required<MetaAudienceTargetingDraft>();

  /** Why the last typed or picked audience was not added, or `null`. */
  protected readonly addError = signal<string | null>(null);

  protected readonly ages: string[] = Array.from({ length: META_AUDIENCE_MAX_AGE - META_AUDIENCE_MIN_AGE + 1 }, (_, i) => String(META_AUDIENCE_MIN_AGE + i));
  protected readonly audienceLists = META_CUSTOM_AUDIENCE_LISTS;
  protected readonly maxAudiences = META_MAX_CUSTOM_AUDIENCES;
  protected readonly advantageMaxAgeMin = META_ADVANTAGE_AUDIENCE_MAX_AGE_MIN;
  protected readonly pickerEmpty = META_CUSTOM_AUDIENCE_PICKER_EMPTY;
  protected readonly pickerLoading = META_CUSTOM_AUDIENCE_PICKER_LOADING;
  protected readonly pickerTruncated = META_CUSTOM_AUDIENCE_PICKER_TRUNCATED;

  /** Why the targeting cannot be sent, or `null`: the same rules the create route applies. */
  protected readonly refusal: Signal<MetaAudienceTargetingRefusal | null> = computed(() => metaAudienceTargetingRefusal(this.targeting()));
  protected readonly picker: Signal<MetaCustomAudiencePickerState> = this.initPicker();
  /** The listed audiences not yet in either list: the rows each box still offers. */
  protected readonly pickerOptions: Signal<MetaCustomAudienceOption[]> = computed(() => {
    const { customAudiences, excludedCustomAudiences } = this.targeting();
    const taken = new Set([...customAudiences, ...excludedCustomAudiences]);
    return this.picker().audiences.filter((a) => !taken.has(a.id));
  });
  /** Each listed audience's label, by id; a typed id the list does not hold shows as itself. */
  protected readonly audienceLabels: Signal<Map<string, string>> = computed(
    () => new Map(this.picker().audiences.map((a) => [a.id, this.audienceLabel(a)] as const))
  );

  protected onAge(key: 'ageMin' | 'ageMax', value: string | null): void {
    const age = Number(value);
    if (value !== null && Number.isInteger(age)) this.targeting.update((t) => ({ ...t, [key]: age }));
  }

  protected onGender(gender: MetaAudienceGender, checked: boolean): void {
    this.targeting.update((t) => {
      const others = t.genders.filter((g) => g !== gender);
      return { ...t, genders: checked ? [...others, gender] : others };
    });
  }

  protected onAdvantage(checked: boolean): void {
    this.targeting.update((t) => ({ ...t, advantageAudience: checked }));
  }

  /** Adds a picked or typed id to one list, refusing what the create would refuse, then clears the box. */
  protected onAddAudience(key: MetaCustomAudienceListKey, value: string | null, box: UiComboboxComponent): void {
    if (value === null) return;
    const id = value.trim();
    const t = this.targeting();
    const other = key === 'customAudiences' ? t.excludedCustomAudiences : t.customAudiences;
    let error: string | null = null;
    if (!META_CUSTOM_AUDIENCE_ID_PATTERN.test(id)) error = 'Enter a Meta custom audience id: digits, without a leading zero.';
    else if (other.includes(id)) error = `Audience ${id} is already in the other list; an audience cannot be both included and excluded.`;
    else if (!t[key].includes(id) && t[key].length >= META_MAX_CUSTOM_AUDIENCES) error = `At most ${META_MAX_CUSTOM_AUDIENCES} audiences per list.`;
    this.addError.set(error);
    if (error === null && !t[key].includes(id)) this.targeting.update((current) => ({ ...current, [key]: [...current[key], id] }));
    box.writeValue(null);
  }

  protected onRemoveAudience(key: MetaCustomAudienceListKey, id: string): void {
    this.targeting.update((t) => ({ ...t, [key]: t[key].filter((entry) => entry !== id) }));
  }

  /**
   * The ad account's audiences, read only while the boxes show. A failure keeps the boxes, which then
   * take typed ids; the section shows only to a caller the route admits, so a 403 or 404 here is the
   * deployment or the gateway and reads as unavailable.
   */
  private initPicker(): Signal<MetaCustomAudiencePickerState> {
    const state = (status: MetaCustomAudiencePickerState['status'], reason: string | null = null): MetaCustomAudiencePickerState => ({
      status,
      audiences: [],
      truncated: false,
      reason,
    });
    const trigger = computed(() => ({ projectSlug: this.projectSlug(), shown: this.customAudiencesEnabled() }));
    return toSignal(
      toObservable(trigger).pipe(
        switchMap(({ projectSlug, shown }) => {
          if (projectSlug === '' || !shown) return of(state('idle'));
          return this.campaignService.getMetaCustomAudiences(projectSlug).pipe(
            map((result): MetaCustomAudiencePickerState => ({ status: 'loaded', audiences: result.audiences, truncated: result.truncated, reason: null })),
            catchError((err: unknown) => {
              console.error('Failed to read the Meta custom audiences:', err);
              const status = err instanceof HttpErrorResponse ? err.status : 0;
              const reason = status === 403 || status === 404 ? META_CUSTOM_AUDIENCE_PICKER_REASONS.unavailable : META_CUSTOM_AUDIENCE_PICKER_REASONS.failed;
              return of(state('unavailable', reason));
            }),
            startWith(state('loading'))
          );
        })
      ),
      { initialValue: state('idle') }
    );
  }

  private audienceLabel(audience: MetaCustomAudienceOption): string {
    const subtype = audience.subtype === '' ? '' : ` · ${audience.subtype.toLowerCase()}`;
    const upper = audience.approximateCountUpperBound;
    const size = upper === null ? '' : ` · up to ${upper.toLocaleString('en-US')} people`;
    return `${audience.name}${subtype}${size}`;
  }
}
