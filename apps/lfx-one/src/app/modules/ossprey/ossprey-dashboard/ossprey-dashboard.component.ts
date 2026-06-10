// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { OsspreyDashboardSortSpec, OsspreyFilterState, OsspreyListParams, OsspreyPackage, OsspreyStatusCounts } from '@lfx-one/shared/interfaces';
import { switchMap, catchError, of, map, timer } from 'rxjs';
import { OsspreyService } from '@shared/services/ossprey.service';
import { OsspreyPackageDrawerComponent } from '../components/ossprey-package-drawer/ossprey-package-drawer.component';
import { OsspreyPackagesTabComponent } from '../components/ossprey-packages-tab/ossprey-packages-tab.component';

@Component({
  selector: 'lfx-ossprey-dashboard',
  imports: [OsspreyPackageDrawerComponent, OsspreyPackagesTabComponent],
  templateUrl: './ossprey-dashboard.component.html',
  styleUrl: './ossprey-dashboard.component.scss',
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

  protected readonly packages = this.initPackages();
  protected readonly loading = computed(() => this.packages() === undefined);

  protected readonly coveredCount = computed(() => {
    return (this.packages() ?? []).filter((p) => p.status === 'active' || p.status === 'assessing').length;
  });

  protected readonly coveragePercent = computed(() => {
    const total = (this.packages() ?? []).length;
    return total === 0 ? 0 : Math.round((this.coveredCount() / total) * 100);
  });

  protected readonly statusCounts = computed<OsspreyStatusCounts>(() => {
    const pkgs = this.packages() ?? [];
    return {
      all: pkgs.length,
      unassigned: pkgs.filter((p) => p.status === 'unassigned').length,
      open: pkgs.filter((p) => p.status === 'open').length,
      assessing: pkgs.filter((p) => p.status === 'assessing').length,
      active: pkgs.filter((p) => p.status === 'active').length,
      needs_attention: pkgs.filter((p) => p.status === 'needs_attention').length,
      escalated: pkgs.filter((p) => p.status === 'escalated').length,
      blocked: pkgs.filter((p) => p.status === 'blocked').length,
      inactive: pkgs.filter((p) => p.status === 'inactive').length,
    };
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
    const pkgs = this.packages() ?? [];
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

  private initPackages() {
    return toSignal<OsspreyPackage[] | undefined>(
      toObservable(this.filters).pipe(
        switchMap((f) => {
          // 'risk' is intentionally absent — no sort params means the server applies its
          // own composite risk ordering rather than a simple field sort.
          const sortByMap: Record<string, OsspreyDashboardSortSpec> = {
            impact: { sortBy: 'impact', sortDir: 'desc' },
            health: { sortBy: 'health', sortDir: 'asc' },
            vulns: { sortBy: 'openVulns', sortDir: 'desc' },
            name: { sortBy: 'name', sortDir: 'asc' },
          };
          const sortSpec = sortByMap[f.sort];
          const params: OsspreyListParams = {
            ...(sortSpec ? { sortBy: sortSpec.sortBy, sortDir: sortSpec.sortDir } : {}),
            ecosystem: f.ecosystem || undefined,
            lifecycle: f.lifecycle || undefined,
            busFactor1Only: f.busFactor1Only || undefined,
            staleOnly: f.staleOnly || undefined,
            unstewardedOnly: f.unstewardedOnly || undefined,
          };
          return this.osspreyService.getPackages(params).pipe(
            map((res) => res.packages ?? []),
            catchError(() => of([] as OsspreyPackage[]))
          );
        })
      )
    );
  }
}
