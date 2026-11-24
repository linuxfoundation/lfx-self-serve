// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, model, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { META_MAX_DETAILED_TARGETING_IDS, META_TARGETING_QUERY_MIN_LENGTH, META_TARGETING_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import type {
  MetaDetailedTargetingListView,
  MetaDetailedTargetingPicks,
  MetaTargetingKind,
  MetaTargetingSearchChoice,
  MetaTargetingSearchState,
  MetaTargetingSearchType,
} from '@lfx-one/shared/interfaces';
import {
  metaTargetingKindsShown,
  metaTargetingPicksWith,
  metaTargetingPicksWithout,
  metaTargetingSearchChoices,
  metaTargetingSearchEmptyMessage,
  metaTargetingSearchFailure,
  metaTargetingSearchQuery,
} from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { catchError, map, of, startWith, switchMap, timer } from 'rxjs';

/**
 * Meta detailed targeting on the Implement tab (#5904 row 4): interests, behaviors and job titles, each picked
 * from Meta's own taxonomy through `GET /api/campaigns/meta/targeting-search`. Interests show on the interest flag;
 * behaviors and job titles on the behavior flag. The parent owns the picks (with names, so a restored chip reads
 * the same), sends their ids as `metaConfig.targeting`, and holds Create. The rules live in
 * `campaign-meta-detailed-targeting.utils.ts`.
 */
@Component({
  selector: 'lfx-meta-detailed-targeting',
  imports: [AutocompleteComponent],
  templateUrl: './meta-detailed-targeting.component.html',
})
export class MetaDetailedTargetingComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  public readonly interestEnabled = input<boolean>(false);
  public readonly behaviorEnabled = input<boolean>(false);

  public readonly picks = model.required<MetaDetailedTargetingPicks>();

  protected readonly maxIds = META_MAX_DETAILED_TARGETING_IDS;
  /** The popup asks nothing before this many characters; text that trims shorter still gets its own message. */
  protected readonly minQueryLength = META_TARGETING_QUERY_MIN_LENGTH;
  /** One control per search box; each is cleared after a pick, so the box reads "search another". */
  protected readonly searchForm = new FormGroup({
    interest: new FormControl<unknown>(null),
    behavior: new FormControl<unknown>(null),
    work_position: new FormControl<unknown>(null),
  });

  private readonly kinds = computed(() => metaTargetingKindsShown({ interest: this.interestEnabled(), behavior: this.behaviorEnabled() }));
  /** The latest typed query and the box it came from; `equal: () => false` so a repeated query searches again after a failure. */
  private readonly query = signal<{ type: MetaTargetingSearchType; query: string } | null>(null, { equal: () => false });
  private readonly search: Signal<MetaTargetingSearchState> = this.initSearch();

  protected readonly lists = computed<MetaDetailedTargetingListView[]>(() => {
    const picks = this.picks();
    const search = this.search();
    const request = this.query();
    return this.kinds().map((kind) => {
      const answers = search.type === kind.type;
      const failure = answers ? search.failure : null;
      const refused = request !== null && request.type === kind.type && request.query === '';
      const choices = answers
        ? metaTargetingSearchChoices(search.options, picks[kind.key]).map((choice) => ({ ...choice, pathLabel: choice.path.join(' › ') }))
        : [];
      const emptyMessage = metaTargetingSearchEmptyMessage(refused, answers && search.pending, failure);
      return { ...kind, picks: picks[kind.key], choices, full: picks[kind.key].length >= META_MAX_DETAILED_TARGETING_IDS, emptyMessage, failure };
    });
  });

  protected onSearch(type: MetaTargetingSearchType, event: AutoCompleteCompleteEvent): void {
    this.query.set({ type, query: metaTargetingSearchQuery(event.query) });
  }

  protected onSelect(kind: MetaTargetingKind, event: AutoCompleteSelectEvent): void {
    const choice = event.value as MetaTargetingSearchChoice | null;
    if (choice && !choice.disabled) this.picks.update((picks) => ({ ...picks, [kind.key]: metaTargetingPicksWith(picks[kind.key], choice) }));
    this.searchForm.controls[kind.type].setValue(null);
    this.query.set(null);
  }

  protected onClear(): void {
    this.query.set(null);
  }

  protected onRemove(kind: MetaTargetingKind, id: string): void {
    this.picks.update((picks) => ({ ...picks, [kind.key]: metaTargetingPicksWithout(picks[kind.key], id) }));
  }

  /**
   * The search behind whichever box was typed in last. The project and the lists shown are read INSIDE the
   * trigger, so a foundation switch or a list going away cancels a search mid-debounce instead of answering it for
   * the previous project. A fresh idle object every time, as the geo search does, so PrimeNG never stays loading.
   */
  private initSearch(): Signal<MetaTargetingSearchState> {
    const idle = (): MetaTargetingSearchState => ({ type: null, options: [], pending: false, failure: null });
    const trigger = computed(() => ({ request: this.query(), projectSlug: this.projectSlug(), kinds: this.kinds() }));
    return toSignal(
      toObservable(trigger).pipe(
        switchMap(({ request, projectSlug, kinds }) => {
          if (request === null || request.query === '' || projectSlug === '' || !kinds.some((kind) => kind.type === request.type)) return of(idle());
          const { type, query } = request;
          return timer(META_TARGETING_SEARCH_DEBOUNCE_MS).pipe(
            switchMap(() =>
              this.campaignService.searchMetaTargetingOptions(projectSlug, type, query).pipe(
                map((result): MetaTargetingSearchState => ({ type, options: result.options, pending: false, failure: null })),
                catchError((err: unknown) => {
                  console.error('Meta targeting search failed:', err);
                  const status = err instanceof HttpErrorResponse ? err.status : 0;
                  return of<MetaTargetingSearchState>({ type, options: [], pending: false, failure: metaTargetingSearchFailure(status) });
                })
              )
            ),
            startWith<MetaTargetingSearchState>({ type, options: [], pending: true, failure: null })
          );
        })
      ),
      { initialValue: idle() }
    );
  }
}
