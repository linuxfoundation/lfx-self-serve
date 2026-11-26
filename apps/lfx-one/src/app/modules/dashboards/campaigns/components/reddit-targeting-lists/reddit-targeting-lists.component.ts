// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, model, signal, Signal } from '@angular/core';
import { REDDIT_TARGETING_LIST_LIMITS, REDDIT_TARGETING_LISTS } from '@lfx-one/shared/constants';
import type { RedditTargetingListKey, RedditTargetingListState, RedditTargetingListsDraft } from '@lfx-one/shared/interfaces';
import { redditTargetingListAddRefusal, redditTargetingListEntry, redditTargetingListHeld } from '@lfx-one/shared/utils';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';

/**
 * Editable Reddit subreddits and interests on the Implement tab (#6108 row 4), seeded from the brief. The parent shows
 * this only while campaign-service resolves both lists before creating anything (`redditTargetingResolutionEnabled`),
 * so an entry Reddit does not know is refused at Create by entry rather than dropped. Each box takes a typed name; the
 * parent owns the lists and keeps them in the draft once edited.
 */
@Component({
  selector: 'lfx-reddit-targeting-lists',
  imports: [UiComboboxComponent],
  templateUrl: './reddit-targeting-lists.component.html',
})
export class RedditTargetingListsComponent {
  public readonly lists = model.required<RedditTargetingListsDraft>();

  /** Why the last typed entry was not added, or `null`. */
  protected readonly addError = signal<string | null>(null);

  /** Both lists with their entries: the heading with the count against the cap. */
  protected readonly listStates: Signal<RedditTargetingListState[]> = computed(() => {
    const held = this.lists();
    return REDDIT_TARGETING_LISTS.map((list) => ({
      ...list,
      heading: `${list.label} (${held[list.key].length}/${REDDIT_TARGETING_LIST_LIMITS[list.key]})`,
      entries: held[list.key],
    }));
  });

  /** A subreddit as `r/name` (a brief may seed it with or without the prefix); an interest as held. */
  protected chipLabel(key: RedditTargetingListKey, entry: string): string {
    return key === 'subreddits' ? `r/${redditTargetingListEntry('subreddits', entry)}` : entry;
  }

  /** Adds a typed entry, refusing a blank one or a full list (`redditTargetingListAddRefusal`), then clears the box. */
  protected onAdd(key: RedditTargetingListKey, value: string | null, box: UiComboboxComponent): void {
    if (value === null) return;
    const entry = redditTargetingListEntry(key, value);
    const held = this.lists()[key];
    const error = redditTargetingListAddRefusal(held, key, entry);
    this.addError.set(error);
    if (error === null && !redditTargetingListHeld(held, entry)) this.lists.update((current) => ({ ...current, [key]: [...current[key], entry] }));
    box.writeValue(null);
  }

  protected onRemove(key: RedditTargetingListKey, entry: string): void {
    this.lists.update((current) => ({ ...current, [key]: current[key].filter((held) => held !== entry) }));
  }
}
