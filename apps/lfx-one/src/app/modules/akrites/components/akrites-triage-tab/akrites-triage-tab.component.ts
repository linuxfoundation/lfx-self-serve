// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, TitleCasePipe, isPlatformBrowser, isPlatformServer } from '@angular/common';
import { Component, DestroyRef, PLATFORM_ID, Signal, TransferState, computed, inject, input, makeStateKey, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AKRITES_TRIAGE_COLUMNS, lfxColors } from '@lfx-one/shared/constants';
import {
  AkritesAssignStewardRequest,
  AkritesPackage,
  AkritesSortKey,
  AkritesTriageBoardColumnConfig,
  AkritesTriageBoardPageState,
  AkritesTriageColumnState,
  AkritesTriagePackageVM,
  AkritesTriageStatus,
} from '@lfx-one/shared/interfaces';
import { AkritesService } from '@shared/services/akrites.service';
import { ProjectContextService } from '@shared/services/project-context.service';
import { MessageService } from 'primeng/api';
import { catchError, forkJoin, map, of, startWith, switchMap, take, tap } from 'rxjs';
import { AkritesAssignStewardModalComponent } from '../akrites-assign-steward-modal/akrites-assign-steward-modal.component';

@Component({
  selector: 'lfx-akrites-triage-tab',
  imports: [DecimalPipe, TitleCasePipe, AkritesAssignStewardModalComponent],
  templateUrl: './akrites-triage-tab.component.html',
})
export class AkritesTriageTabComponent {
  private readonly akritesService = inject(AkritesService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly transferState = inject(TransferState);
  private readonly platformId = inject(PLATFORM_ID);

  // Persists the SSR-resolved board so the client's first paint matches the server DOM instead
  // of tearing it down at hydration (GH-2080). Same pattern as `PublicProjectGroupsComponent`.
  private readonly stateKey = makeStateKey<AkritesTriageBoardPageState>('akritesTriageBoardState');

  public readonly reloadTrigger = input<number>(0);
  public readonly sortBy = input<AkritesSortKey>('risk');

  public readonly packageClick = output<string>();
  public readonly stewardshipChanged = output<void>();

  protected readonly TRIAGE_COLUMNS = AKRITES_TRIAGE_COLUMNS;
  protected readonly actionLoading = signal(false);
  protected readonly assignModalVisible = signal(false);
  protected readonly assignTargetPackage = signal<AkritesTriagePackageVM | null>(null);
  protected readonly canWrite = computed(() => this.projectContextService.canWrite());

  // Single source of truth for the async board; loading/boardData derive from it.
  private readonly boardState = this.initBoardState();
  protected readonly loading = computed(() => this.boardState().loading);
  protected readonly boardData = computed(() => this.boardState().board);

  protected readonly allColumnsEmpty = computed(() => {
    const data = this.boardData();
    if (!data) return false;
    return AKRITES_TRIAGE_COLUMNS.every((col) => {
      const state = data[col.status];
      if (!state || state.error) return false;
      return state.total === 0;
    });
  });

  protected onCardClick(pkg: AkritesPackage): void {
    this.packageClick.emit(pkg.id);
  }

  protected onAction(event: Event, pkg: AkritesTriagePackageVM, column: AkritesTriageBoardColumnConfig): void {
    event.stopPropagation();
    if (column.status === 'unassigned' || column.status === 'inactive') {
      this.assignTargetPackage.set(pkg);
      this.assignModalVisible.set(true);
    } else if ((column.status === 'escalated' || column.status === 'blocked') && pkg.stewardshipId) {
      this.resolvePackage(pkg);
    } else {
      this.packageClick.emit(pkg.id);
    }
  }

  protected onAssignStewardConfirm(body: AkritesAssignStewardRequest): void {
    const pkg = this.assignTargetPackage();
    if (!pkg || this.actionLoading()) return;
    this.actionLoading.set(true);

    const stewardshipId$ =
      pkg.stewardshipId !== null ? of(pkg.stewardshipId) : this.akritesService.openStewardship(pkg.purl).pipe(map((res) => res.stewardship.id));

    stewardshipId$
      .pipe(
        switchMap((id) => this.akritesService.assignSteward(id, body)),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.assignModalVisible.set(false);
          this.assignTargetPackage.set(null);
          this.actionLoading.set(false);
          this.messageService.add({ severity: 'success', summary: 'Assigned', detail: `Steward assigned to ${pkg.name}.` });
          this.stewardshipChanged.emit();
        },
        error: () => {
          this.actionLoading.set(false);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Could not assign steward. Please try again.' });
        },
      });
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

  private initBoardState(): Signal<AkritesTriageBoardPageState> {
    const initial: AkritesTriageBoardPageState = { loading: true, board: null };
    // Seed the client's first paint from the SSR-serialized state (matches the server's resolved
    // branch, no skeleton flash). Null on the server and on client navigations with no prior SSR state.
    const transferred = this.transferState.get(this.stateKey, null);
    // Consume the SSR state exactly once so a later re-creation of this component (e.g. a different
    // project context) can't paint the previous board under the new URL.
    if (isPlatformBrowser(this.platformId) && transferred) {
      this.transferState.remove(this.stateKey);
    }

    const source = computed(() => ({ reload: this.reloadTrigger(), sort: this.sortBy() }));
    return toSignal(
      toObservable(source).pipe(
        switchMap(({ sort }, index) => {
          const requests = AKRITES_TRIAGE_COLUMNS.map((col) =>
            this.akritesService.getPackages({ status: col.status, pageSize: 50, sortBy: sort }).pipe(
              map((res) => ({ status: col.status, packages: (res.packages ?? []).map((p) => this.toVM(p)), total: res.total ?? 0, error: false })),
              catchError(() => of({ status: col.status, packages: [] as AkritesTriagePackageVM[], total: 0, error: true }))
            )
          );
          return forkJoin(requests).pipe(
            map((results): AkritesTriageBoardPageState => {
              const board: Partial<Record<AkritesTriageStatus, AkritesTriageColumnState>> = {};
              for (const r of results) {
                board[r.status as AkritesTriageStatus] = { packages: r.packages, total: r.total, loading: false, error: r.error };
              }
              return { loading: false, board: board as Record<AkritesTriageStatus, AkritesTriageColumnState> };
            }),
            // During SSR, persist each resolved (non-loading) state so the client can hydrate to the
            // same branch. Angular defers serialization until this tracked HTTP call settles.
            tap((state) => {
              if (isPlatformServer(this.platformId) && !state.loading) {
                this.transferState.set(this.stateKey, state);
              }
            }),
            // Seed the first client emission from the SSR state to avoid a loading flash and a
            // hydration mismatch; every later fetch (sort/reload) re-enters loading.
            startWith(index === 0 && transferred ? transferred : initial)
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: transferred ?? initial }
    );
  }
}
