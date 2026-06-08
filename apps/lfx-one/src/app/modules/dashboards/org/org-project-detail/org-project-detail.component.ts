// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensProjectDetailService } from '@services/org-lens-project-detail.service';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import type { OrgLensProjectDetailPageState, OrgLensProjectDetailResponse, OrgLensProjectDetailTab } from '@lfx-one/shared/interfaces';
import { catchError, combineLatest, filter, map, type Observable, of, switchMap, tap } from 'rxjs';

const DEFAULT_TAB: OrgLensProjectDetailTab = 'pd-influence';
const VALID_TABS: ReadonlySet<string> = new Set<OrgLensProjectDetailTab>(['pd-influence', 'pd-leaderboards']);

/**
 * Org Lens · Project Detail sub-page (LFXV2-1885). Opened from the Projects table /
 * Influence Summary cards via `/org/projects/:projectSlug`. Owns the fetch keyed on the
 * selected org + slug, the page-state machine, and the URL-persisted tab strip.
 */
@Component({
  selector: 'lfx-org-project-detail',
  imports: [RouterLink, EmptyStateComponent],
  templateUrl: './org-project-detail.component.html',
})
export class OrgProjectDetailComponent {
  protected readonly accountContext = inject(AccountContextService);
  private readonly detailService = inject(OrgLensProjectDetailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly retryTrigger = signal(0);
  protected readonly fetchLoading = signal(true);
  protected readonly fetchError = signal(false);
  protected readonly detail = signal<OrgLensProjectDetailResponse | null>(null);

  protected readonly tabs: { id: OrgLensProjectDetailTab; label: string; icon: string }[] = [
    { id: 'pd-influence', label: 'Our Influence', icon: 'fa-light fa-chart-network' },
    { id: 'pd-leaderboards', label: 'Leaderboards', icon: 'fa-light fa-ranking-star' },
  ];

  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  protected readonly activeTab: Signal<OrgLensProjectDetailTab> = computed(() => this.initActiveTab());
  protected readonly pageState: Signal<OrgLensProjectDetailPageState> = computed(() => this.initPageState());

  // Subscribe via toSignal so the fetch stream runs; results are mirrored into the signals read by the template.
  protected readonly detailData = toSignal<OrgLensProjectDetailResponse | null>(this.initDetailStream(), { initialValue: null });

  protected switchTab(tab: OrgLensProjectDetailTab): void {
    if (this.activeTab() === tab) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === DEFAULT_TAB ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const ids = this.tabs.map((t) => t.id);
    const idx = ids.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (idx + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (idx - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    if (next !== null) {
      event.preventDefault();
      this.switchTab(ids[next]);
      if (typeof document !== 'undefined') {
        (document.getElementById(`project-detail-tab-trigger-${ids[next]}`) as HTMLElement | null)?.focus();
      }
    }
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  private initActiveTab(): OrgLensProjectDetailTab {
    const raw = this.queryParamMap().get('tab');
    return raw && VALID_TABS.has(raw) ? (raw as OrgLensProjectDetailTab) : DEFAULT_TAB;
  }

  private initDetailStream(): Observable<OrgLensProjectDetailResponse | null> {
    const orgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid));
    const projectSlug$ = this.route.paramMap.pipe(map((params) => params.get('projectSlug')));
    const retryTrigger$ = toObservable(this.retryTrigger);

    return combineLatest([
      orgUid$.pipe(filter((id): id is string => !!id)),
      projectSlug$.pipe(filter((slug): slug is string => !!slug)),
      retryTrigger$,
    ]).pipe(
      tap(() => {
        this.fetchLoading.set(true);
        this.fetchError.set(false);
      }),
      switchMap(([orgUid, projectSlug]) => {
        const orgName = this.accountContext.selectedAccount()?.accountName ?? '';
        return this.detailService.getProjectDetail(orgUid, orgName, projectSlug).pipe(
          catchError(() => {
            this.fetchError.set(true);
            this.fetchLoading.set(false);
            return of<OrgLensProjectDetailResponse | null>(null);
          })
        );
      }),
      tap((response) => {
        this.detail.set(response);
        if (!this.fetchError()) this.fetchLoading.set(false);
      })
    );
  }

  private initPageState(): OrgLensProjectDetailPageState {
    if (this.fetchLoading()) return 'loading';
    if (this.fetchError()) return 'error';
    if (!this.detail()) return 'notFound';
    return 'ready';
  }
}
