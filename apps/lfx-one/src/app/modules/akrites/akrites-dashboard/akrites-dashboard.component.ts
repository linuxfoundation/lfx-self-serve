// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CDP_CONFIG } from '@lfx-one/shared/constants';
import {
  AkritesFilterState,
  AkritesListParams,
  AkritesLoadResult,
  AkritesMetrics,
  AkritesPackage,
  AkritesSortKey,
  AkritesStatusCounts,
  AkritesEscalateRequest,
} from '@lfx-one/shared/interfaces';
import { switchMap, catchError, of, map, timer, debounceTime, tap, forkJoin, take } from 'rxjs';
import { MessageService } from 'primeng/api';
import { AkritesService } from '@shared/services/akrites.service';
import { AkritesPackageDrawerComponent } from '../components/akrites-package-drawer/akrites-package-drawer.component';
import { AkritesPackagesTabComponent } from '../components/akrites-packages-tab/akrites-packages-tab.component';
import { AkritesEscalateModalComponent } from '../components/akrites-escalate-modal/akrites-escalate-modal.component';
import { AkritesOverviewTabComponent } from '../components/akrites-overview-tab/akrites-overview-tab.component';

export type AkritesDashboardTab = 'overview' | 'packages';

@Component({
  selector: 'lfx-akrites-dashboard',
  imports: [AkritesPackageDrawerComponent, AkritesPackagesTabComponent, AkritesEscalateModalComponent, AkritesOverviewTabComponent],
  templateUrl: './akrites-dashboard.component.html',
})
export class AkritesDashboardComponent {
  private readonly akritesService = inject(AkritesService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly activeTab = signal<AkritesDashboardTab>('overview');
  protected readonly selectedPackageId = signal<string | null>(null);
  protected readonly drawerVisible = signal(false);
  protected readonly selectedPackages = signal<Set<string>>(new Set());
  protected readonly showBulkActions = computed(() => this.selectedPackages().size > 0);
  protected readonly bulkEscalateVisible = signal(false);
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
  });

  private readonly loadResult = this.initLoadResult();
  private readonly metricsResult = this.initMetrics();

  protected readonly tableLoading = signal(true);
  protected readonly metricsLoading = signal(true);
  protected readonly initialLoading = computed(() => this.loadResult() === undefined);
  protected readonly loadError = computed(() => this.loadResult()?.error ?? false);
  protected readonly packages = computed<AkritesPackage[]>(() => this.loadResult()?.packages ?? []);
  protected readonly metrics = computed<AkritesMetrics | undefined>(() => this.metricsResult());

  protected readonly statusCounts = computed<AkritesStatusCounts>(() => {
    const fromApi = this.loadResult()?.statusCounts;
    if (fromApi) return fromApi;
    // Fall back to zeros while the first load is in flight.
    return { all: 0, unassigned: 0, open: 0, assessing: 0, active: 0, needs_attention: 0, escalated: 0, blocked: 0, inactive: 0 };
  });

  protected readonly selectedPackageStatus = computed(() => {
    const id = this.selectedPackageId();
    if (!id) return null;
    return this.packages().find((p) => p.id === id)?.status ?? null;
  });

  protected setActiveTab(tab: AkritesDashboardTab): void {
    this.activeTab.set(tab);
  }

  protected onOverviewNavigate(filter: Partial<AkritesFilterState>): void {
    this.onFilterChange(filter);
    this.activeTab.set('packages');
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
          this.activeTab.set('packages');
        },
      });
  }

  protected onPackageClick(id: string): void {
    this.selectedPackageId.set(id);
    this.drawerVisible.set(true);
  }

  protected onDrawerClose(): void {
    this.drawerVisible.set(false);
    // Bump so the activity feed and package list reflect any changes made in the drawer.
    this.reloadTrigger.update((n) => n + 1);
    timer(300)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.drawerVisible()) this.selectedPackageId.set(null);
      });
  }

  protected onStewardshipChanged(): void {
    this.reloadTrigger.update((n) => n + 1);
  }

  protected onFilterChange(partial: Partial<AkritesFilterState>): void {
    this.filters.update((current) => ({ ...current, ...partial }));
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

  protected onSortChange(sort: string): void {
    this.filters.update((current) => ({ ...current, sort: sort as AkritesSortKey }));
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

  private initLoadResult() {
    // Combine filters with the reload trigger so a steward action re-fetches the list even when filters are unchanged.
    const source = computed(() => ({ f: this.filters(), reload: this.reloadTrigger() }));
    return toSignal<AkritesLoadResult | undefined>(
      toObservable(source).pipe(
        tap(() => this.tableLoading.set(true)),
        debounceTime(300),
        switchMap(({ f }) => {
          // v1: table is capped at MAX_PAGE_SIZE rows; KPI strip shows aggregate totals from /metrics.
          // Divergence is intentional for v1 — pagination will align them in a future iteration.
          const params: AkritesListParams = {
            pageSize: CDP_CONFIG.MAX_PAGE_SIZE,
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
