// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, model, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { LINKEDIN_TARGETING_EDITOR_FACETS, LINKEDIN_TARGETING_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import type {
  LinkedInTargetingEditorFacet,
  LinkedInTargetingEditorFacetOption,
  LinkedInTargetingEntity,
  LinkedInTargetingFacetPicks,
  LinkedInTargetingPlacement,
  LinkedInTargetingSearchFacet,
  LinkedInTargetingSearchState,
} from '@lfx-one/shared/interfaces';
import {
  linkedInGeoSearchQueryRefusal,
  linkedInGeoSearchQueryText,
  linkedInTargetingFacetsToAdd,
  linkedInTargetingPicksWith,
  linkedInTargetingPicksWithout,
  linkedInTargetingSearchChoices,
  linkedInTargetingSearchEmptyMessage,
  linkedInTargetingSearchFailure,
  linkedInTargetingStaticChoices,
} from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { catchError, map, of, startWith, switchMap, timer } from 'rxjs';

/**
 * One group of LinkedIn custom targeting (#5764 rows 8–11): an include clause or the exclusions. Shows the values
 * picked per facet as chips, and adds values to the facet chosen, by search or from a fixed list. The parent owns the
 * picks; the rules live in `campaign-linkedin-targeting-form.utils.ts`.
 */
@Component({
  selector: 'lfx-linkedin-targeting-facet-group',
  imports: [AutocompleteComponent, ReactiveFormsModule, UiOptionComponent, UiSelectComponent],
  templateUrl: './linkedin-targeting-facet-group.component.html',
})
export class LinkedInTargetingFacetGroupComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  public readonly placement = input<LinkedInTargetingPlacement>('include');
  /** The `data-testid` prefix of this group's elements. */
  public readonly testId = input.required<string>();

  public readonly picks = model.required<LinkedInTargetingFacetPicks>();

  /** The typeahead's control, cleared after a pick so the box reads "search another". */
  protected readonly searchForm = new FormGroup({ entity: new FormControl<unknown>(null) });
  /** The fixed-list picker's control, cleared after a pick. */
  protected readonly staticControl = new FormControl<string | null>(null);

  protected readonly facetsToAdd = computed<LinkedInTargetingEditorFacetOption[]>(() => linkedInTargetingFacetsToAdd(this.placement(), this.picks()));
  private readonly chosenFacet = signal<LinkedInTargetingEditorFacet | null>(null);
  /** The facet values are added to: the one chosen while it can still take values, else the first that can. */
  protected readonly facet = computed<LinkedInTargetingEditorFacetOption | null>(() => {
    const facets = this.facetsToAdd();
    return facets.find((facet) => facet.key === this.chosenFacet()) ?? facets[0] ?? null;
  });
  protected readonly chips = computed(() => {
    const picks = this.picks();
    return LINKEDIN_TARGETING_EDITOR_FACETS.filter((facet) => (picks[facet.key]?.length ?? 0) > 0).map((facet) => ({
      ...facet,
      picks: picks[facet.key] ?? [],
    }));
  });
  protected readonly staticChoices = computed<LinkedInTargetingEntity[]>(() => {
    const facet = this.facet();
    return facet && !facet.searchable ? linkedInTargetingStaticChoices(facet.key, this.picks()) : [];
  });

  /** The latest typed query; `equal: () => false` so a repeated query searches again after a failure. */
  private readonly query = signal<{ facet: LinkedInTargetingSearchFacet; text: string } | null>(null, { equal: () => false });
  private readonly search: Signal<LinkedInTargetingSearchState> = this.initSearch();

  protected readonly searchChoices = computed<LinkedInTargetingEntity[]>(() => {
    const facet = this.facet();
    const search = this.search();
    return facet && search.facet === facet.key ? linkedInTargetingSearchChoices(search.entities, this.picks()[facet.key]) : [];
  });
  protected readonly searchFailure = computed<string | null>(() => this.search().failure);
  protected readonly searchEmptyMessage = computed<string>(() => {
    const request = this.query();
    const search = this.search();
    return linkedInTargetingSearchEmptyMessage(request ? linkedInGeoSearchQueryRefusal(request.text) : null, search.pending, search.failure);
  });

  protected onFacetChange(key: string | null): void {
    this.chosenFacet.set(LINKEDIN_TARGETING_EDITOR_FACETS.find((facet) => facet.key === key)?.key ?? null);
    this.searchForm.controls.entity.setValue(null);
    this.staticControl.setValue(null, { emitEvent: false });
    this.query.set(null);
  }

  protected onSearch(event: AutoCompleteCompleteEvent): void {
    const facet = this.facet();
    if (facet?.searchable) this.query.set({ facet: facet.key as LinkedInTargetingSearchFacet, text: linkedInGeoSearchQueryText(event.query) });
  }

  protected onSearchSelect(event: AutoCompleteSelectEvent): void {
    this.add(event.value as LinkedInTargetingEntity | null);
    this.searchForm.controls.entity.setValue(null);
    this.query.set(null);
  }

  protected onSearchClear(): void {
    this.query.set(null);
  }

  protected onStaticPick(urn: string | null): void {
    this.add(this.staticChoices().find((choice) => choice.urn === urn) ?? null);
    this.staticControl.setValue(null, { emitEvent: false });
  }

  protected onRemove(facet: LinkedInTargetingEditorFacet, urn: string): void {
    this.picks.update((picks) => linkedInTargetingPicksWithout(picks, facet, urn));
  }

  private add(entity: LinkedInTargetingEntity | null): void {
    const facet = this.facet();
    if (entity && facet) this.picks.update((picks) => linkedInTargetingPicksWith(picks, facet.key, entity));
  }

  /**
   * The search behind the typed box. The project is read INSIDE the trigger, so a foundation switch cancels a search
   * mid-debounce instead of answering it for the previous project. Text the BFF would refuse is not sent.
   */
  private initSearch(): Signal<LinkedInTargetingSearchState> {
    const idle = (): LinkedInTargetingSearchState => ({ facet: null, entities: [], pending: false, failure: null });
    const trigger = computed(() => ({ request: this.query(), projectSlug: this.projectSlug() }));
    return toSignal(
      toObservable(trigger).pipe(
        switchMap(({ request, projectSlug }) => {
          if (request === null || projectSlug === '' || linkedInGeoSearchQueryRefusal(request.text) !== null) return of(idle());
          const { facet, text } = request;
          return timer(LINKEDIN_TARGETING_SEARCH_DEBOUNCE_MS).pipe(
            switchMap(() =>
              this.campaignService.searchLinkedInTargeting(projectSlug, facet, text).pipe(
                map((result): LinkedInTargetingSearchState => ({ facet, entities: result.entities, pending: false, failure: null })),
                catchError((err: unknown) => {
                  // The status only: the error's URL carries the typed search text.
                  const status = err instanceof HttpErrorResponse ? err.status : 0;
                  console.error('LinkedIn targeting search failed:', status);
                  return of<LinkedInTargetingSearchState>({ facet, entities: [], pending: false, failure: linkedInTargetingSearchFailure(status) });
                })
              )
            ),
            startWith<LinkedInTargetingSearchState>({ facet, entities: [], pending: true, failure: null })
          );
        })
      ),
      { initialValue: idle() }
    );
  }
}
