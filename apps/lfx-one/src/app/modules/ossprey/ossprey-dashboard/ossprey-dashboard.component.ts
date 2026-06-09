// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { OsspreyFilterState, OsspreyListParams, OsspreyPackage, OsspreyStatusCounts } from '@lfx-one/shared/interfaces';
import { switchMap, catchError, of, map } from 'rxjs';
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
    setTimeout(() => this.selectedPackageId.set(null), 300);
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
          const params: OsspreyListParams = {
            sort: f.sort !== 'risk' ? f.sort : undefined,
            status: f.tab !== 'all' ? f.tab : undefined,
            ecosystem: f.ecosystem || undefined,
            lifecycle: f.lifecycle || undefined,
            healthBand: f.healthBand || undefined,
            vulnFilter: f.vulnFilter || undefined,
            search: f.search || undefined,
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
