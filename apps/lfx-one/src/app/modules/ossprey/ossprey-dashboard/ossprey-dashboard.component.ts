// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CDP_CONFIG } from '@lfx-one/shared/constants';
import {
  OsspreyDashboardSortSpec,
  OsspreyFilterState,
  OsspreyListParams,
  OsspreyLoadResult,
  OsspreyPackage,
  OspreySortKey,
  OsspreyStatusCounts,
} from '@lfx-one/shared/interfaces';
import { switchMap, catchError, of, map, timer, debounceTime } from 'rxjs';
import { OsspreyService } from '@shared/services/ossprey.service';
import { OsspreyPackageDrawerComponent } from '../components/ossprey-package-drawer/ossprey-package-drawer.component';
import { OsspreyPackagesTabComponent } from '../components/ossprey-packages-tab/ossprey-packages-tab.component';
import { getHealthBand, getRiskScore } from '../ossprey.utils';

@Component({
  selector: 'lfx-ossprey-dashboard',
  imports: [OsspreyPackageDrawerComponent, OsspreyPackagesTabComponent],
  templateUrl: './ossprey-dashboard.component.html',
})
export class OsspreyDashboardComponent {
  private readonly osspreyService = inject(OsspreyService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly selectedPackageId = signal<string | null>(null);
  protected readonly drawerVisible = signal(false);
  protected readonly selectedPackages = signal<Set<string>>(new Set());
  protected readonly showBulkActions = computed(() => this.selectedPackages().size > 0);

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

  protected readonly loading = computed(() => this.loadResult() === undefined);
  protected readonly loadError = computed(() => this.loadResult()?.error ?? false);
  protected readonly packages = computed<OsspreyPackage[]>(() => this.loadResult()?.packages ?? []);
  protected readonly totalPackages = computed(() => this.loadResult()?.total ?? this.packages().length);

  // Search / status tab / health band / vuln filters are applied client-side —
  // the CDP list endpoint only supports ecosystem, lifecycle, and the
  // coverage-gap toggles (those go through the API in initLoadResult).
  protected readonly filteredPackages = computed<OsspreyPackage[]>(() => {
    const f = this.filters();
    const query = f.search.trim().toLowerCase();
    let result = this.packages().filter((pkg) => {
      if (f.tab !== 'all' && pkg.status !== f.tab) return false;
      if (query && !`${pkg.name} ${pkg.purl}`.toLowerCase().includes(query)) return false;
      if (f.healthBand && (pkg.healthScore === null || getHealthBand(pkg.healthScore) !== f.healthBand)) return false;
      if (f.vulnFilter === 'any' && pkg.vulnCount === 0) return false;
      if (f.vulnFilter === 'high' && pkg.vulnSeverity !== 'high' && pkg.vulnSeverity !== 'critical') return false;
      if (f.vulnFilter === 'critical' && pkg.vulnSeverity !== 'critical') return false;
      return true;
    });

    // 'risk' is a composite ordering the API doesn't provide — sort client-side.
    if (f.sort === 'risk') {
      result = [...result].sort((a, b) => getRiskScore(b) - getRiskScore(a));
    }

    return result;
  });

  protected readonly coveredCount = computed(() => {
    return this.packages().filter((p) => p.status === 'active' || p.status === 'assessing').length;
  });

  protected readonly coveragePercent = computed(() => {
    const total = this.packages().length;
    return total === 0 ? 0 : Math.round((this.coveredCount() / total) * 100);
  });

  protected readonly criticalCount = computed(() => this.packages().filter((p) => p.healthScore !== null && p.healthScore < 30).length);

  protected readonly statusCounts = computed<OsspreyStatusCounts>(() => {
    const pkgs = this.packages();
    return {
      all: pkgs.length,
      unassigned: pkgs.length,
      open: pkgs.filter((p) => p.status === 'open').length,
      assessing: pkgs.filter((p) => p.status === 'assessing').length,
      active: pkgs.filter((p) => p.status === 'active').length,
      needs_attention: pkgs.filter((p) => p.status === 'needs_attention').length,
      escalated: pkgs.filter((p) => p.status === 'escalated').length,
      blocked: pkgs.filter((p) => p.status === 'blocked').length,
      inactive: pkgs.filter((p) => p.status === 'inactive').length,
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
    const pkgs = this.filteredPackages();
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

  private initLoadResult() {
    return toSignal<OsspreyLoadResult | undefined>(
      toObservable(this.filters).pipe(
        debounceTime(300),
        switchMap((f) => {
          const sortByMap: Record<string, OsspreyDashboardSortSpec> = {
            impact: { sortBy: 'impact', sortDir: 'desc' },
            health: { sortBy: 'health', sortDir: 'asc' },
            vulns: { sortBy: 'openVulns', sortDir: 'desc' },
            name: { sortBy: 'name', sortDir: 'asc' },
          };
          // 'risk' is intentionally absent — it's a composite ordering applied
          // client-side in filteredPackages().
          const sortSpec = sortByMap[f.sort];
          const params: OsspreyListParams = {
            // Coverage/status KPIs are computed from the loaded set, so request
            // the maximum page the CDP API allows.
            pageSize: CDP_CONFIG.MAX_PAGE_SIZE,
            ...(sortSpec ? { sortBy: sortSpec.sortBy, sortDir: sortSpec.sortDir } : {}),
            ecosystem: f.ecosystem || undefined,
            lifecycle: f.lifecycle || undefined,
            busFactor1Only: f.busFactor1Only || undefined,
            staleOnly: f.staleOnly || undefined,
            unstewardedOnly: f.unstewardedOnly || undefined,
          };
          return this.osspreyService.getPackages(params).pipe(
            map((res): OsspreyLoadResult => ({ packages: res.packages ?? [], total: res.total ?? null, error: false })),
            catchError(() => of<OsspreyLoadResult>({ packages: [], total: null, error: true }))
          );
        })
      )
    );
  }
}
