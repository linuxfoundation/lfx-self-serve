// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, output, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, distinctUntilChanged, finalize, of, switchMap, take } from 'rxjs';
import { DrawerModule } from 'primeng/drawer';
import { MessageService } from 'primeng/api';

import {
  OsspreyEscalateRequest,
  OsspreyPackage,
  OsspreyStatus,
  OsspreySteward,
  OsspreyUpdateStatusRequest,
  OsspreyUpdatableStatus,
  TagSeverity,
} from '@lfx-one/shared/interfaces';
import { OsspreyService } from '@shared/services/ossprey.service';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { OsspreyEscalateModalComponent } from '../ossprey-escalate-modal/ossprey-escalate-modal.component';
import { OsspreyStatusModalComponent } from '../ossprey-status-modal/ossprey-status-modal.component';
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
  imports: [DrawerModule, ButtonComponent, EmptyStateComponent, TagComponent, OsspreyEscalateModalComponent, OsspreyStatusModalComponent],
  templateUrl: './ossprey-package-drawer.component.html',
})
export class OsspreyPackageDrawerComponent {
  private readonly osspreyService = inject(OsspreyService);
  private readonly messageService = inject(MessageService);

  public readonly visible = model(false);
  public readonly packageId = input<string | null>(null);
  /** Stewardship state from the list row — used until the detail endpoint's stewardship block loads. */
  public readonly packageStatus = input<OsspreyStatus | null>(null);

  /** Emitted after a successful steward admin action so the dashboard can refresh the list/metrics. */
  public readonly stewardshipChanged = output<void>();

  protected readonly activeTab = signal<DrawerTab>('overview');
  protected readonly detailLoading = signal(false);
  protected readonly actionLoading = signal(false);
  protected readonly escalateModalVisible = signal(false);
  protected readonly statusModalVisible = signal(false);
  private readonly reloadTrigger = signal(0);
  protected readonly packageData: Signal<OsspreyPackage | null> = this.initPackageData();

  protected readonly drawerTabs: { key: DrawerTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'assessment', label: 'Assessment' },
    { key: 'security', label: 'Security' },
    { key: 'provenance', label: 'Provenance' },
    { key: 'history', label: 'History' },
  ];

  // Prefer the loaded detail status (fresh after a mutation + reload) over the list-row input, which can be stale.
  protected readonly stewardshipStatus = computed<OsspreyStatus>(() => this.packageData()?.status ?? this.packageStatus() ?? 'unassigned');
  protected readonly stewardshipId = computed<number | null>(() => this.packageData()?.stewardshipId ?? null);

  // Action availability. Open is for not-yet-stewarded packages; status/escalate need an existing stewardship row.
  protected readonly canOpenForStewardship = computed(() => this.stewardshipStatus() === 'unassigned' && this.stewardshipId() === null);
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

  /** Display label for assigned stewards. Falls back to the Auth0 sub until the roster endpoint provides names. */
  protected getStewardLabel(stewards: OsspreySteward[]): string {
    if (stewards.length === 0) return '—';
    return stewards.map((s) => s.name ?? s.userId).join(', ');
  }

  protected onSpotCheck(): void {
    this.activeTab.set('assessment');
  }

  protected onQuickStatusUpdate(status: OsspreyUpdatableStatus): void {
    const id = this.stewardshipId();
    if (id === null || this.actionLoading()) return;
    this.actionLoading.set(true);
    this.osspreyService
      .updateStewardshipStatus(id, { status })
      .pipe(take(1))
      .subscribe({
        next: () => this.onActionSuccess(`Status updated to ${status}.`),
        error: () => this.onActionError(),
      });
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
    this.osspreyService
      .openStewardship(purl)
      .pipe(take(1))
      .subscribe({
        next: () => this.onActionSuccess('Package opened for stewardship.'),
        error: () => this.onActionError(),
      });
  }

  protected onEscalateConfirm(body: OsspreyEscalateRequest): void {
    const id = this.stewardshipId();
    if (id === null || this.actionLoading()) return;

    this.actionLoading.set(true);
    this.osspreyService
      .escalateStewardship(id, body)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.escalateModalVisible.set(false);
          this.onActionSuccess('Package escalated.');
        },
        error: () => this.onActionError(),
      });
  }

  protected onStatusConfirm(body: OsspreyUpdateStatusRequest): void {
    const id = this.stewardshipId();
    if (id === null || this.actionLoading()) return;

    this.actionLoading.set(true);
    this.osspreyService
      .updateStewardshipStatus(id, body)
      .pipe(take(1))
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

  private initPackageData(): Signal<OsspreyPackage | null> {
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
