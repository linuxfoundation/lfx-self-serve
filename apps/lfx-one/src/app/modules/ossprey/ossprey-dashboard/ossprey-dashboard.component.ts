// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { OsspreyFilterState, OsspreyPackage, OsspreyStats, OsspreyStatus } from '@lfx-one/shared/interfaces';
import { OsspreyService } from '@shared/services/ossprey.service';
import { OsspreyPackageDrawerComponent } from '../components/ossprey-package-drawer/ossprey-package-drawer.component';

@Component({
  selector: 'lfx-ossprey-dashboard',
  imports: [CommonModule, OsspreyPackageDrawerComponent],
  templateUrl: './ossprey-dashboard.component.html',
  styleUrl: './ossprey-dashboard.component.scss',
})
export class OsspreyDashboardComponent {
  private readonly osspreyService = inject(OsspreyService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // Tab management
  protected readonly activeTab = signal<'overview' | 'packages' | 'triage'>('overview');
  protected readonly selectedPackageId = signal<string | null>(null);
  protected readonly drawerVisible = signal(false);
  protected readonly loading = signal(true);

  // Filter state
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

  // Data signals
  protected readonly packages = toSignal(this.osspreyService.getPackages(), {
    initialValue: [] as OsspreyPackage[],
  });
  protected readonly stats = toSignal(this.osspreyService.getStats(), {
    initialValue: {
      totalPackages: 0,
      coveragePct: 0,
      activeStewards: 0,
      unassignedCritical: 0,
      needsAttention: 0,
      escalated: 0,
    } as OsspreyStats,
  });

  // Computed values
  protected readonly filteredPackages = computed(() => {
    const pkgs = this.packages();
    const f = this.filters();
    let result = [...pkgs];

    // Apply status filter
    if (f.tab !== 'all') {
      result = result.filter((p) => p.status === f.tab);
    }

    // Apply search
    if (f.search) {
      const term = f.search.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(term) || p.purl.toLowerCase().includes(term));
    }

    // Apply ecosystem filter
    if (f.ecosystem) {
      result = result.filter((p) => p.ecosystem === f.ecosystem);
    }

    // Apply lifecycle filter
    if (f.lifecycle) {
      result = result.filter((p) => p.lifecycle === f.lifecycle);
    }

    // Apply health band filter
    if (f.healthBand) {
      result = result.filter((p) => this.getHealthBand(p.healthScore) === f.healthBand);
    }

    // Apply vulnerability filter
    if (f.vulnFilter === 'critical') {
      result = result.filter((p) => p.vulnSeverity === 'critical');
    } else if (f.vulnFilter === 'high') {
      result = result.filter((p) => p.vulnSeverity === 'critical' || p.vulnSeverity === 'high');
    } else if (f.vulnFilter === 'any') {
      result = result.filter((p) => p.vulnCount > 0);
    }

    // Apply bus factor filter
    if (f.busFactor1Only) {
      result = result.filter((p) => p.busFactor === 1);
    }

    // Apply stale filter
    if (f.staleOnly) {
      result = result.filter((p) => p.monthsStale >= 12);
    }

    // Apply unsteward filter
    if (f.unstewardedOnly) {
      result = result.filter((p) => p.stewardIds.length === 0);
    }

    // Apply sorting
    switch (f.sort) {
      case 'impact':
        result.sort((a, b) => b.impactScore - a.impactScore);
        break;
      case 'health':
        result.sort((a, b) => b.healthScore - a.healthScore);
        break;
      case 'vulns':
        result.sort((a, b) => b.vulnCount - a.vulnCount);
        break;
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'risk':
      default:
        result.sort((a, b) => {
          const riskA = b.impactScore * (b.vulnCount + 1);
          const riskB = a.impactScore * (a.vulnCount + 1);
          return riskA - riskB;
        });
        break;
    }

    return result;
  });

  protected readonly statusCounts = computed(() => {
    const pkgs = this.packages();
    return {
      all: pkgs.length,
      unassigned: this.countByStatus(pkgs, 'unassigned'),
      open: this.countByStatus(pkgs, 'open'),
      assessing: this.countByStatus(pkgs, 'assessing'),
      active: this.countByStatus(pkgs, 'active'),
      needs_attention: this.countByStatus(pkgs, 'needs_attention'),
      escalated: this.countByStatus(pkgs, 'escalated'),
    };
  });

  constructor() {
    // Sync tab from query params
    this.route.queryParams.pipe(takeUntilDestroyed()).subscribe((params) => {
      const tab = params['tab'];
      if (tab && ['overview', 'packages', 'triage'].includes(tab)) {
        this.activeTab.set(tab);
      }
    });

    // Simulate loading completion
    setTimeout(() => this.loading.set(false), 300);
  }

  protected onTabChange(tab: 'overview' | 'packages' | 'triage'): void {
    this.activeTab.set(tab);
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab }, queryParamsHandling: 'merge' });
  }

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

  protected onSortChange(value: string): void {
    this.onFilterChange({ sort: value as any });
  }

  protected onClearFilters(): void {
    this.filters.set({
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
  }

  protected onStatusClick(status: OsspreyStatus): void {
    this.activeTab.set('packages');
    this.onFilterChange({ tab: status });
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab: 'packages' }, queryParamsHandling: 'merge' });
  }

  protected getHealthBand(score: number): 'healthy' | 'fair' | 'concerning' | 'critical' {
    if (score >= 75) return 'healthy';
    if (score >= 50) return 'fair';
    if (score >= 25) return 'concerning';
    return 'critical';
  }

  protected getHealthLabel(score: number): string {
    const band = this.getHealthBand(score);
    return band.charAt(0).toUpperCase() + band.slice(1);
  }

  protected getLifecycleLabel(lifecycle: string): string {
    return lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1);
  }

  private countByStatus(packages: OsspreyPackage[], status: OsspreyStatus): number {
    return packages.filter((p) => p.status === status).length;
  }
}
