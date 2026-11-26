// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, signal, Signal } from '@angular/core';
import { COUNTRIES, REDDIT_TARGETING_EXCLUSION_LIMITS, REDDIT_TARGETING_EXCLUSION_LISTS } from '@lfx-one/shared/constants';
import type {
  MetaCustomAudienceChipView,
  RedditTargetedLists,
  RedditTargetingExclusionKey,
  RedditTargetingExclusionListState,
  RedditTargetingExclusionsDraft,
} from '@lfx-one/shared/interfaces';
import {
  redditTargetingExclusionAddRefusal,
  redditTargetingExclusionEntry,
  redditTargetingExclusionHeld,
  redditTargetingExclusionsDraftRefusal,
  redditTargetingExclusionsPicked,
} from '@lfx-one/shared/utils';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';

/**
 * Reddit excluded communities and countries on the Implement tab (#6108 row 3), sent as `redditConfig.excludedSubreddits`
 * / `excludedGeoTargets` only when `enabled` (the deployment sends them). The community box takes typed names; the
 * country box picks from the country list and also takes a typed code. Entries held without that answer (a restored
 * draft) stay listed with Remove, so the operator can clear the ones the parent holds Create for. The parent owns the
 * lists, validates them against the targeting it sends and holds Create.
 */
@Component({
  selector: 'lfx-reddit-targeting-exclusions',
  imports: [UiComboboxComponent, UiOptionComponent],
  templateUrl: './reddit-targeting-exclusions.component.html',
})
export class RedditTargetingExclusionsComponent {
  public readonly enabled = input<boolean>(false);
  /** The subreddits and geo targets the create sends, which an entry must not overlap. */
  public readonly targeted = input<RedditTargetedLists>({ subreddits: [], geoTargets: [] });

  public readonly exclusions = model.required<RedditTargetingExclusionsDraft>();

  /** Why the last typed or picked entry was not added, or `null`. */
  protected readonly addError = signal<string | null>(null);

  /** Why the lists cannot be sent with the current targeting, or `null`: the same rules the create route applies. */
  protected readonly refusal = computed<string | null>(() => redditTargetingExclusionsDraftRefusal(this.exclusions(), this.targeted()));
  /** Whether either list holds an entry, which keeps the lists (and their Remove) on screen without the capability. */
  protected readonly hasEntries = computed<boolean>(() => redditTargetingExclusionsPicked(this.exclusions()));
  /** The countries not yet excluded, as the country box offers them. */
  protected readonly countryOptions: Signal<MetaCustomAudienceChipView[]> = computed(() => {
    const held = new Set(this.exclusions().excludedGeoTargets);
    return COUNTRIES.filter((c) => !held.has(c.value)).map((c) => ({ id: c.value, label: `${c.label} (${c.value})` }));
  });
  /** Both lists with their entries as chips: subreddits as `r/name`, countries by name. */
  protected readonly lists: Signal<RedditTargetingExclusionListState[]> = computed(() => {
    const held = this.exclusions();
    const names = new Map<string, string>(COUNTRIES.map((c) => [c.value, c.label]));
    return REDDIT_TARGETING_EXCLUSION_LISTS.map((list) => ({
      ...list,
      heading: `${list.label} (${held[list.key].length}/${REDDIT_TARGETING_EXCLUSION_LIMITS[list.key]})`,
      chips: held[list.key].map((entry) => ({ id: entry, label: list.key === 'excludedSubreddits' ? `r/${entry}` : (names.get(entry) ?? entry) })),
    }));
  });

  /** Adds a typed or picked entry to one list, refusing what the create would refuse (`redditTargetingExclusionAddRefusal`), then clears the box. */
  protected onAdd(key: RedditTargetingExclusionKey, value: string | null, box: UiComboboxComponent): void {
    if (value === null) return;
    const entry = redditTargetingExclusionEntry(key, value);
    const held = this.exclusions();
    const error = redditTargetingExclusionAddRefusal(held, key, entry, this.targeted());
    this.addError.set(error);
    if (error === null && !redditTargetingExclusionHeld(held, key, entry)) {
      this.exclusions.update((current) => ({ ...current, [key]: [...current[key], entry] }));
    }
    box.writeValue(null);
  }

  protected onRemove(key: RedditTargetingExclusionKey, entry: string): void {
    this.exclusions.update((current) => ({ ...current, [key]: current[key].filter((held) => held !== entry) }));
  }
}
