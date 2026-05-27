// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { LENS_DEFAULT_ROUTES, ORG_SELECTOR_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import { Account, OrgCanonicalRecord, OrgItem, OrgItemsResponse, OrgListPage, OrgListState, TaggedOrgListPage } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { catchError, debounceTime, distinctUntilChanged, EMPTY, filter, map, merge, Observable, of, scan, skip, Subject, switchMap, tap } from 'rxjs';

import { AccountContextService } from './account-context.service';
import { LensService } from './lens.service';

/** Client state machine for the org-selector — single-state mirror of NavigationService (research.md D-002) with generation race-guard + uid dedup on scroll. */
@Injectable({
  providedIn: 'root',
})
export class OrgNavigationService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly lensService = inject(LensService);
  private readonly messageService = inject(MessageService);
  private readonly accountContextService = inject(AccountContextService);

  private readonly state: OrgListState = this.createOrgListState();

  /** Lazy hint passed on first-load to surface the cookie-restored selection. */
  private restoredSelectedUid: string | null = null;
  /** Legacy persisted selector value; resolved to uid before the first org-items request. */
  private restoredSelectedAccountId: string | null = null;

  public readonly items: Signal<OrgItem[]> = this.state.items;
  public readonly loading: Signal<boolean> = this.state.loading;
  public readonly loaded: Signal<boolean> = this.state.loaded;
  public readonly hasMore: Signal<boolean> = this.state.hasMore;

  public searchTerm(): WritableSignal<string> {
    return this.state.searchTerm;
  }

  public setSearchTerm(term: string): void {
    this.state.searchTerm.set(term);
  }

  public loadNextPage(): void {
    const token = this.state.nextPageToken();
    if (!token || this.state.loading()) return;
    this.state.loadMore$.next(token);
  }

  /** Triggers a fresh first-page fetch; optional hints pin the cookie-restored selection at the top via the BFF `selected_uid` injection. */
  public resetAndReload(selectedUid?: string | null, selectedAccountId?: string | null): void {
    if (selectedUid) {
      this.restoredSelectedUid = selectedUid;
    } else if (selectedAccountId) {
      this.restoredSelectedAccountId = selectedAccountId;
    }
    this.state.pendingDefaultSelection.set(true);
    this.state.reload$.next();
  }

  private createOrgListState(): OrgListState {
    const searchTerm = signal<string>('');
    const loading = signal<boolean>(false);
    const loaded = signal<boolean>(false);
    const nextPageToken = signal<string | null>(null);
    const pendingDefaultSelection = signal<boolean>(false);
    const generation = signal<number>(0);
    const loadMore$ = new Subject<string>();
    const reload$ = new Subject<void>();

    const items = this.initItems(searchTerm, loading, loaded, nextPageToken, pendingDefaultSelection, generation, loadMore$, reload$);
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
    searchTerm: WritableSignal<string>,
    loading: WritableSignal<boolean>,
    loaded: WritableSignal<boolean>,
    nextPageToken: WritableSignal<string | null>,
    pendingDefaultSelection: WritableSignal<boolean>,
    generation: WritableSignal<number>,
    loadMore$: Subject<string>,
    reload$: Subject<void>
  ): Signal<OrgItem[]> {
    // skip(1) drops toObservable's initial replay so fetches only fire on user search input.
    const searchTriggered$ = toObservable(searchTerm).pipe(
      skip(1),
      debounceTime(ORG_SELECTOR_DEBOUNCE_MS),
      distinctUntilChanged(),
      map((term) => ({ term, selectedUid: null as string | null }))
    );

    // During search, never inject selected_uid — the user's intent is "filter this list",
    // not "keep my selection pinned"; injection would surface a non-matching row.
    const reloadTriggered$ = reload$.pipe(
      switchMap(() => {
        const term = searchTerm();
        if (term.trim()) {
          this.restoredSelectedUid = null;
          this.restoredSelectedAccountId = null;
          return of({ term, selectedUid: null as string | null });
        }

        const selectedUid = this.restoredSelectedUid;
        this.restoredSelectedUid = null;
        if (selectedUid) {
          this.restoredSelectedAccountId = null;
          return of({ term, selectedUid });
        }

        const selectedAccountId = this.restoredSelectedAccountId;
        this.restoredSelectedAccountId = null;
        if (!selectedAccountId) {
          return of({ term, selectedUid: null as string | null });
        }

        return this.resolveStoredAccountSelection(selectedAccountId).pipe(map((resolvedUid) => ({ term, selectedUid: resolvedUid })));
      })
    );

    const firstPage$ = merge(searchTriggered$, reloadTriggered$).pipe(
      switchMap(({ term, selectedUid }) => {
        generation.update((g) => g + 1);
        return this.fetchSinglePage(term, null, loading, true, generation(), generation, selectedUid);
      })
    );

    const nextPage$ = loadMore$.pipe(switchMap((token) => this.fetchSinglePage(searchTerm(), token, loading, false, generation(), generation, null)));

    return toSignal(
      merge(firstPage$, nextPage$).pipe(
        // Drop responses from a superseded generation (e.g. a scroll fetch that lands after a new search reset).
        filter(({ generation: pageGen }) => pageGen === generation()),
        map(({ page }) => page),
        tap((page) => {
          nextPageToken.set(page.nextPageToken);
          loaded.set(true);
          if (pendingDefaultSelection()) {
            this.handlePendingSelection(page, pendingDefaultSelection);
          }
        }),
        // Dedupe by uid when appending pages — an injected selected row can also appear in a later page.
        scan((acc: OrgItem[], page: OrgListPage) => {
          if (page.reset) return page.items;
          const seen = new Set(acc.map((item) => item.uid));
          return [...acc, ...page.items.filter((item) => !seen.has(item.uid))];
        }, [])
      ),
      { initialValue: [] as OrgItem[] }
    );
  }

  private fetchSinglePage(
    term: string,
    pageToken: string | null,
    loading: WritableSignal<boolean>,
    reset: boolean,
    pageGeneration: number,
    activeGeneration: Signal<number>,
    selectedUid: string | null
  ): Observable<TaggedOrgListPage> {
    loading.set(true);
    // Only this request's generation may clear the loading flag — a superseded fetch
    // landing after a new search must not drop the spinner while a newer request is in flight.
    const clearLoadingIfActive = (): void => {
      if (activeGeneration() === pageGeneration) loading.set(false);
    };
    return this.fetchPage(term, pageToken, selectedUid).pipe(
      map((response) => ({ page: this.toOrgListPage(response, reset), generation: pageGeneration })),
      tap(clearLoadingIfActive),
      catchError(() => {
        // Reset failures emit an empty page so handleEmptyOrgResponse can redirect;
        // scroll-triggered failures stay silent (just lose the spinner).
        clearLoadingIfActive();
        if (reset) {
          return of({
            page: { items: [], nextPageToken: null, upstreamFailed: true, reset: true },
            generation: pageGeneration,
          } satisfies TaggedOrgListPage);
        }
        return EMPTY;
      })
    );
  }

  private fetchPage(term: string, pageToken: string | null, selectedUid: string | null): Observable<OrgItemsResponse> {
    let params = new HttpParams();
    if (pageToken) {
      params = params.set('page_token', pageToken);
    }
    if (term.trim()) {
      params = params.set('name', term.trim());
    }
    if (selectedUid && !pageToken) {
      params = params.set('selected_uid', selectedUid);
    }
    return this.http.get<OrgItemsResponse>('/api/nav/org-items', { params });
  }

  private resolveStoredAccountSelection(accountId: string): Observable<string | null> {
    return this.http.get<OrgCanonicalRecord>(`/api/orgs/sfid/${encodeURIComponent(accountId)}`).pipe(
      tap((canonical) => {
        const account = this.toAccountFromCanonicalRecord(canonical);
        this.accountContextService.setAccount(account);
      }),
      map((canonical) => canonical.uid),
      catchError(() => of(null))
    );
  }

  private toOrgListPage(response: OrgItemsResponse, reset: boolean): OrgListPage {
    return {
      items: response.items,
      nextPageToken: response.next_page_token,
      upstreamFailed: response.upstream_failed,
      reset,
    };
  }

  /** Fires once per first-page response when a reload is pending; routes empty pages through the FR-004 "No access" toast+redirect. */
  private handlePendingSelection(page: OrgListPage, pendingDefaultSelection: WritableSignal<boolean>): void {
    pendingDefaultSelection.set(false);
    if (page.items.length === 0) {
      this.handleEmptyOrgResponse(page);
      return;
    }

    const current = this.accountContextService.selectedAccount();
    if (current.uid && page.items.some((item) => item.uid === current.uid)) {
      return;
    }

    const matchingAccountItem = current.accountId ? page.items.find((item) => item.accountId === current.accountId) : undefined;
    this.selectDefaultOrg(matchingAccountItem ?? page.items[0]);
  }

  private selectDefaultOrg(item: OrgItem): void {
    const account = this.toAccountFromOrgItem(item);
    this.accountContextService.setAccount(account);
    this.accountContextService.refreshCanonicalRecord(account).catch(() => {
      // AccountContextService already logs canonical fetch failures; selection remains on the indexed snapshot.
    });
  }

  private handleEmptyOrgResponse(page: OrgListPage): void {
    const toast = page.upstreamFailed
      ? { severity: 'error', summary: 'Unable to load', detail: 'We were unable to load your organizations. Please try again in a moment.' }
      : { severity: 'info', summary: 'No access', detail: 'You do not have access to any organizations.' };

    this.messageService.add(toast);
    this.accountContextService.clearAccount();
    this.lensService.setLens('me');
    this.router.navigate([LENS_DEFAULT_ROUTES.me]);
  }

  private toAccountFromOrgItem(item: OrgItem): Account {
    return {
      accountId: item.accountId ?? '',
      accountName: item.name,
      accountSlug: '',
      membershipTier: '',
      logoUrl: item.logoUrl ?? null,
      uid: item.uid,
    };
  }

  private toAccountFromCanonicalRecord(canonical: OrgCanonicalRecord): Account {
    return {
      accountId: canonical.accountId ?? '',
      accountName: canonical.name,
      accountSlug: '',
      membershipTier: '',
      logoUrl: canonical.logoUrl ?? null,
      uid: canonical.uid,
      parentUid: canonical.parentUid ?? null,
    };
  }
}
