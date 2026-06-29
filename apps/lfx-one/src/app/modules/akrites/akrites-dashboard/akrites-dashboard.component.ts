// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AKRITES_ASSIGNABLE_STATUSES,
  AKRITES_VALID_TABS,
  AKRITES_DEFAULT_TAB,
  AKRITES_DEFAULT_VISIBLE_STATUSES,
  AKRITES_TOTAL_STATUSES,
} from '@lfx-one/shared/constants';
import {
  AkritesAssignStewardRequest,
  AkritesFilterState,
  AkritesListParams,
  AkritesLoadResult,
  AkritesMetrics,
  AkritesPackage,
  AkritesScatterPoint,
  AkritesSortKey,
  AkritesStatus,
  AkritesStatusCounts,
  AkritesEscalateRequest,
  AkritesDashboardTab,
} from '@lfx-one/shared/interfaces';
import { switchMap, catchError, of, map, debounceTime, tap, forkJoin, take, filter } from 'rxjs';
import { MessageService } from 'primeng/api';
import { AkritesService } from '@shared/services/akrites.service';
import { AkritesPackageDrawerComponent } from '../components/akrites-package-drawer/akrites-package-drawer.component';
import { AkritesPackagesTabComponent } from '../components/akrites-packages-tab/akrites-packages-tab.component';
import { AkritesEscalateModalComponent } from '../components/akrites-escalate-modal/akrites-escalate-modal.component';
import { AkritesAssignStewardModalComponent } from '../components/akrites-assign-steward-modal/akrites-assign-steward-modal.component';
import { AkritesOverviewTabComponent } from '../components/akrites-overview-tab/akrites-overview-tab.component';
import { AkritesTriageTabComponent } from '../components/akrites-triage-tab/akrites-triage-tab.component';
import { AkritesRiskMatrixTabComponent } from '../components/akrites-risk-matrix-tab/akrites-risk-matrix-tab.component';

@Component({
  selector: 'lfx-akrites-dashboard',
  imports: [
    AkritesPackageDrawerComponent,
    AkritesPackagesTabComponent,
    AkritesEscalateModalComponent,
    AkritesAssignStewardModalComponent,
    AkritesOverviewTabComponent,
    AkritesTriageTabComponent,
    AkritesRiskMatrixTabComponent,
  ],
  templateUrl: './akrites-dashboard.component.html',
})
export class AkritesDashboardComponent {
  private readonly akritesService = inject(AkritesService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly activeTab = this.initActiveTab();
  protected readonly selectedPackageId = signal<string | null>(null);
  protected readonly drawerVisible = signal(false);
  protected readonly selectedPackages = signal<Set<string>>(new Set());
  protected readonly showBulkActions = computed(() => this.selectedPackages().size > 0);
  protected readonly bulkEscalateVisible = signal(false);
  protected readonly bulkAssignStewardVisible = signal(false);
  protected readonly bulkActionLoading = signal(false);

  // Bumped after a steward admin action to force the package list and activity feed to re-fetch.
  protected readonly reloadTrigger = signal(0);

  protected readonly filters = signal<AkritesFilterState>({
    search: '',
    tab: 'all',
    sort: 'risk',
    ecosystem: '',
    lifecycle: '',
    healthBand: '',
    vulnFilter: '',
    busFactor1Only: false,
    staleOnly: false,
    unstewardedOnly: false,
    page: 1,
    pageSize: 25,
  });

  private readonly loadResult = this.initLoadResult();
  private readonly metricsResult = this.initMetrics();
  private readonly scatterResult = this.initScatterResult();

  protected readonly tableLoading = signal(true);
  protected readonly metricsLoading = signal(true);
  protected readonly scatterLoading = signal(false);
  protected readonly riskMatrixVisibleStatuses = signal<AkritesStatus[]>(AKRITES_DEFAULT_VISIBLE_STATUSES);
  protected readonly initialLoading = computed(() => this.loadResult() === undefined);
  protected readonly loadError = computed(() => this.loadResult()?.error ?? false);
  protected readonly packages = computed<AkritesPackage[]>(() => this.loadResult()?.packages ?? []);
  protected readonly metrics = computed<AkritesMetrics | undefined>(() => this.metricsResult());
  protected readonly scatterPoints = computed<AkritesScatterPoint[]>(() => this.scatterResult() ?? []);

  protected readonly total = computed<number>(() => this.loadResult()?.total ?? 0);

  protected readonly statusCounts = computed<AkritesStatusCounts>(() => {
    const fromApi = this.loadResult()?.statusCounts;
    if (fromApi) return fromApi;
    return { all: 0, unassigned: 0, open: 0, assessing: 0, active: 0, needs_attention: 0, escalated: 0, blocked: 0, inactive: 0 };
  });

  protected readonly selectedPackageStatus = computed(() => {
    const id = this.selectedPackageId();
    if (!id) return null;
    return this.packages().find((p) => p.id === id)?.status ?? null;
  });

  protected setActiveTab(tab: AkritesDashboardTab): void {
    if (tab === 'overview') {
      this.selectedPackageId.set(null);
      this.drawerVisible.set(false);
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === AKRITES_DEFAULT_TAB ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onOverviewNavigate(filter: Partial<AkritesFilterState>): void {
    this.onFilterChange(filter);
    this.setActiveTab('packages');
  }

  protected onOverviewResolveEscalation(purl: string): void {
    this.akritesService
      .getPackage(purl)
      .pipe(
        take(1),
        switchMap((pkg) => {
          if (!pkg || pkg.status !== 'escalated' || pkg.stewardshipId === null) {
            // Already resolved or not escalated — open drawer to show current state
            if (pkg) this.onPackageClick(pkg.id);
            return of(null);
          }
          return this.akritesService.updateStewardshipStatus(pkg.stewardshipId, { status: 'active' });
        }),
        catchError(() => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not resolve escalation. Please try again.' });
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        if (result !== null) {
          this.messageService.add({ severity: 'success', summary: 'Resolved', detail: 'Escalation resolved — package is now active.' });
          this.reloadTrigger.update((n) => n + 1);
        }
      });
  }

  protected onOverviewPackageClick(purl: string): void {
    const pkg = this.packages().find((p) => p.purl === purl);
    if (pkg) {
      this.onPackageClick(pkg.id);
      return;
    }
    // Package not in loaded list — fetch by PURL so we can open the drawer directly
    this.akritesService
      .getPackage(purl)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fetched) => {
          if (fetched) {
            this.onPackageClick(fetched.id);
          }
        },
        error: () => {
          this.onFilterChange({ search: purl });
          this.setActiveTab('packages');
        },
      });
  }

  protected onPackageClick(id: string): void {
    this.selectedPackageId.set(id);
    this.drawerVisible.set(true);
  }

  protected onDrawerClose(): void {
    this.drawerVisible.set(false);
    this.selectedPackageId.set(null);
  }

  protected onStewardshipChanged(): void {
    this.reloadTrigger.update((n) => n + 1);
  }

  protected onFilterChange(partial: Partial<AkritesFilterState>): void {
    this.filters.update((current) => ({ ...current, ...partial, page: 1 }));
  }

  protected onPageChange(event: { page: number; pageSize: number }): void {
    this.filters.update((current) => ({ ...current, page: event.page, pageSize: event.pageSize }));
  }

  protected onTogglePackage(payload: { id: string; event: Event }): void {
    payload.event.stopPropagation();
    const selected = new Set(this.selectedPackages());
    if (selected.has(payload.id)) {
      selected.delete(payload.id);
    } else {
      selected.add(payload.id);
    }
    this.selectedPackages.set(selected);
  }

  protected onToggleAll(payload: { checked: boolean }): void {
    const pkgs = this.packages();
    const selected = new Set(this.selectedPackages());
    if (payload.checked) {
      pkgs.forEach((p) => selected.add(p.id));
    } else {
      pkgs.forEach((p) => selected.delete(p.id));
    }
    this.selectedPackages.set(selected);
  }

  protected clearSelection(): void {
    this.selectedPackages.set(new Set());
  }

  protected onBulkOpen(): void {
    const selected = this.selectedPackages();
    const unassigned = this.packages().filter((p) => selected.has(p.id) && p.status === 'unassigned');
    if (this.bulkActionLoading()) return;
    if (!unassigned.length) {
      this.messageService.add({ severity: 'info', summary: 'No eligible packages', detail: 'All selected packages are already stewarded.' });
      return;
    }
    this.bulkActionLoading.set(true);
    forkJoin(
      unassigned.map((p) =>
        this.akritesService.openStewardship(p.purl).pipe(
          map(() => true),
          catchError(() => of(false))
        )
      )
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
          const succeeded = results.filter(Boolean).length;
          const failed = results.length - succeeded;
          this.bulkActionLoading.set(false);
          if (succeeded > 0) {
            this.messageService.add({
              severity: failed > 0 ? 'warn' : 'success',
              summary: failed > 0 ? 'Partial success' : 'Success',
              detail: failed > 0 ? `${succeeded} opened, ${failed} failed.` : `${succeeded} package(s) opened for stewardship.`,
            });
            this.clearSelection();
            this.reloadTrigger.update((n) => n + 1);
          } else {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No packages could be opened. Please try again.' });
          }
        },
        error: () => {
          this.bulkActionLoading.set(false);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Some packages could not be opened. Please try again.' });
        },
      });
  }

  protected onBulkAssignSteward(): void {
    this.bulkAssignStewardVisible.set(true);
  }

  protected onBulkAssignStewardConfirm(body: AkritesAssignStewardRequest): void {
    const selected = this.selectedPackages();
    const eligible = this.packages().filter((p) => selected.has(p.id) && AKRITES_ASSIGNABLE_STATUSES.has(p.status));
    if (this.bulkActionLoading()) return;
    if (!eligible.length) {
      this.bulkAssignStewardVisible.set(false);
      this.messageService.add({
        severity: 'info',
        summary: 'No eligible packages',
        detail: 'None of the selected packages are eligible for steward assignment.',
      });
      return;
    }
    this.bulkAssignStewardVisible.set(false);
    this.bulkActionLoading.set(true);
    forkJoin(
      eligible.map((p) => {
        const stewardshipId$ =
          p.stewardshipId !== null ? of(String(p.stewardshipId)) : this.akritesService.openStewardship(p.purl).pipe(map((res) => res.stewardship.id));
        return stewardshipId$.pipe(
          switchMap((id) => this.akritesService.assignSteward(id, body)),
          map(() => true),
          catchError(() => of(false))
        );
      })
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
          const succeeded = results.filter(Boolean).length;
          const failed = results.length - succeeded;
          this.bulkActionLoading.set(false);
          if (succeeded > 0) {
            this.messageService.add({
              severity: failed > 0 ? 'warn' : 'success',
              summary: failed > 0 ? 'Partial success' : 'Success',
              detail: failed > 0 ? `${succeeded} assigned, ${failed} failed.` : `Steward assigned to ${succeeded} package(s).`,
            });
            this.clearSelection();
            this.reloadTrigger.update((n) => n + 1);
          } else {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No packages could be assigned. Please try again.' });
          }
        },
      });
  }

  protected onBulkEscalate(): void {
    this.bulkEscalateVisible.set(true);
  }

  protected onBulkEscalateConfirm(body: AkritesEscalateRequest): void {
    const selected = this.selectedPackages();
    const eligible = this.packages().filter((p) => selected.has(p.id) && p.stewardshipId !== null);
    if (this.bulkActionLoading()) return;
    if (!eligible.length) {
      this.bulkEscalateVisible.set(false);
      this.messageService.add({
        severity: 'info',
        summary: 'No eligible packages',
        detail: 'None of the selected packages have an active stewardship record.',
      });
      return;
    }
    this.bulkEscalateVisible.set(false);
    this.bulkActionLoading.set(true);
    forkJoin(
      eligible.map((p) =>
        this.akritesService.escalateStewardship(p.stewardshipId!, body).pipe(
          map(() => true),
          catchError(() => of(false))
        )
      )
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
          const succeeded = results.filter(Boolean).length;
          const failed = results.length - succeeded;
          this.bulkActionLoading.set(false);
          if (succeeded > 0) {
            this.messageService.add({
              severity: failed > 0 ? 'warn' : 'success',
              summary: failed > 0 ? 'Partial success' : 'Success',
              detail: failed > 0 ? `${succeeded} escalated, ${failed} failed.` : `${succeeded} package(s) escalated.`,
            });
            this.clearSelection();
            this.reloadTrigger.update((n) => n + 1);
          } else {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No packages could be escalated. Please try again.' });
          }
        },
        error: () => {
          this.bulkActionLoading.set(false);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Escalation failed. Please try again.' });
        },
      });
  }

  protected onRiskMatrixFilterChange(visible: AkritesStatus[]): void {
    this.riskMatrixVisibleStatuses.set(visible);
  }

  protected onSortChange(sort: string): void {
    this.filters.update((current) => ({ ...current, sort: sort as AkritesSortKey, page: 1 }));
  }

  protected onClearFilters(): void {
    this.onFilterChange({
      search: '',
      tab: 'all',
      sort: 'risk',
      ecosystem: '',
      lifecycle: '',
      healthBand: '',
      vulnFilter: '',
      busFactor1Only: false,
      staleOnly: false,
      unstewardedOnly: false,
    });
    this.clearSelection();
  }

  private initActiveTab() {
    const queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
    return computed<AkritesDashboardTab>(() => {
      const raw = queryParamMap().get('tab');
      return raw && AKRITES_VALID_TABS.has(raw as AkritesDashboardTab) ? (raw as AkritesDashboardTab) : AKRITES_DEFAULT_TAB;
    });
  }

  private initMetrics() {
    return toSignal<AkritesMetrics | undefined>(
      this.akritesService.getMetrics().pipe(
        tap(() => this.metricsLoading.set(false)),
        catchError((err) => {
          console.warn('[AKRITES] metrics fetch failed — overview KPIs will show zeros', err);
          this.metricsLoading.set(false);
          return of(undefined);
        })
      )
    );
  }

  private initScatterResult() {
    const source = computed(() => ({
      tab: this.activeTab(),
      reload: this.reloadTrigger(),
      visibleStatuses: this.riskMatrixVisibleStatuses(),
    }));
    return toSignal(
      toObservable(source).pipe(
        filter(({ tab }) => tab === 'risk-matrix'),
        tap(() => this.scatterLoading.set(true)),
        switchMap(({ visibleStatuses }) => {
          const statusFilter = visibleStatuses.length < AKRITES_TOTAL_STATUSES ? visibleStatuses : undefined;
          return this.akritesService.getScatterData(statusFilter).pipe(
            map((res): AkritesScatterPoint[] => res.points),
            catchError((err) => {
              console.warn('[AKRITES] scatter fetch failed', err);
              return of<AkritesScatterPoint[]>([]);
            }),
            tap(() => this.scatterLoading.set(false))
          );
        })
      )
    );
  }

  private initLoadResult() {
    // Combine filters with the reload trigger so a steward action re-fetches the list even when filters are unchanged.
    const source = computed(() => ({ f: this.filters(), reload: this.reloadTrigger() }));
    return toSignal<AkritesLoadResult | undefined>(
      toObservable(source).pipe(
        tap(() => this.tableLoading.set(true)),
        debounceTime(300),
        switchMap(({ f }) => {
          const params: AkritesListParams = {
            page: f.page,
            pageSize: f.pageSize,
            sortBy: f.sort,
            search: f.search || undefined,
            status: f.tab !== 'all' ? f.tab : undefined,
            ecosystem: f.ecosystem || undefined,
            lifecycle: f.lifecycle || undefined,
            healthBand: f.healthBand || undefined,
            vulnFilter: f.vulnFilter || undefined,
            busFactor1Only: f.busFactor1Only || undefined,
            staleOnly: f.staleOnly || undefined,
            unstewardedOnly: f.unstewardedOnly || undefined,
          };
          return this.akritesService.getPackages(params).pipe(
            map((res): AkritesLoadResult => ({ packages: res.packages ?? [], total: res.total ?? null, error: false, statusCounts: res.statusCounts ?? null })),
            catchError(() => of<AkritesLoadResult>({ packages: [], total: null, error: true, statusCounts: null }))
          );
        }),
        tap(() => this.tableLoading.set(false))
      )
    );
  }
}
