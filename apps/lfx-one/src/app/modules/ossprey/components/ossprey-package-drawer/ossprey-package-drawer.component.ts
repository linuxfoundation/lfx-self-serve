// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { DrawerModule } from 'primeng/drawer';
import { skip, switchMap } from 'rxjs';

import { OsspreyPackage } from '@lfx-one/shared/interfaces';
import { OsspreyService } from '@shared/services/ossprey.service';

@Component({
  selector: 'lfx-ossprey-package-drawer',
  standalone: true,
  imports: [CommonModule, DrawerModule],
  templateUrl: './ossprey-package-drawer.component.html',
  styleUrl: './ossprey-package-drawer.component.scss',
})
export class OsspreyPackageDrawerComponent {
  private readonly osspreyService = inject(OsspreyService);

  protected readonly visible = model(false);
  protected readonly packageId = input<string | null>(null);

  protected readonly activeTab = signal<'overview' | 'security' | 'provenance'>('overview');
  protected readonly packageData = signal<OsspreyPackage | null>(null);

  protected constructor() {
    // Load package data when visible changes
    toObservable(this.visible)
      .pipe(
        skip(1),
        switchMap(() => {
          const id = this.packageId();
          if (!id) {
            return [];
          }
          return this.osspreyService.getPackage(id);
        }),
        takeUntilDestroyed()
      )
      .subscribe((pkg) => {
        this.packageData.set(pkg);
      });
  }

  protected onTabChange(tab: 'overview' | 'security' | 'provenance'): void {
    this.activeTab.set(tab);
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
}
