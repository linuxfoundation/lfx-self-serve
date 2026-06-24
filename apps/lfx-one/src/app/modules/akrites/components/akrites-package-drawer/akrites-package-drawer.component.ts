// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, effect, inject, input, model, output, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, distinctUntilChanged, finalize, of, switchMap, take } from 'rxjs';
import { DrawerModule } from 'primeng/drawer';
import { MessageService } from 'primeng/api';

import {
  AkritesAdvisory,
  AkritesAdvisorySeverity,
  AkritesAssignStewardRequest,
  AkritesEscalateRequest,
  AkritesPackage,
  AkritesStatus,
  AkritesSteward,
  AkritesUpdateStatusRequest,
  AkritesUpdatableStatus,
  TagSeverity,
} from '@lfx-one/shared/interfaces';
import { AkritesService } from '@shared/services/akrites.service';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { AkritesAssignStewardModalComponent } from '../akrites-assign-steward-modal/akrites-assign-steward-modal.component';
import { AkritesEscalateModalComponent } from '../akrites-escalate-modal/akrites-escalate-modal.component';
import { AkritesStatusModalComponent } from '../akrites-status-modal/akrites-status-modal.component';
import {
  formatStatus,
  getAdvisoryTagSeverity,
  getHealthLabel,
  getHealthTagSeverity,
  getLifecycleLabel,
  getLifecycleTagSeverity,
  getStatusTagSeverity,
} from '../../akrites.utils';

type DrawerTab = 'overview' | 'assessment' | 'security' | 'provenance' | 'history';

@Component({
  selector: 'lfx-akrites-package-drawer',
  imports: [
    DrawerModule,
    ButtonComponent,
    EmptyStateComponent,
    TagComponent,
    AkritesAssignStewardModalComponent,
    AkritesEscalateModalComponent,
    AkritesStatusModalComponent,
  ],
  templateUrl: './akrites-package-drawer.component.html',
})
export class AkritesPackageDrawerComponent {
  private readonly akritesService = inject(AkritesService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly visible = model(false);
  public readonly packageId = input<string | null>(null);
  /** Stewardship state from the list row — used until the detail endpoint's stewardship block loads. */
  public readonly packageStatus = input<AkritesStatus | null>(null);

  /** Emitted after a successful steward admin action so the dashboard can refresh the list/metrics. */
  public readonly stewardshipChanged = output<void>();

  protected readonly activeTab = signal<DrawerTab>('overview');
  protected readonly detailLoading = signal(false);
  protected readonly actionLoading = signal(false);
  protected readonly assignStewardModalVisible = signal(false);
  protected readonly escalateModalVisible = signal(false);
  protected readonly statusModalVisible = signal(false);
  protected readonly advisorySeverityFilter = signal<AkritesAdvisorySeverity | null>(null);
  protected readonly advisoryResolutionFilter = signal<'open' | 'patched' | null>(null);
  protected readonly advisoryLoading = signal(false);
  protected readonly advisoryLoadingMore = signal(false);
  protected readonly advisoryItems = signal<(AkritesAdvisory & { tagSeverity: TagSeverity })[]>([]);
  protected readonly advisoryTotal = signal<number>(0);
  protected readonly advisoryHasMore = computed(() => this.advisoryTotal() > 0 && this.advisoryItems().length < this.advisoryTotal());
  protected readonly advisoryShownCount = computed(() => this.advisoryItems().length);
  private static readonly advisoryPageSize = 10;
  private _advisoryNextPage = 2;
  /** Monotonic key identifying the active advisory query; stale load-more responses are dropped. */
  private _advisoryRequestKey = 0;
  private readonly reloadTrigger = signal(0);
  protected readonly packageData: Signal<AkritesPackage | null> = this.initPackageData();

  protected readonly advisorySeverityOptions: readonly { value: AkritesAdvisorySeverity; label: string }[] = [
    { value: 'critical', label: 'Critical' },
    { value: 'high', label: 'High' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'low', label: 'Low' },
  ];

  private readonly _resetAdvisoryFilters = effect(() => {
    this.packageId();
    this.advisorySeverityFilter.set(null);
    this.advisoryResolutionFilter.set(null);
  });

  protected readonly drawerTabs: { key: DrawerTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'assessment', label: 'Assessment' },
    { key: 'security', label: 'Security' },
    { key: 'provenance', label: 'Provenance' },
    { key: 'history', label: 'History' },
  ];

  // Prefer the loaded detail status (fresh after a mutation + reload) over the list-row input, which can be stale.
  protected readonly stewardshipStatus = computed<AkritesStatus>(() => this.packageData()?.status ?? this.packageStatus() ?? 'unassigned');
  protected readonly stewardshipId = computed<number | null>(() => this.packageData()?.stewardshipId ?? null);

  // Action availability. Open is for not-yet-stewarded packages; status/escalate need an existing stewardship row.
  protected readonly canOpenForStewardship = computed(() => this.stewardshipStatus() === 'unassigned');
  // Show "Assign steward" for unassigned/open and "Reassign" for assessing/escalated/inactive.
  protected readonly canAssignSteward = computed(() => {
    const s = this.stewardshipStatus();
    return ['unassigned', 'open', 'assessing', 'escalated', 'inactive'].includes(s);
  });
  protected readonly assignStewardLabel = computed(() => {
    const s = this.stewardshipStatus();
    return ['assessing', 'escalated', 'inactive'].includes(s) ? 'Reassign' : 'Assign steward';
  });
  protected readonly canManageStatus = computed(() => this.stewardshipId() !== null);
  protected readonly canEscalate = computed(() => {
    const status = this.stewardshipStatus();
    return this.stewardshipId() !== null && status !== 'escalated' && status !== 'inactive' && status !== 'unassigned';
  });
  protected readonly canSpotCheck = computed(() => {
    const s = this.stewardshipStatus();
    return ['assessing', 'active', 'needs_attention', 'blocked'].includes(s) && this.stewardshipId() !== null;
  });
  protected readonly canResolve = computed(() => this.stewardshipStatus() === 'escalated' && this.stewardshipId() !== null);
  protected readonly canResolveBlocker = computed(() => this.stewardshipStatus() === 'blocked' && this.stewardshipId() !== null);
  protected readonly canCloseAvailability = computed(() => this.stewardshipStatus() === 'open' && this.stewardshipId() !== null);
  protected readonly canReactivate = computed(() => this.stewardshipStatus() === 'inactive' && this.stewardshipId() !== null);

  protected readonly formattedStatus = computed(() => formatStatus(this.stewardshipStatus()));
  protected readonly statusTagSeverity = computed(() => getStatusTagSeverity(this.stewardshipStatus()));
  protected readonly healthLabel = computed(() => {
    const score = this.packageData()?.healthScore;
    return score != null ? getHealthLabel(score) : '—';
  });
  protected readonly healthTagSeverity = computed(() => getHealthTagSeverity(this.packageData()?.healthScore ?? null));
  protected readonly healthBreakdown = computed(() => {
    const pkg = this.packageData();
    return [pkg?.healthBreakdown[0] || '—', pkg?.healthBreakdown[1] || '—', pkg?.healthBreakdown[2] || '—'];
  });
  protected readonly lifecycleLabel = computed(() => getLifecycleLabel(this.packageData()?.lifecycle ?? null));
  protected readonly lifecycleTagSeverity = computed(() => getLifecycleTagSeverity(this.packageData()?.lifecycle ?? null));
  protected readonly safeRepoUrl = computed(() => this.getSafeRepoUrl(this.packageData()?.repoUrl ?? null));
  protected readonly mappingTagSeverity = computed(() => this.getMappingTagSeverity(this.packageData()?.supplyChainMapping ?? null));
  protected readonly stewardLabel = computed(() => this.getStewardLabel(this.packageData()?.stewards ?? []));
  protected readonly enrichedHistory = computed(() => (this.packageData()?.history ?? []).map((e) => ({ ...e, dotClass: this.getHistoryDotClass(e.type) })));

  public constructor() {
    this.initAdvisoryLoader();
  }

  protected setSeverityFilter(severity: AkritesAdvisorySeverity | null): void {
    this.advisorySeverityFilter.set(severity);
  }

  protected setResolutionFilter(resolution: 'open' | 'patched' | null): void {
    this.advisoryResolutionFilter.set(resolution);
  }

  protected loadMoreAdvisories(): void {
    if (this.advisoryLoadingMore() || !this.advisoryHasMore()) return;
    const purl = this.packageId();
    if (!purl) return;

    // Capture the active request key so a response that resolves after the query
    // context changed (package / tab / filters reset by initAdvisoryLoader) is dropped.
    const requestKey = this._advisoryRequestKey;
    this.advisoryLoadingMore.set(true);
    this.akritesService
      .getPackageAdvisories({
        purl,
        severity: this.advisorySeverityFilter(),
        resolution: this.advisoryResolutionFilter(),
        page: this._advisoryNextPage,
        pageSize: AkritesPackageDrawerComponent.advisoryPageSize,
      })
      .pipe(
        catchError(() => {
          this.messageService.add({ severity: 'error', summary: 'Load failed', detail: 'Could not load more advisories. Please try again.' });
          return of(null);
        }),
        finalize(() => this.advisoryLoadingMore.set(false)),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((page) => {
        // Ignore stale responses from a superseded query.
        if (page && requestKey === this._advisoryRequestKey) {
          this._advisoryNextPage++;
          this.advisoryItems.update((items) => [...items, ...page.advisories.map((a) => ({ ...a, tagSeverity: getAdvisoryTagSeverity(a.severity) }))]);
        }
      });
  }

  protected onTabChange(tab: DrawerTab): void {
    this.activeTab.set(tab);
  }

  protected onClose(): void {
    this.visible.set(false);
  }

  protected getSafeRepoUrl(repoUrl: string | null): string | null {
    if (!repoUrl) return null;
    try {
      const urlString = repoUrl.includes('://') ? repoUrl : 'https://' + repoUrl;
      const url = new URL(urlString);
      return url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  protected getHistoryDotClass(entryType: string | undefined): string {
    const base = 'absolute -left-5 top-1 w-2.5 h-2.5 rounded-full border-2 border-white';
    if (entryType === 'danger') return `${base} bg-red-500`;
    if (entryType === 'success') return `${base} bg-emerald-500`;
    return `${base} bg-blue-500`;
  }

  protected getHealthBreakdownSlot(pkg: AkritesPackage, index: number): string {
    // healthBreakdown is positional (maintainer / security / development) and
    // empty when CDP returns no health score at all.
    return pkg.healthBreakdown[index] || '—';
  }

  protected isStale(monthsStale: number | null): boolean {
    return monthsStale !== null && monthsStale >= 18;
  }

  protected getMappingTagSeverity(mapping: AkritesPackage['supplyChainMapping']): TagSeverity {
    if (mapping === 'High') return 'success';
    if (mapping === 'Medium') return 'warn';
    if (mapping === 'Low') return 'danger';
    return 'secondary';
  }

  /** Display label for assigned stewards. Falls back to the Auth0 sub until the roster endpoint provides names. */
  protected getStewardLabel(stewards: AkritesSteward[]): string {
    if (stewards.length === 0) return '—';
    return stewards.map((s) => s.name ?? s.userId).join(', ');
  }

  protected onSpotCheck(): void {
    this.activeTab.set('assessment');
  }

  protected onQuickStatusUpdate(status: AkritesUpdatableStatus): void {
    const id = this.stewardshipId();
    if (id === null || this.actionLoading()) return;
    this.actionLoading.set(true);
    this.akritesService
      .updateStewardshipStatus(id, { status })
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.onActionSuccess(`Status updated to ${status}.`),
        error: () => this.onActionError(),
      });
  }

  protected openAssignStewardModal(): void {
    this.assignStewardModalVisible.set(true);
  }

  protected openEscalateModal(): void {
    this.escalateModalVisible.set(true);
  }

  protected openStatusModal(): void {
    this.statusModalVisible.set(true);
  }

  protected onOpenForStewardship(): void {
    const pkg = this.packageData();
    const purl = pkg?.purl ?? this.packageId();
    if (!purl || this.actionLoading()) return;

    this.actionLoading.set(true);
    this.akritesService
      .openStewardship(purl)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.onActionSuccess('Package opened for stewardship.'),
        error: () => this.onActionError(),
      });
  }

  protected onAssignStewardConfirm(body: AkritesAssignStewardRequest): void {
    if (this.actionLoading()) return;
    this.actionLoading.set(true);

    const existingId = this.stewardshipId();
    if (existingId !== null) {
      this.akritesService
        .assignSteward(existingId, body)
        .pipe(take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.assignStewardModalVisible.set(false);
            this.onActionSuccess('Steward assigned successfully.');
          },
          error: () => this.onActionError(),
        });
      return;
    }

    // No stewardship row yet — open first, then assign using the returned id.
    const purl = this.packageData()?.purl ?? this.packageId();
    if (!purl) {
      this.onActionError();
      return;
    }

    this.akritesService
      .openStewardship(purl)
      .pipe(
        switchMap((res) => this.akritesService.assignSteward(parseInt(res.stewardship.id, 10), body)),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.assignStewardModalVisible.set(false);
          this.onActionSuccess('Steward assigned successfully.');
        },
        error: () => this.onActionError(),
      });
  }

  protected onEscalateConfirm(body: AkritesEscalateRequest): void {
    const id = this.stewardshipId();
    if (id === null || this.actionLoading()) return;

    this.actionLoading.set(true);
    this.akritesService
      .escalateStewardship(id, body)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.escalateModalVisible.set(false);
          this.onActionSuccess('Package escalated.');
        },
        error: () => this.onActionError(),
      });
  }

  protected onStatusConfirm(body: AkritesUpdateStatusRequest): void {
    const id = this.stewardshipId();
    if (id === null || this.actionLoading()) return;

    this.actionLoading.set(true);
    this.akritesService
      .updateStewardshipStatus(id, body)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.statusModalVisible.set(false);
          this.onActionSuccess('Stewardship status updated.');
        },
        error: () => this.onActionError(),
      });
  }

  private onActionSuccess(detail: string): void {
    this.actionLoading.set(false);
    this.messageService.add({ severity: 'success', summary: 'Success', detail });
    this.reloadTrigger.update((n) => n + 1);
    this.stewardshipChanged.emit();
  }

  private onActionError(): void {
    this.actionLoading.set(false);
    this.messageService.add({ severity: 'error', summary: 'Action failed', detail: 'Something went wrong. Please try again.' });
  }

  private initAdvisoryLoader(): void {
    const filterParams = computed(() => {
      if (!this.visible() || !this.packageId() || this.activeTab() !== 'security') return null;
      return {
        purl: this.packageId()!,
        severity: this.advisorySeverityFilter(),
        resolution: this.advisoryResolutionFilter(),
      };
    });

    toObservable(filterParams)
      .pipe(
        // Compare the fixed-shape filter fields directly — cheaper and order-independent vs JSON.stringify.
        distinctUntilChanged((a, b) => a?.purl === b?.purl && a?.severity === b?.severity && a?.resolution === b?.resolution),
        switchMap((p) => {
          // Bump the request key so any in-flight load-more response is discarded.
          this._advisoryRequestKey++;
          this.advisoryItems.set([]);
          this.advisoryTotal.set(0);
          this._advisoryNextPage = 2;
          if (!p) return of(null);
          this.advisoryLoading.set(true);
          return this.akritesService.getPackageAdvisories({ ...p, page: 1, pageSize: AkritesPackageDrawerComponent.advisoryPageSize }).pipe(
            catchError(() => {
              this.messageService.add({ severity: 'error', summary: 'Load failed', detail: 'Could not load advisories. Please try again.' });
              return of(null);
            }),
            finalize(() => this.advisoryLoading.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((page) => {
        if (page) {
          this.advisoryItems.set(page.advisories.map((a) => ({ ...a, tagSeverity: getAdvisoryTagSeverity(a.severity) })));
          this.advisoryTotal.set(page.total);
        }
      });
  }

  private initPackageData(): Signal<AkritesPackage | null> {
    // Fetch only while the drawer is open for a concrete package; closing the
    // drawer maps to null. The reload trigger forces a re-fetch after a mutation
    // even though the package id is unchanged.
    let lastId: string | null = null;
    const source = computed(() => ({ id: this.visible() ? this.packageId() : null, reload: this.reloadTrigger() }));

    return toSignal(
      toObservable(source).pipe(
        distinctUntilChanged((a, b) => a.id === b.id && a.reload === b.reload),
        switchMap(({ id }) => {
          if (!id) {
            lastId = null;
            return of(null);
          }
          // Only reset to the overview tab when opening a different package, not on a post-action reload.
          if (id !== lastId) {
            this.activeTab.set('overview');
            lastId = id;
          }
          this.detailLoading.set(true);
          return this.akritesService.getPackage(id).pipe(
            catchError(() => of(null)),
            finalize(() => this.detailLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
