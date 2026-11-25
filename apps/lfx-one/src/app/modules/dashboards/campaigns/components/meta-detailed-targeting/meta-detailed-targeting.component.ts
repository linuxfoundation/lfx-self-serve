// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, model, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { META_TARGETING_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import type {
  MetaDetailedTargetingListView,
  MetaDetailedTargetingPicks,
  MetaTargetingBox,
  MetaTargetingPickKey,
  MetaTargetingSearchChoice,
  MetaTargetingSearchState,
  MetaTargetingSearchType,
} from '@lfx-one/shared/interfaces';
import {
  metaTargetingBoxChoices,
  metaTargetingBoxesShown,
  metaTargetingBoxPicks,
  metaTargetingPicksAdd,
  metaTargetingPicksWithout,
  metaTargetingSearchEmptyMessage,
  metaTargetingSearchFailure,
  metaTargetingSearchQuery,
} from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { catchError, map, of, startWith, switchMap, timer } from 'rxjs';

/**
 * Meta detailed targeting on the Implement tab: interests, behaviors, job titles and languages (#5904 row 4), and
 * regions and cities (row 6), each picked from Meta's own answers through `GET /api/campaigns/meta/targeting-search`.
 * Each box shows on its own flag: interests on the interest flag, behaviors and job titles on the behavior flag,
 * languages on the locale flag, and one location box, whose rows are regions or cities, on the region flag. The
 * parent owns the picks (with names, so a restored chip reads the same), sends them as `metaConfig.targeting`, and
 * holds Create. The rules live in `campaign-meta-detailed-targeting.utils.ts`.
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
  public readonly localeEnabled = input<boolean>(false);
  public readonly regionEnabled = input<boolean>(false);

  public readonly picks = model.required<MetaDetailedTargetingPicks>();

  /** One control per search box; each is cleared after a pick, so the box reads "search another". */
  protected readonly searchForm = new FormGroup({
    interest: new FormControl<unknown>(null),
    behavior: new FormControl<unknown>(null),
    work_position: new FormControl<unknown>(null),
    locale: new FormControl<unknown>(null),
    location: new FormControl<unknown>(null),
  });

  private readonly boxes = computed(() =>
    metaTargetingBoxesShown({ interest: this.interestEnabled(), behavior: this.behaviorEnabled(), locale: this.localeEnabled(), region: this.regionEnabled() })
  );
  /** The latest typed query and the box it came from; `equal: () => false` so a repeated query searches again after a failure. */
  private readonly query = signal<{ type: MetaTargetingSearchType; query: string } | null>(null, { equal: () => false });
  private readonly search: Signal<MetaTargetingSearchState> = this.initSearch();

  protected readonly lists = computed<MetaDetailedTargetingListView[]>(() => {
    const picks = this.picks();
    const search = this.search();
    const request = this.query();
    return this.boxes().map((box) => {
      const answers = search.type === box.type;
      const failure = answers ? search.failure : null;
      const refused = request !== null && request.type === box.type && request.query === '';
      const choices = answers ? metaTargetingBoxChoices(box, search.options, picks) : [];
      const emptyMessage = metaTargetingSearchEmptyMessage(refused, answers && search.pending, failure);
      return { ...box, ...metaTargetingBoxPicks(box, picks), choices, emptyMessage, failure };
    });
  });

  /** Whether any shown box joins the "match any one" group, so its hint applies. */
  protected readonly matchAnyShown = computed<boolean>(() => this.lists().some((list) => list.matchAny));

  protected onSearch(type: MetaTargetingSearchType, event: AutoCompleteCompleteEvent): void {
    this.query.set({ type, query: metaTargetingSearchQuery(event.query) });
  }

  protected onSelect(box: MetaTargetingBox, event: AutoCompleteSelectEvent): void {
    const choice = event.value as MetaTargetingSearchChoice | null;
    if (choice && !choice.disabled) this.picks.update((picks) => metaTargetingPicksAdd(picks, box, choice));
    this.searchForm.controls[box.type].setValue(null);
    this.query.set(null);
  }

  protected onClear(): void {
    this.query.set(null);
  }

  protected onRemove(list: MetaTargetingPickKey, id: string): void {
    this.picks.update((picks) => ({ ...picks, [list]: metaTargetingPicksWithout(picks[list], id) }));
  }

  /**
   * The search behind whichever box was typed in last. The project and the lists shown are read INSIDE the
   * trigger, so a foundation switch or a list going away cancels a search mid-debounce instead of answering it for
   * the previous project. A fresh idle object every time, as the geo search does, so PrimeNG never stays loading.
   */
  private initSearch(): Signal<MetaTargetingSearchState> {
    const idle = (): MetaTargetingSearchState => ({ type: null, options: [], pending: false, failure: null });
    const trigger = computed(() => ({ request: this.query(), projectSlug: this.projectSlug(), boxes: this.boxes() }));
    return toSignal(
      toObservable(trigger).pipe(
        switchMap(({ request, projectSlug, boxes }) => {
          if (request === null || request.query === '' || projectSlug === '' || !boxes.some((box) => box.type === request.type)) return of(idle());
          const { type, query } = request;
          return timer(META_TARGETING_SEARCH_DEBOUNCE_MS).pipe(
            switchMap(() =>
              this.campaignService.searchMetaTargetingOptions(projectSlug, type, query).pipe(
                map((result): MetaTargetingSearchState => ({ type, options: result.options, pending: false, failure: null })),
                catchError((err: unknown) => {
                  // The status only: the error's URL carries the typed search text.
                  const status = err instanceof HttpErrorResponse ? err.status : 0;
                  console.error('Meta targeting search failed:', status);
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
