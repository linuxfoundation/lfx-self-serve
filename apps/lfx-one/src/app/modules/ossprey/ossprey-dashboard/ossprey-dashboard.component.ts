// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CDP_CONFIG } from '@lfx-one/shared/constants';
import {
  OsspreyFilterState,
  OsspreyListParams,
  OsspreyLoadResult,
  OsspreyMetrics,
  OsspreyPackage,
  OspreySortKey,
  OsspreyStatusCounts,
  OsspreyEscalateRequest,
} from '@lfx-one/shared/interfaces';
import { switchMap, catchError, of, map, timer, debounceTime, tap, forkJoin } from 'rxjs';
import { MessageService } from 'primeng/api';
import { OsspreyService } from '@shared/services/ossprey.service';
import { OsspreyPackageDrawerComponent } from '../components/ossprey-package-drawer/ossprey-package-drawer.component';
import { OsspreyPackagesTabComponent } from '../components/ossprey-packages-tab/ossprey-packages-tab.component';
import { OsspreyEscalateModalComponent } from '../components/ossprey-escalate-modal/ossprey-escalate-modal.component';

@Component({
  selector: 'lfx-ossprey-dashboard',
  imports: [OsspreyPackageDrawerComponent, OsspreyPackagesTabComponent, OsspreyEscalateModalComponent],
  templateUrl: './ossprey-dashboard.component.html',
})
export class OsspreyDashboardComponent {
  private readonly osspreyService = inject(OsspreyService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly selectedPackageId = signal<string | null>(null);
  protected readonly drawerVisible = signal(false);
  protected readonly selectedPackages = signal<Set<string>>(new Set());
  protected readonly showBulkActions = computed(() => this.selectedPackages().size > 0);
  protected readonly bulkEscalateVisible = signal(false);
  protected readonly bulkActionLoading = signal(false);

  // Bumped after a steward admin action to force the package list to re-fetch.
  private readonly reloadTrigger = signal(0);

  protected readonly filters = signal<OsspreyFilterState>({
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
  protected readonly initialLoading = computed(() => this.loadResult() === undefined);
  protected readonly loadError = computed(() => this.loadResult()?.error ?? false);
  protected readonly packages = computed<OsspreyPackage[]>(() => this.loadResult()?.packages ?? []);
  protected readonly totalPackages = computed(() => this.metricsResult()?.totalPackages ?? 0);

  protected readonly criticalCount = computed(() => this.metricsResult()?.criticalPackages ?? 0);

  protected readonly statusCounts = computed<OsspreyStatusCounts>(() => {
    const total = this.totalPackages();
    return {
      all: total,
      unassigned: total,
      open: 0,
      assessing: 0,
      active: 0,
      needs_attention: 0,
      escalated: 0,
      blocked: 0,
      inactive: 0,
    };
  });

  protected readonly selectedPackageStatus = computed(() => {
    const id = this.selectedPackageId();
    if (!id) return null;
    return this.packages().find((p) => p.id === id)?.status ?? null;
  });

  protected onPackageClick(id: string): void {
    this.selectedPackageId.set(id);
    this.drawerVisible.set(true);
  }

  protected onDrawerClose(): void {
    this.drawerVisible.set(false);
    timer(300)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.selectedPackageId.set(null));
  }

  protected onStewardshipChanged(): void {
    this.reloadTrigger.update((n) => n + 1);
  }

  protected onFilterChange(partial: Partial<OsspreyFilterState>): void {
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
    if (!unassigned.length || this.bulkActionLoading()) return;
    this.bulkActionLoading.set(true);
    forkJoin(unassigned.map((p) => this.osspreyService.openStewardship(p.purl).pipe(catchError(() => of(null))))).subscribe({
      next: () => {
        this.bulkActionLoading.set(false);
        this.messageService.add({ severity: 'success', summary: 'Success', detail: `${unassigned.length} package(s) opened for stewardship.` });
        this.clearSelection();
        this.reloadTrigger.update((n) => n + 1);
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

  protected onBulkEscalateConfirm(body: OsspreyEscalateRequest): void {
    const selected = this.selectedPackages();
    const eligible = this.packages().filter((p) => selected.has(p.id) && p.stewardshipId !== null);
    if (!eligible.length || this.bulkActionLoading()) return;
    this.bulkEscalateVisible.set(false);
    this.bulkActionLoading.set(true);
    forkJoin(eligible.map((p) => this.osspreyService.escalateStewardship(p.stewardshipId!, body).pipe(catchError(() => of(null))))).subscribe({
      next: () => {
        this.bulkActionLoading.set(false);
        this.messageService.add({ severity: 'success', summary: 'Success', detail: `${eligible.length} package(s) escalated.` });
        this.clearSelection();
        this.reloadTrigger.update((n) => n + 1);
      },
      error: () => {
        this.bulkActionLoading.set(false);
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Escalation failed. Please try again.' });
      },
    });
  }

  protected onSortChange(sort: string): void {
    this.filters.update((current) => ({ ...current, sort: sort as OspreySortKey }));
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
    return toSignal<OsspreyMetrics | undefined>(
      this.osspreyService.getMetrics().pipe(
        catchError((err) => {
          console.warn('[OSSPREY] metrics fetch failed — KPI strip will show zeros', err);
          return of(undefined);
        })
      )
    );
  }

  private initLoadResult() {
    // Combine filters with the reload trigger so a steward action re-fetches the list even when filters are unchanged.
    const source = computed(() => ({ f: this.filters(), reload: this.reloadTrigger() }));
    return toSignal<OsspreyLoadResult | undefined>(
      toObservable(source).pipe(
        tap(() => this.tableLoading.set(true)),
        debounceTime(300),
        switchMap(({ f }) => {
          // v1: table is capped at MAX_PAGE_SIZE rows; KPI strip shows aggregate totals from /metrics.
          // Divergence is intentional for v1 — pagination will align them in a future iteration.
          const params: OsspreyListParams = {
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
          return this.osspreyService.getPackages(params).pipe(
            map((res): OsspreyLoadResult => ({ packages: res.packages ?? [], total: res.total ?? null, error: false })),
            catchError(() => of<OsspreyLoadResult>({ packages: [], total: null, error: true }))
          );
        }),
        tap(() => this.tableLoading.set(false))
      )
    );
  }
}
