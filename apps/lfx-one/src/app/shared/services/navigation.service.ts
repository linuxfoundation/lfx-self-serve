// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  BOARD_SCOPED_PERSONA_PRIORITY,
  LENS_DEFAULT_ROUTES,
  NAV_SEARCH_DEBOUNCE_MS,
  PERSONA_PRIORITY,
  PROJECT_SCOPED_PERSONA_PRIORITY,
} from '@lfx-one/shared/constants';
import { LensItem, LensItemsResponse, LensPage, LensState, NavLens, PersonaType, TaggedLensPage } from '@lfx-one/shared/interfaces';
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
      tap((lens) => {
        this.resetAndReload(lens);
        // For hybrid personas, preload the sibling lens so the merged dropdown has both sets ready.
        // preloadSibling() skips default-selection side effects so it can't overwrite the active
        // lens's context/URL, and it bails out if the sibling is already loaded or in flight.
        if (this.lensService.isHybridPersona()) {
          const sibling: NavLens = lens === 'foundation' ? 'project' : 'foundation';
          this.preloadSibling(sibling);
        }
      })
    ),
    { initialValue: null }
  );

  // Re-fetch the project lens if foundation visibility flips mid-session (e.g. persona refresh
  // expands allowed lenses) so accumulated items get re-filtered through applyVisibilityFilters.
  private readonly foundationVisibilityWatcher = toSignal(
    toObservable(this.lensService.availableLenses).pipe(
      map((options) => options.some((option) => option.id === 'foundation')),
      distinctUntilChanged(),
      skip(1),
      filter(() => this.lensService.activeLens() === 'project'),
      tap(() => this.resetAndReload('project'))
    ),
    { initialValue: false }
  );

  // Persona refresh can promote a user to hybrid without changing activeLens — in that case the
  // activeLensPreloader doesn't re-run, leaving the sibling lens unloaded and the merged tabs empty.
  private readonly hybridTransitionPreloader = toSignal(
    toObservable(this.lensService.isHybridPersona).pipe(
      distinctUntilChanged(),
      skip(1),
      filter((isHybrid) => isHybrid),
      tap(() => {
        const active = this.lensService.activeLens();
        if (active === 'foundation' || active === 'project') {
          const sibling: NavLens = active === 'foundation' ? 'project' : 'foundation';
          this.preloadSibling(sibling);
        }
      })
    ),
    { initialValue: false }
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

  private preloadSibling(lens: NavLens): void {
    const state = this.getState(lens);
    if (state.loaded() || state.loading()) {
      return;
    }
    // Deliberately do NOT set pendingDefaultSelection — preload must not race with the active
    // lens's selection and can't be allowed to overwrite the URL/context.
    state.reload$.next();
  }

  private getState(lens: NavLens): LensState {
    return lens === 'foundation' ? this.foundationState : this.projectState;
  }

  private applyDefaultSelection(lens: NavLens, page: LensPage): void {
    const state = this.getState(lens);

    if (page.items.length === 0) {
      // Client-side filtering (e.g. hiding foundations from the project lens) can empty a page
      // even when more upstream pages remain — keep paginating rather than redirecting users
      // to Me lens for a page boundary that the upstream didn't know about.
      if (page.nextPageToken && !page.upstreamFailed) {
        this.loadNextPage(lens);
        return;
      }
      state.pendingDefaultSelection.set(false);
      if (lens === 'foundation') {
        this.projectContextService.clearFoundation();
      } else {
        this.projectContextService.clearProject();
      }
      this.handleEmptyLensResponse(lens, page);
      return;
    }

    state.pendingDefaultSelection.set(false);

    // Preserve an explicit selection (e.g., Me lens → Open) — selected_uid ensures it's in the page.
    const existing = lens === 'foundation' ? this.projectContextService.selectedFoundation() : this.projectContextService.selectedProject();
    if (existing?.uid && page.items.some((item) => item.uid === existing.uid)) {
      return;
    }

    const priority = this.getPickerPriority(lens);
    const defaultItem = this.pickItemByPersonaPriority(page.items, priority);
    const context = lensItemToProjectContext(defaultItem);
    if (lens === 'foundation') {
      this.projectContextService.setFoundation(context);
    } else {
      this.projectContextService.setProject(context);
    }
  }

  /**
   * Project lens for a hybrid persona is the merged entry (Foundation button is hidden); use the
   * full priority so the user's highest-authority role wins instead of falling through to contributor.
   */
  private getPickerPriority(lens: NavLens): readonly PersonaType[] {
    if (lens === 'foundation') return BOARD_SCOPED_PERSONA_PRIORITY;
    return this.lensService.isHybridPersona() ? PERSONA_PRIORITY : PROJECT_SCOPED_PERSONA_PRIORITY;
  }

  /** Prefer items where the user holds an in-priority persona; among same-persona matches prefer root-most (parent outside the user's accessible set). Falls back to the first item. */
  private pickItemByPersonaPriority(items: LensItem[], priority: readonly PersonaType[]): LensItem {
    const personaProjects = this.personaService.personaProjects();
    const itemUids = new Set(items.map((i) => i.uid));
    const enrichedByUid = new Map(this.personaService.detectedProjects().map((p) => [p.projectUid, p]));
    for (const persona of priority) {
      const projects = personaProjects[persona] ?? [];
      const matches: { item: LensItem; isRoot: boolean }[] = [];
      for (const project of projects) {
        const item = items.find((i) => i.uid === project.projectUid);
        if (!item) continue;
        const parentUid = enrichedByUid.get(item.uid)?.parentProjectUid;
        const isRoot = !parentUid || !itemUids.has(parentUid);
        matches.push({ item, isRoot });
      }
      if (matches.length === 0) continue;
      // Prefer a root-level match (no in-set parent) so e.g. The Linux Foundation beats AAIF when both carry board-member.
      return (matches.find((m) => m.isRoot) ?? matches[0]).item;
    }
    return items[0];
  }

  /** First project UID of the highest-priority persona the user holds for this lens, or null. */
  private getPriorityUid(lens: NavLens): string | null {
    const priority = this.getPickerPriority(lens);
    const personaProjects = this.personaService.personaProjects();
    for (const persona of priority) {
      const projects = personaProjects[persona] ?? [];
      if (projects.length > 0) return projects[0].projectUid;
    }
    return null;
  }

  private handleEmptyLensResponse(lens: NavLens, page: LensPage): void {
    const toast = page.upstreamFailed
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
    const pendingDefaultSelection = signal<boolean>(false);
    const generation = signal<number>(0);
    const loadMore$ = new Subject<string>();
    const reload$ = new Subject<void>();

    const items = this.initItems(lens, searchTerm, loading, loaded, nextPageToken, pendingDefaultSelection, generation, loadMore$, reload$);
    const hasMore = computed(() => nextPageToken() !== null);

    return {
      searchTerm,
      items,
      loading,
      loaded,
      nextPageToken,
      hasMore,
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
    pendingDefaultSelection: WritableSignal<boolean>,
    generation: WritableSignal<number>,
    loadMore$: Subject<string>,
    reload$: Subject<void>
  ): Signal<LensItem[]> {
    // skip(1) drops toObservable's initial replay so fetches only fire on user search input.
    const searchTriggered$ = toObservable(searchTerm).pipe(
      skip(1),
      debounceTime(NAV_SEARCH_DEBOUNCE_MS),
      distinctUntilChanged(),
      map((term) => ({ term, selectedUid: null as string | null }))
    );

    // Only inject the selected uid when no search is active — during search the user's intent is
    // "filter this list", not "keep my selection pinned", so injection would surface a non-matching row.
    const reloadTriggered$ = reload$.pipe(
      map(() => {
        const term = searchTerm();
        return { term, selectedUid: term.trim() ? null : this.getSelectedUidForLens(lens) };
      })
    );

    const firstPage$ = merge(searchTriggered$, reloadTriggered$).pipe(
      switchMap(({ term, selectedUid }) => {
        generation.update((g) => g + 1);
        return this.fetchSinglePage(lens, term, null, loading, true, generation(), generation, selectedUid);
      })
    );

    const nextPage$ = loadMore$.pipe(switchMap((token) => this.fetchSinglePage(lens, searchTerm(), token, loading, false, generation(), generation, null)));

    return toSignal(
      merge(firstPage$, nextPage$).pipe(
        // Drop responses from a superseded generation (e.g., a scroll fetch that lands after a new search reset).
        filter(({ generation: pageGen }) => pageGen === generation()),
        map(({ page }) => page),
        tap((page) => {
          nextPageToken.set(page.nextPageToken);
          loaded.set(true);
          // Pending stays alive across pages so a first page emptied by client-side filtering
          // can auto-fetch the next page and still drive default-selection; applyDefaultSelection
          // is responsible for clearing the flag once a default is chosen or pages are exhausted.
          if (pendingDefaultSelection()) {
            this.applyDefaultSelection(lens, page);
          }
        }),
        // Dedupe by uid when appending next pages — an injected selected item can also appear in a later page.
        scan((acc: LensItem[], page: LensPage) => {
          if (page.reset) return page.items;
          const seen = new Set(acc.map((item) => item.uid));
          return [...acc, ...page.items.filter((item) => !seen.has(item.uid))];
        }, [])
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
    generation: number,
    activeGeneration: Signal<number>,
    selectedUid: string | null
  ): Observable<TaggedLensPage> {
    loading.set(true);
    // Only this request's generation may clear the loading flag — otherwise a superseded fetch
    // landing after a new search could drop the spinner while the newer request is still in-flight.
    const clearLoadingIfActive = (): void => {
      if (activeGeneration() === generation) loading.set(false);
    };
    return this.fetchPage(lens, term, pageToken, selectedUid).pipe(
      map((response) => ({ page: this.toLensPage(response, reset), generation })),
      tap(clearLoadingIfActive),
      catchError(() => {
        // Reset failures emit an empty page so handleEmptyLensResponse can redirect; scroll-triggered failures stay silent.
        clearLoadingIfActive();
        if (reset) {
          return of({
            page: { items: [], nextPageToken: null, upstreamFailed: true, reset: true },
            generation,
          });
        }
        return EMPTY;
      })
    );
  }

  private fetchPage(lens: NavLens, term: string, pageToken: string | null, selectedUid: string | null): Observable<LensItemsResponse> {
    let params = new HttpParams().set('lens', lens);
    if (pageToken) {
      params = params.set('page_token', pageToken);
    }
    if (term.trim()) {
      params = params.set('name', term.trim());
    }
    if (selectedUid && !pageToken) {
      params = params.set('selected_uid', selectedUid);
    }
    return this.http.get<LensItemsResponse>('/api/nav/lens-items', { params });
  }

  private getSelectedUidForLens(lens: NavLens): string | null {
    const context = lens === 'foundation' ? this.projectContextService.selectedFoundation() : this.projectContextService.selectedProject();
    return context?.uid ?? this.getPriorityUid(lens);
  }

  private toLensPage(response: LensItemsResponse, reset: boolean): LensPage {
    return {
      items: this.applyVisibilityFilters(response.items, response.lens),
      nextPageToken: response.next_page_token,
      upstreamFailed: response.upstream_failed,
      reset,
    };
  }

  // Foundations have their own lens — drop them from the project dropdown for users
  // who can switch to the foundation lens so the two dropdowns don't duplicate entries.
  private applyVisibilityFilters(items: LensItem[], lens: NavLens): LensItem[] {
    if (lens !== 'project') return items;
    const foundationVisible = this.lensService.availableLenses().some((option) => option.id === 'foundation');
    if (!foundationVisible) return items;
    return items.filter((item) => !item.isFoundation);
  }
}
