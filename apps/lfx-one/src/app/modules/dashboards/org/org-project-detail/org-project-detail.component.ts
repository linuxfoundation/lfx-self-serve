// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensProjectDetailService } from '@services/org-lens-project-detail.service';
import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import type { OrgLensProjectDetailPageState, OrgLensProjectDetailResponse, OrgLensProjectDetailTab, OrgLensProjectHealth } from '@lfx-one/shared/interfaces';
import { formatRelativeTime, parseLocalDateString } from '@lfx-one/shared/utils';
import type { MenuItem } from 'primeng/api';
import { catchError, combineLatest, filter, map, type Observable, of, switchMap, tap } from 'rxjs';

const DEFAULT_TAB: OrgLensProjectDetailTab = 'pd-influence';
const VALID_TABS: ReadonlySet<string> = new Set<OrgLensProjectDetailTab>(['pd-influence', 'pd-leaderboards']);

/** Hero health badge label + Tailwind token classes (green Excellent / amber Healthy / red At Risk). */
const HEALTH_META: Record<OrgLensProjectHealth, { label: string; classes: string }> = {
  excellent: { label: 'Excellent', classes: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20' },
  healthy: { label: 'Healthy', classes: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20' },
  'at-risk': { label: 'At Risk', classes: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20' },
};

/**
 * Org Lens · Project Detail sub-page (LFXV2-1885). Opened from the Projects table /
 * Influence Summary cards via `/org/projects/:projectSlug`. Owns the fetch keyed on the
 * selected org + slug, the page-state machine, and the URL-persisted tab strip.
 */
@Component({
  selector: 'lfx-org-project-detail',
  imports: [BreadcrumbComponent, EmptyStateComponent],
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

  // Hero presentation — derived from the loaded payload.
  protected readonly hero = computed(() => this.detail()?.hero ?? null);
  protected readonly breadcrumbItems = computed<MenuItem[]>(() => this.initBreadcrumb());
  protected readonly healthMeta = computed(() => {
    const health = this.hero()?.health;
    return health ? HEALTH_META[health] : null;
  });
  protected readonly firstCommitLabel = computed(() => this.formatMonthYear(this.hero()?.firstCommit ?? null));
  protected readonly softwareValueLabel = computed(() => this.formatCompactUsd(this.hero()?.softwareValueUsd ?? null));
  protected readonly lastUpdatedLabel = computed(() => this.formatRelative(this.hero()?.lastUpdated ?? null));
  protected readonly logoInitials = computed(() => this.initialsFor(this.hero()?.projectName ?? ''));

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

  private initBreadcrumb(): MenuItem[] {
    const hero = this.hero();
    if (!hero) return [{ label: 'Projects', routerLink: ['/org/projects'] }];
    return [{ label: 'Projects', routerLink: ['/org/projects'] }, { label: hero.foundationLabel }, { label: hero.projectName }];
  }

  private formatMonthYear(dateString: string | null): string {
    if (!dateString) return '—';
    try {
      return parseLocalDateString(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    } catch {
      return dateString;
    }
  }

  private formatRelative(isoString: string | null): string {
    if (!isoString) return '—';
    const parsed = new Date(isoString);
    return Number.isNaN(parsed.getTime()) ? '—' : formatRelativeTime(parsed);
  }

  private formatCompactUsd(value: number | null): string {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  private initialsFor(name: string): string {
    const parts = name.split(/[\s/]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
}
