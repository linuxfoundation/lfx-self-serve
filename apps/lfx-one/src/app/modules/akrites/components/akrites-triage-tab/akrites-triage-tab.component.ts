// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, TitleCasePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AKRITES_TRIAGE_COLUMNS } from '@lfx-one/shared/constants';
import { AkritesPackage, AkritesTriageBoardColumnConfig, AkritesTriageColumnState, AkritesTriageStatus } from '@lfx-one/shared/interfaces';
import { AkritesService } from '@shared/services/akrites.service';
import { MessageService } from 'primeng/api';
import { catchError, forkJoin, map, of, switchMap, take, tap } from 'rxjs';

@Component({
  selector: 'lfx-akrites-triage-tab',
  imports: [DecimalPipe, TitleCasePipe],
  templateUrl: './akrites-triage-tab.component.html',
})
export class AkritesTriageTabComponent {
  private readonly akritesService = inject(AkritesService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly reloadTrigger = input<number>(0);

  public readonly packageClick = output<string>();
  public readonly stewardshipChanged = output<void>();

  protected readonly TRIAGE_COLUMNS = AKRITES_TRIAGE_COLUMNS;
  protected readonly loading = signal(true);

  protected readonly boardData = this.initBoardData();

  protected readonly allColumnsEmpty = computed(() => {
    const data = this.boardData();
    if (data === undefined) return false;
    return AKRITES_TRIAGE_COLUMNS.every((col) => (data[col.status]?.total ?? 0) === 0);
  });

  protected getColumnState(status: AkritesTriageStatus): AkritesTriageColumnState {
    return this.boardData()?.[status] ?? { packages: [], total: 0, loading: true, error: false };
  }

  protected getHealthLabel(score: number | null): string {
    if (score === null) return '';
    if (score >= 70) return 'Healthy';
    if (score >= 50) return 'Fair';
    if (score >= 30) return 'Concerning';
    return 'Critical';
  }

  protected getHealthColor(score: number | null): string {
    if (score === null) return '#9ca3af';
    if (score >= 70) return '#22c55e';
    if (score >= 50) return '#f59e0b';
    if (score >= 30) return '#f97316';
    return '#ef4444';
  }

  protected getVulnColor(vulnCount: number, vulnSeverity: string | null): string {
    if (vulnCount === 0) return '#22c55e';
    const colors: Record<string, string> = {
      critical: '#ef4444',
      high: '#f97316',
      medium: '#f59e0b',
      low: '#3b82f6',
    };
    return vulnSeverity ? (colors[vulnSeverity] ?? '#9ca3af') : '#9ca3af';
  }

  protected getColumnIconClass(iconName: string): string {
    return `fa-light fa-${iconName} text-[11px]`;
  }

  protected getActionButtonClass(variant: 'blue' | 'red' | 'default'): string {
    const base = 'h-8 px-3.5 rounded-full border bg-white text-[12.5px] font-medium cursor-pointer transition-colors';
    if (variant === 'blue') return `${base} border-blue-200 text-blue-600 hover:bg-blue-50 hover:border-blue-400`;
    if (variant === 'red') return `${base} border-red-200 text-red-600 hover:bg-red-50 hover:border-red-400`;
    return `${base} border-gray-300 text-gray-700 hover:bg-gray-50`;
  }

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

  private initBoardData() {
    return toSignal(
      toObservable(this.reloadTrigger).pipe(
        tap(() => this.loading.set(true)),
        switchMap(() => {
          const requests = AKRITES_TRIAGE_COLUMNS.map((col) =>
            this.akritesService.getPackages({ status: col.status, pageSize: 50, sortBy: 'risk' }).pipe(
              map((res) => ({ status: col.status, packages: res.packages ?? [], total: res.total ?? 0, error: false })),
              catchError(() => of({ status: col.status, packages: [] as AkritesPackage[], total: 0, error: true }))
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
