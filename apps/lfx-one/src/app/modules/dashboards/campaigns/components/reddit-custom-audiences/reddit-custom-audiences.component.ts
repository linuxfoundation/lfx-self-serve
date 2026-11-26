// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  MAX_REDDIT_CUSTOM_AUDIENCE_IDS,
  REDDIT_CUSTOM_AUDIENCE_LISTS,
  REDDIT_CUSTOM_AUDIENCE_PICKER_EMPTY,
  REDDIT_CUSTOM_AUDIENCE_PICKER_LOADING,
  REDDIT_CUSTOM_AUDIENCE_PICKER_REASONS,
  REDDIT_CUSTOM_AUDIENCE_PICKER_TRUNCATED,
} from '@lfx-one/shared/constants';
import type {
  MetaCustomAudienceChipView,
  RedditCustomAudienceListKey,
  RedditCustomAudienceListState,
  RedditCustomAudienceOption,
  RedditCustomAudiencePickerState,
  RedditCustomAudiencesDraft,
} from '@lfx-one/shared/interfaces';
import { redditCustomAudienceAddRefusal, redditCustomAudiencesDraftRefusal, redditCustomAudiencesPicked } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * Reddit custom audiences on the Implement tab (#6108 row 1), sent as `redditConfig.customAudienceIds` /
 * `excludedCustomAudienceIds`, only when `enabled` (the deployment sends them and the caller holds `global_marketing_ops`
 * on the project, because the Reddit ad account is shared by every foundation). Each box picks from the ad account's
 * audiences and also takes a typed id, which is the way in when the list cannot be read. Picks held without that answer
 * (a restored draft) stay listed with Remove, so the operator can clear the ones the parent holds Create for. The parent
 * owns the lists, validates the same lists and holds Create.
 */
@Component({
  selector: 'lfx-reddit-custom-audiences',
  imports: [UiComboboxComponent, UiOptionComponent],
  templateUrl: './reddit-custom-audiences.component.html',
})
export class RedditCustomAudiencesComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  public readonly enabled = input<boolean>(false);

  public readonly audiences = model.required<RedditCustomAudiencesDraft>();

  /** Why the last typed or picked audience was not added, or `null`. */
  protected readonly addError = signal<string | null>(null);

  protected readonly pickerEmpty = REDDIT_CUSTOM_AUDIENCE_PICKER_EMPTY;
  protected readonly pickerLoading = REDDIT_CUSTOM_AUDIENCE_PICKER_LOADING;
  protected readonly pickerTruncated = REDDIT_CUSTOM_AUDIENCE_PICKER_TRUNCATED;

  /** Why the lists cannot be sent, or `null`: the same rules the create route applies. */
  protected readonly refusal = computed<string | null>(() => redditCustomAudiencesDraftRefusal(this.audiences()));
  /** Whether either list holds a pick, which keeps the lists (and their Remove) on screen without the capability. */
  protected readonly hasPicks = computed<boolean>(() => redditCustomAudiencesPicked(this.audiences()));
  protected readonly picker: Signal<RedditCustomAudiencePickerState> = this.initPicker();
  /** Each listed audience's label, by id; a typed id the list does not hold shows as itself. */
  private readonly audienceLabels: Signal<Map<string, string>> = computed(
    () => new Map(this.picker().audiences.map((a) => [a.id, this.audienceLabel(a)] as const))
  );
  /** The listed audiences not yet in either list: the rows each box still offers. */
  protected readonly pickerOptions: Signal<MetaCustomAudienceChipView[]> = computed(() => {
    const { customAudienceIds, excludedCustomAudienceIds } = this.audiences();
    const taken = new Set([...customAudienceIds, ...excludedCustomAudienceIds]);
    const labels = this.audienceLabels();
    return this.picker()
      .audiences.filter((a) => !taken.has(a.id))
      .map((a) => ({ id: a.id, label: labels.get(a.id) ?? a.id }));
  });
  /** Both lists with their picks as chips. */
  protected readonly audienceLists: Signal<RedditCustomAudienceListState[]> = computed(() => {
    const held = this.audiences();
    const labels = this.audienceLabels();
    return REDDIT_CUSTOM_AUDIENCE_LISTS.map((list) => ({
      ...list,
      heading: `${list.label} (${held[list.key].length}/${MAX_REDDIT_CUSTOM_AUDIENCE_IDS})`,
      chips: held[list.key].map((id) => ({ id, label: labels.get(id) ?? id })),
    }));
  });

  /** Adds a picked or typed id to one list, refusing what the create would refuse (`redditCustomAudienceAddRefusal`), then clears the box. */
  protected onAddAudience(key: RedditCustomAudienceListKey, value: string | null, box: UiComboboxComponent): void {
    if (value === null) return;
    const id = value.trim();
    const held = this.audiences();
    const error = redditCustomAudienceAddRefusal(held, key, id);
    this.addError.set(error);
    if (error === null && !held[key].includes(id)) this.audiences.update((current) => ({ ...current, [key]: [...current[key], id] }));
    box.writeValue(null);
  }

  protected onRemoveAudience(key: RedditCustomAudienceListKey, id: string): void {
    this.audiences.update((current) => ({ ...current, [key]: current[key].filter((entry) => entry !== id) }));
  }

  /**
   * The ad account's audiences, read only while the boxes show. A failure keeps the boxes, which then take typed ids;
   * the boxes show only to a caller the route admits, so a 403 or 404 here is the deployment or the gateway and reads
   * as unavailable.
   */
  private initPicker(): Signal<RedditCustomAudiencePickerState> {
    const state = (status: RedditCustomAudiencePickerState['status'], reason: string | null = null): RedditCustomAudiencePickerState => ({
      status,
      audiences: [],
      truncated: false,
      reason,
    });
    const trigger = computed(() => ({ projectSlug: this.projectSlug(), shown: this.enabled() }));
    return toSignal(
      toObservable(trigger).pipe(
        switchMap(({ projectSlug, shown }) => {
          if (projectSlug === '' || !shown) return of(state('idle'));
          return this.campaignService.getRedditCustomAudiences(projectSlug).pipe(
            map((result): RedditCustomAudiencePickerState => ({ status: 'loaded', audiences: result.audiences, truncated: result.truncated, reason: null })),
            catchError((err: unknown) => {
              console.error('Failed to read the Reddit custom audiences:', err);
              const status = err instanceof HttpErrorResponse ? err.status : 0;
              const reason =
                status === 403 || status === 404 ? REDDIT_CUSTOM_AUDIENCE_PICKER_REASONS.unavailable : REDDIT_CUSTOM_AUDIENCE_PICKER_REASONS.failed;
              return of(state('unavailable', reason));
            }),
            startWith(state('loading'))
          );
        })
      ),
      { initialValue: state('idle') }
    );
  }

  private audienceLabel(audience: RedditCustomAudienceOption): string {
    const type = audience.type === '' ? '' : ` · ${audience.type.toLowerCase().replaceAll('_', ' ')}`;
    const upper = audience.sizeUpper;
    const size = upper === null ? '' : ` · up to ${upper.toLocaleString('en-US')} people`;
    return `${audience.name}${type}${size}`;
  }
}
