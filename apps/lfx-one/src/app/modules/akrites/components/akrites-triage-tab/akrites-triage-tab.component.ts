// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, TitleCasePipe } from '@angular/common';
import { Component, DestroyRef, Signal, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AKRITES_TRIAGE_COLUMNS, lfxColors } from '@lfx-one/shared/constants';
import {
  AkritesPackage,
  AkritesTriageBoardColumnConfig,
  AkritesTriageColumnState,
  AkritesTriagePackageVM,
  AkritesTriageStatus,
} from '@lfx-one/shared/interfaces';
import { AkritesService } from '@shared/services/akrites.service';
import { ProjectContextService } from '@shared/services/project-context.service';
import { MessageService } from 'primeng/api';
import { catchError, forkJoin, map, of, switchMap, take, tap } from 'rxjs';

@Component({
  selector: 'lfx-akrites-triage-tab',
  imports: [DecimalPipe, TitleCasePipe],
  templateUrl: './akrites-triage-tab.component.html',
})
export class AkritesTriageTabComponent {
  private readonly akritesService = inject(AkritesService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly reloadTrigger = input<number>(0);

  public readonly packageClick = output<string>();
  public readonly stewardshipChanged = output<void>();

  protected readonly TRIAGE_COLUMNS = AKRITES_TRIAGE_COLUMNS;
  protected readonly loading = signal(true);
  protected readonly canWrite = this.projectContextService.canWrite;

  protected readonly boardData = this.initBoardData();

  /** Keyed lookup so the template avoids per-cycle method calls. */
  protected readonly columnStates = computed<Record<AkritesTriageStatus, AkritesTriageColumnState>>(() => {
    const empty: AkritesTriageColumnState = { packages: [], total: 0, loading: true, error: false };
    const data = this.boardData();
    if (!data) return Object.fromEntries(AKRITES_TRIAGE_COLUMNS.map((c) => [c.status, empty])) as Record<AkritesTriageStatus, AkritesTriageColumnState>;
    return data;
  });

  protected readonly allColumnsEmpty = computed(() => {
    const data = this.boardData();
    if (data === undefined) return false;
    return AKRITES_TRIAGE_COLUMNS.every((col) => {
      const state = data[col.status];
      if (!state || state.error) return false;
      return state.total === 0;
    });
  });

  protected onCardClick(pkg: AkritesPackage): void {
    this.packageClick.emit(pkg.id);
  }

  protected onAction(event: Event, pkg: AkritesPackage, column: AkritesTriageBoardColumnConfig): void {
    event.stopPropagation();
    if ((column.status === 'escalated' || column.status === 'blocked') && pkg.stewardshipId) {
      this.resolvePackage(pkg);
    } else {
      this.packageClick.emit(pkg.id);
    }
  }

  private resolvePackage(pkg: AkritesPackage): void {
    this.akritesService
      .updateStewardshipStatus(pkg.stewardshipId!, { status: 'active' })
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Resolved', detail: `${pkg.name} has been resolved.` });
          this.stewardshipChanged.emit();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not resolve. Please try again.' });
        },
      });
  }

  private toVM(pkg: AkritesPackage): AkritesTriagePackageVM {
    return {
      ...pkg,
      healthColor: this.healthColor(pkg.healthScore),
      healthLabel: this.healthLabel(pkg.healthScore),
      vulnColor: this.vulnColor(pkg.vulnCount, pkg.vulnSeverity),
    };
  }

  private healthLabel(score: number | null): string {
    if (score === null) return '';
    if (score >= 70) return 'Healthy';
    if (score >= 50) return 'Fair';
    if (score >= 30) return 'Concerning';
    return 'Critical';
  }

  private healthColor(score: number | null): string {
    if (score === null) return lfxColors.gray[400];
    if (score >= 70) return lfxColors.emerald[500];
    if (score >= 50) return lfxColors.amber[500];
    if (score >= 30) return lfxColors.amber[600];
    return lfxColors.red[500];
  }

  private vulnColor(vulnCount: number, vulnSeverity: string | null): string {
    if (vulnCount === 0) return lfxColors.emerald[500];
    const colors: Record<string, string> = {
      critical: lfxColors.red[500],
      high: lfxColors.amber[600],
      medium: lfxColors.amber[500],
      low: lfxColors.blue[500],
    };
    return vulnSeverity ? (colors[vulnSeverity] ?? lfxColors.gray[400]) : lfxColors.gray[400];
  }

  private initBoardData(): Signal<Record<AkritesTriageStatus, AkritesTriageColumnState> | undefined> {
    return toSignal(
      toObservable(this.reloadTrigger).pipe(
        tap(() => this.loading.set(true)),
        switchMap(() => {
          const requests = AKRITES_TRIAGE_COLUMNS.map((col) =>
            this.akritesService.getPackages({ status: col.status, pageSize: 50, sortBy: 'risk' }).pipe(
              map((res) => ({ status: col.status, packages: (res.packages ?? []).map((p) => this.toVM(p)), total: res.total ?? 0, error: false })),
              catchError(() => of({ status: col.status, packages: [] as AkritesTriagePackageVM[], total: 0, error: true }))
            )
          );
          return forkJoin(requests);
        }),
        map((results) => {
          const data: Partial<Record<AkritesTriageStatus, AkritesTriageColumnState>> = {};
          for (const r of results) {
            data[r.status as AkritesTriageStatus] = { packages: r.packages, total: r.total, loading: false, error: r.error };
          }
          return data as Record<AkritesTriageStatus, AkritesTriageColumnState>;
        }),
        tap(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
    );
  }
}
