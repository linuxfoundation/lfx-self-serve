// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, distinctUntilChanged, finalize, of, switchMap } from 'rxjs';
import { DrawerModule } from 'primeng/drawer';

import { OsspreyPackage, OsspreyStatus, TagSeverity } from '@lfx-one/shared/interfaces';
import { OsspreyService } from '@shared/services/ossprey.service';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  formatStatus,
  getAdvisoryTagSeverity,
  getHealthLabel,
  getHealthTagSeverity,
  getLifecycleLabel,
  getLifecycleTagSeverity,
  getStatusTagSeverity,
} from '../../ossprey.utils';

type DrawerTab = 'overview' | 'assessment' | 'security' | 'provenance' | 'history';

@Component({
  selector: 'lfx-ossprey-package-drawer',
  imports: [DrawerModule, ButtonComponent, EmptyStateComponent, TagComponent],
  templateUrl: './ossprey-package-drawer.component.html',
})
export class OsspreyPackageDrawerComponent {
  private readonly osspreyService = inject(OsspreyService);

  public readonly visible = model(false);
  public readonly packageId = input<string | null>(null);
  /** Stewardship state from the list row — the CDP detail endpoint doesn't return it. */
  public readonly packageStatus = input<OsspreyStatus | null>(null);

  protected readonly activeTab = signal<DrawerTab>('overview');
  protected readonly detailLoading = signal(false);
  protected readonly packageData: Signal<OsspreyPackage | null> = this.initPackageData();

  protected readonly drawerTabs: { key: DrawerTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'assessment', label: 'Assessment' },
    { key: 'security', label: 'Security' },
    { key: 'provenance', label: 'Provenance' },
    { key: 'history', label: 'History' },
  ];

  protected readonly stewardshipStatus = computed<OsspreyStatus>(() => this.packageStatus() ?? this.packageData()?.status ?? 'unassigned');

  protected readonly formatStatus = formatStatus;
  protected readonly getStatusTagSeverity = getStatusTagSeverity;
  protected readonly getLifecycleLabel = getLifecycleLabel;
  protected readonly getLifecycleTagSeverity = getLifecycleTagSeverity;
  protected readonly getAdvisoryTagSeverity = getAdvisoryTagSeverity;
  protected readonly getHealthLabel = getHealthLabel;
  protected readonly getHealthTagSeverity = getHealthTagSeverity;

  protected onTabChange(tab: DrawerTab): void {
    this.activeTab.set(tab);
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  protected getSafeRepoUrl(repoUrl: string | null): string | null {
    if (!repoUrl) return null;
    try {
      const url = new URL('https://' + repoUrl);
      return url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  protected getHealthBreakdownSlot(pkg: OsspreyPackage, index: number): string {
    // healthBreakdown is positional (maintainer / security / development) and
    // empty when CDP returns no health score at all.
    return pkg.healthBreakdown[index] || '—';
  }

  protected isStale(monthsStale: number | null): boolean {
    return monthsStale !== null && monthsStale >= 18;
  }

  protected getMappingTagSeverity(mapping: OsspreyPackage['supplyChainMapping']): TagSeverity {
    if (mapping === 'High') return 'success';
    if (mapping === 'Medium') return 'warn';
    if (mapping === 'Low') return 'danger';
    return 'secondary';
  }

  private initPackageData(): Signal<OsspreyPackage | null> {
    // Fetch only while the drawer is open for a concrete package; closing the
    // drawer maps to null instead of refiring the request.
    const fetchId = computed(() => (this.visible() ? this.packageId() : null));

    return toSignal(
      toObservable(fetchId).pipe(
        distinctUntilChanged(),
        switchMap((id) => {
          if (!id) return of(null);
          this.activeTab.set('overview');
          this.detailLoading.set(true);
          return this.osspreyService.getPackage(id).pipe(
            catchError(() => of(null)),
            finalize(() => this.detailLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
