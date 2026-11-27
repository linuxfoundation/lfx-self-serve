// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, signal, Signal } from '@angular/core';
import { REDDIT_MAX_SUBCOUNTRY_GEO_TARGETS } from '@lfx-one/shared/constants';
import type { MetaCustomAudienceChipView } from '@lfx-one/shared/interfaces';
import { redditSubCountryGeoAddRefusal, redditSubCountryGeoEntry, redditSubCountryGeoLabel } from '@lfx-one/shared/utils';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';

/**
 * Reddit regions, cities and DMAs on the Implement tab (#6108 row 7), typed as Reddit geolocation ids (`US-CA`,
 * `CA:6167865`, `662`) and sent as `redditConfig.subCountryGeoTargets`. campaign-service has no geolocation search read,
 * so the ids are typed and their shape checked here; Reddit confirms each one when the campaign is created. The parent
 * shows this only while the deployment sends them (`redditSubCountryGeoEnabled`), owns the list, keeps it in the draft,
 * drops each location's country from the geo targets it sends, and holds Create on `refusal`.
 */
@Component({
  selector: 'lfx-reddit-subcountry-geo',
  imports: [UiComboboxComponent],
  templateUrl: './reddit-subcountry-geo.component.html',
})
export class RedditSubCountryGeoComponent {
  /** The countries the create excludes, which no location may lie in. */
  public readonly excludedGeoTargets = input<string[]>([]);
  /** Why the held list cannot be sent with the current geo targets and exclusions (`redditSubCountryGeoDraftRefusal`), or `null`. */
  public readonly refusal = input<string | null>(null);
  public readonly locations = model.required<string[]>();

  /** Why the last typed id was not added, or `null`. */
  protected readonly addError = signal<string | null>(null);
  protected readonly heading = computed<string>(() => `Regions, cities and DMAs (${this.locations().length}/${REDDIT_MAX_SUBCOUNTRY_GEO_TARGETS})`);
  protected readonly chips: Signal<MetaCustomAudienceChipView[]> = computed(() => this.locations().map((id) => ({ id, label: redditSubCountryGeoLabel(id) })));

  /** Adds a typed id, refusing what the create would refuse (`redditSubCountryGeoAddRefusal`), then clears the box. */
  protected onAdd(value: string | null, box: UiComboboxComponent): void {
    if (value === null) return;
    const entry = redditSubCountryGeoEntry(value);
    const held = this.locations();
    const error = redditSubCountryGeoAddRefusal(held, entry, this.excludedGeoTargets());
    this.addError.set(error);
    if (error === null && !held.includes(entry)) this.locations.set([...held, entry]);
    box.writeValue(null);
  }

  protected onRemove(id: string): void {
    this.addError.set(null);
    this.locations.update((held) => held.filter((entry) => entry !== id));
  }
}
