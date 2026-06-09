// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, of, skip, switchMap } from 'rxjs';
import { DrawerModule } from 'primeng/drawer';

import { OsspreyPackage } from '@lfx-one/shared/interfaces';
import { OsspreyService } from '@shared/services/ossprey.service';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { TagSeverity } from '@lfx-one/shared/interfaces';
import { getAdvisoryTagSeverity, getLifecycleLabel, getLifecycleTagSeverity } from '../../ossprey.utils';

type DrawerTab = 'overview' | 'assessment' | 'security' | 'provenance';

@Component({
  selector: 'lfx-ossprey-package-drawer',
  imports: [DrawerModule, ButtonComponent, EmptyStateComponent, TagComponent],
  templateUrl: './ossprey-package-drawer.component.html',
  styleUrl: './ossprey-package-drawer.component.scss',
})
export class OsspreyPackageDrawerComponent {
  private readonly osspreyService = inject(OsspreyService);

  public readonly visible = model(false);
  public readonly packageId = input<string | null>(null);

  protected readonly activeTab = signal<DrawerTab>('overview');
  protected readonly packageData = signal<OsspreyPackage | null>(null);

  protected readonly getLifecycleLabel = getLifecycleLabel;
  protected readonly getLifecycleTagSeverity = getLifecycleTagSeverity;
  protected readonly getAdvisoryTagSeverity = getAdvisoryTagSeverity;

  public constructor() {
    toObservable(this.visible)
      .pipe(
        skip(1),
        switchMap(() => {
          const id = this.packageId();
          if (!id) return of(null);
          return this.osspreyService.getPackage(id).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed()
      )
      .subscribe((pkg) => {
        this.packageData.set(pkg);
      });
  }

  protected onTabChange(tab: DrawerTab): void {
    this.activeTab.set(tab);
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  protected getHealthBreakdownPercent(item: string): number {
    const num = parseInt(item, 10);
    return (num / 40) * 100;
  }

  protected getMonthsStaleTagSeverity(monthsStale: number | null): TagSeverity {
    if (monthsStale === null) return 'secondary';
    return monthsStale >= 18 ? 'warn' : 'secondary';
  }

  protected getProvenanceTagSeverity(provenance: string | null): TagSeverity {
    if (!provenance) return 'secondary';
    if (provenance === 'Full') return 'success';
    if (provenance === 'Partial') return 'warn';
    return 'secondary';
  }
}
