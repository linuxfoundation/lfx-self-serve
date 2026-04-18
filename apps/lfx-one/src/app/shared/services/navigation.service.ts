// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { BOARD_SCOPED_PERSONA_PRIORITY, LENS_DEFAULT_ROUTES, NAV_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import { LensItem, LensItemsResponse, LensPage, LensState, NavLens, TaggedLensPage } from '@lfx-one/shared/interfaces';
import { lensItemToProjectContext } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { catchError, debounceTime, distinctUntilChanged, EMPTY, filter, map, merge, Observable, of, scan, skip, Subject, switchMap, tap } from 'rxjs';

import { LensService } from './lens.service';
import { PersonaService } from './persona.service';
import { ProjectContextService } from './project-context.service';

@Injectable({
  providedIn: 'root',
})
export class NavigationService {
  private readonly http = inject(HttpClient);
  private readonly lensService = inject(LensService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);

  private readonly foundationState: LensState = this.createLensState('foundation');
  private readonly projectState: LensState = this.createLensState('project');

  // Default-selection handled inside the fetch pipeline (not via items subscription) to avoid
  // an SSR race where items could populate synchronously before external subscribers are ready.
  private readonly activeLensPreloader = toSignal(
    toObservable(this.lensService.activeLens).pipe(
      map((lens): NavLens | null => (lens === 'foundation' || lens === 'project' ? lens : null)),
      distinctUntilChanged(),
      filter((lens): lens is NavLens => lens !== null),
      tap((lens) => this.resetAndReload(lens))
    ),
    { initialValue: null }
  );

  public items(lens: NavLens): Signal<LensItem[]> {
    return this.getState(lens).items;
  }

  public loading(lens: NavLens): Signal<boolean> {
    return this.getState(lens).loading;
  }

  public loaded(lens: NavLens): Signal<boolean> {
    return this.getState(lens).loaded;
  }

  public hasMore(lens: NavLens): Signal<boolean> {
    return this.getState(lens).hasMore;
  }

  public searchTerm(lens: NavLens): WritableSignal<string> {
    return this.getState(lens).searchTerm;
  }

  public bypassActive(lens: NavLens): Signal<boolean> {
    return this.getState(lens).bypassActive;
  }

  public personaFetchFailed(lens: NavLens): Signal<boolean> {
    return this.getState(lens).personaFetchFailed;
  }

  public setSearchTerm(lens: NavLens, term: string): void {
    this.getState(lens).searchTerm.set(term);
  }

  public loadNextPage(lens: NavLens): void {
    const state = this.getState(lens);
    const token = state.nextPageToken();
    if (!token || state.loading()) {
      return;
    }
    state.loadMore$.next(token);
  }

  public resetAndReload(lens: NavLens): void {
    const state = this.getState(lens);
    state.pendingDefaultSelection.set(true);
    state.reload$.next();
  }

  private getState(lens: NavLens): LensState {
    return lens === 'foundation' ? this.foundationState : this.projectState;
  }

  private applyDefaultSelection(lens: NavLens, page: LensPage): void {
    if (page.items.length === 0) {
      if (lens === 'foundation') {
        this.projectContextService.clearFoundation();
      } else {
        this.projectContextService.clearProject();
      }
      this.handleEmptyLensResponse(lens, page);
      return;
    }

    const defaultItem = lens === 'foundation' ? this.pickFoundationByPersonaPriority(page.items) : page.items[0];
    const context = lensItemToProjectContext(defaultItem);
    if (lens === 'foundation') {
      this.projectContextService.setFoundation(context);
    } else {
      this.projectContextService.setProject(context);
    }
  }

  /** Prefer a foundation the user is ED of, then Board Member of; fall back to the first item. */
  private pickFoundationByPersonaPriority(items: LensItem[]): LensItem {
    const personaProjects = this.personaService.personaProjects();
    for (const persona of BOARD_SCOPED_PERSONA_PRIORITY) {
      const personaUids = new Set((personaProjects[persona] ?? []).map((p) => p.projectUid));
      if (personaUids.size === 0) continue;
      const match = items.find((item) => personaUids.has(item.uid));
      if (match) return match;
    }
    return items[0];
  }

  private handleEmptyLensResponse(lens: NavLens, page: LensPage): void {
    const upstreamFailure = page.upstreamFailed || page.personaFetchFailed;
    const toast = upstreamFailure
      ? { severity: 'error', summary: 'Unable to load', detail: 'We were unable to load your data. Please try again in a moment.' }
      : {
          severity: 'info',
          summary: 'No access',
          detail: `You do not have access to any ${lens === 'foundation' ? 'foundations' : 'projects'}.`,
        };

    this.messageService.add(toast);
    this.lensService.setLens('me');
    this.router.navigate([LENS_DEFAULT_ROUTES.me]);
  }

  private createLensState(lens: NavLens): LensState {
    const searchTerm = signal<string>('');
    const loading = signal<boolean>(false);
    const loaded = signal<boolean>(false);
    const nextPageToken = signal<string | null>(null);
    const bypassActive = signal<boolean>(false);
    const personaFetchFailed = signal<boolean>(false);
    const pendingDefaultSelection = signal<boolean>(false);
    const generation = signal<number>(0);
    const loadMore$ = new Subject<string>();
    const reload$ = new Subject<void>();

    const items = this.initItems(
      lens,
      searchTerm,
      loading,
      loaded,
      nextPageToken,
      bypassActive,
      personaFetchFailed,
      pendingDefaultSelection,
      generation,
      loadMore$,
      reload$
    );
    const hasMore = computed(() => nextPageToken() !== null);

    return {
      searchTerm,
      items,
      loading,
      loaded,
      nextPageToken,
      hasMore,
      bypassActive,
      personaFetchFailed,
      pendingDefaultSelection,
      generation,
      loadMore$,
      reload$,
    };
  }

  private initItems(
    lens: NavLens,
    searchTerm: WritableSignal<string>,
    loading: WritableSignal<boolean>,
    loaded: WritableSignal<boolean>,
    nextPageToken: WritableSignal<string | null>,
    bypassActive: WritableSignal<boolean>,
    personaFetchFailed: WritableSignal<boolean>,
    pendingDefaultSelection: WritableSignal<boolean>,
    generation: WritableSignal<number>,
    loadMore$: Subject<string>,
    reload$: Subject<void>
  ): Signal<LensItem[]> {
    // skip(1) drops toObservable's initial replay so fetches only fire on user search input.
    const searchTriggered$ = toObservable(searchTerm).pipe(skip(1), debounceTime(NAV_SEARCH_DEBOUNCE_MS), distinctUntilChanged());

    const reloadTriggered$ = reload$.pipe(map(() => searchTerm()));

    const firstPage$ = merge(searchTriggered$, reloadTriggered$).pipe(
      switchMap((term) => {
        generation.update((g) => g + 1);
        return this.fetchSinglePage(lens, term, null, loading, true, generation());
      })
    );

    const nextPage$ = loadMore$.pipe(switchMap((token) => this.fetchSinglePage(lens, searchTerm(), token, loading, false, generation())));

    return toSignal(
      merge(firstPage$, nextPage$).pipe(
        // Drop responses from a superseded generation (e.g., a scroll fetch that lands after a new search reset).
        filter(({ generation: pageGen }) => pageGen === generation()),
        map(({ page }) => page),
        tap((page) => {
          nextPageToken.set(page.nextPageToken);
          bypassActive.set(page.bypassActive);
          personaFetchFailed.set(page.personaFetchFailed);
          loaded.set(true);
          if (page.reset && pendingDefaultSelection()) {
            pendingDefaultSelection.set(false);
            this.applyDefaultSelection(lens, page);
          }
        }),
        scan((acc: LensItem[], page: LensPage) => (page.reset ? page.items : [...acc, ...page.items]), [])
      ),
      { initialValue: [] as LensItem[] }
    );
  }

  private fetchSinglePage(
    lens: NavLens,
    term: string,
    pageToken: string | null,
    loading: WritableSignal<boolean>,
    reset: boolean,
    generation: number
  ): Observable<TaggedLensPage> {
    loading.set(true);
    return this.fetchPage(lens, term, pageToken).pipe(
      map((response) => ({ page: this.toLensPage(response, reset), generation })),
      tap(() => loading.set(false)),
      catchError(() => {
        // Reset failures emit an empty page so handleEmptyLensResponse can redirect; scroll-triggered failures stay silent.
        loading.set(false);
        if (reset) {
          return of({
            page: { items: [], nextPageToken: null, bypassActive: false, personaFetchFailed: false, upstreamFailed: true, reset: true },
            generation,
          });
        }
        return EMPTY;
      })
    );
  }

  private fetchPage(lens: NavLens, term: string, pageToken: string | null): Observable<LensItemsResponse> {
    let params = new HttpParams().set('lens', lens);
    if (pageToken) {
      params = params.set('page_token', pageToken);
    }
    if (term.trim()) {
      params = params.set('name', term.trim());
    }
    return this.http.get<LensItemsResponse>('/api/nav/lens-items', { params });
  }

  private toLensPage(response: LensItemsResponse, reset: boolean): LensPage {
    return {
      items: response.items,
      nextPageToken: response.next_page_token,
      bypassActive: response.bypass_active,
      personaFetchFailed: response.persona_fetch_failed,
      upstreamFailed: response.upstream_failed,
      reset,
    };
  }
}
