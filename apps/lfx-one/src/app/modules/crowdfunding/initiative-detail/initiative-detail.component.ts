// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, filter, firstValueFrom, map, of, switchMap, take, tap } from 'rxjs';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { NAV_LENSES } from '@lfx-one/shared/constants';
import {
  CrowdfundingInitiativeStatus,
  EditAttributionDialogData,
  InitiativeDetail,
  InitiativeDetailLoadError,
  Lens,
  NavLens,
} from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { EditAttributionDialogComponent } from './components/edit-attribution-dialog/edit-attribution-dialog.component';
import { InitiativeDetailHeaderComponent } from './components/initiative-detail-header/initiative-detail-header.component';
import { InitiativeOverviewComponent } from './components/initiative-overview/initiative-overview.component';
import { InitiativeFinancialsComponent } from './components/initiative-financials/initiative-financials.component';
import { InitiativeSettingsDrawerComponent } from './components/initiative-settings-drawer/initiative-settings-drawer.component';

@Component({
  selector: 'lfx-initiative-detail',
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    RouteLoadingComponent,
    InitiativeDetailHeaderComponent,
    InitiativeOverviewComponent,
    InitiativeFinancialsComponent,
    InitiativeSettingsDrawerComponent,
  ],
  templateUrl: './initiative-detail.component.html',
  styleUrl: './initiative-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InitiativeDetailComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly route = inject(ActivatedRoute);
  private readonly crowdfundingService = inject(CrowdfundingService);
  private readonly orgLensNavigation = inject(OrgLensNavigationService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);

  // ─── Route Fields ──────────────────────────────────────────────────────────
  // Opened from a lens Initiatives page — Project/Foundation (#347, keeping ?project=) or Org (#348, the selected
  // organization's address): go back there.
  private readonly lens = this.route.snapshot.data['lens'] as Lens | undefined;
  private readonly isNavLens = NAV_LENSES.includes(this.lens as NavLens);
  // Lens pages (Org, Project, Foundation) show who created the initiative (lfx-crowdfunding#452).
  protected readonly isLensPage = this.lens === 'org' || this.isNavLens;
  protected readonly backLink: string | string[] = this.initBackLink();
  protected readonly backQueryParams: Record<string, string> = this.isNavLens ? this.route.snapshot.queryParams : {};

  // ─── WritableSignals ───────────────────────────────────────────────────────
  protected readonly isLoading = signal(true);
  protected readonly activeTab = signal<string>('overview');
  protected readonly settingsDrawerVisible = signal(false);
  protected readonly loadError = signal<InitiativeDetailLoadError | null>(null);
  private readonly reloadCount = signal(0);

  // Holds a server-returned update so children reflect changes without re-fetching.
  private readonly initiativeOverride: WritableSignal<InitiativeDetail | null> = signal(null);

  // ─── Computed Signals ──────────────────────────────────────────────────────
  protected readonly initiativeSlug = toSignal(this.route.paramMap.pipe(map((params) => params.get('slug') ?? '')), { initialValue: '' });
  private readonly initiativeFetched: Signal<InitiativeDetail | null> = this.initInitiative();
  protected readonly initiative = computed(() => this.initiativeOverride() ?? this.initiativeFetched());
  protected readonly canEditAttribution: Signal<boolean> = this.initCanEditAttribution();

  protected onRetry(): void {
    this.reloadCount.update((count) => count + 1);
  }

  protected onInitiativeSaved(updated: InitiativeDetail): void {
    this.applyUpdate(updated);
  }

  protected async onStatusChange(status: CrowdfundingInitiativeStatus): Promise<void> {
    const current = this.initiative();
    if (!current) return;
    try {
      const updated = await firstValueFrom(this.crowdfundingService.updateInitiative(current.id, { status }), { defaultValue: null });
      if (updated) this.applyUpdate(updated);
    } catch {
      // HTTP error surfaced by the global error handler
    }
  }

  protected openEditAttribution(initiative: InitiativeDetail): void {
    const data: EditAttributionDialogData = { initiative };
    const ref: DynamicDialogRef | null = this.dialogService.open(EditAttributionDialogComponent, {
      header: 'Edit attribution',
      width: '480px',
      modal: true,
      draggable: false,
      resizable: false,
      closeOnEscape: true,
      data,
    });

    ref?.onClose.pipe(take(1)).subscribe((updated?: InitiativeDetail) => {
      const current = this.initiative();
      if (!updated || !current) return;
      // The PUT response isn't the enriched manage read, so take only the attribution from it.
      this.initiativeOverride.set({ ...current, attribution: updated.attribution });
      this.messageService.add({ severity: 'success', summary: 'Saved', detail: 'Attribution updated.' });
    });
  }

  // CF sets is_owner and creator only on the manage read; write responses would otherwise drop them.
  private applyUpdate(updated: InitiativeDetail): void {
    const current = this.initiative();
    this.initiativeOverride.set({ ...updated, isOwner: current?.isOwner ?? false, creator: current?.creator });
  }

  private toLoadError(err: HttpErrorResponse): InitiativeDetailLoadError {
    if (err.status === 404) return 'not-found';
    if (err.status === 403) return 'forbidden';
    return 'unavailable';
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initBackLink(): string | string[] {
    if (this.lens === 'org') return this.orgLensNavigation.orgLensLink('initiatives');
    return this.isNavLens ? `/${this.lens}/initiatives` : '/crowdfunding/initiatives';
  }

  // Me lens only: the lens pages are shared with entity writers, and only the creator may re-attribute. CF also
  // limits it to submitted initiatives (lfx-crowdfunding#342) and enforces both; this only hides an action that would fail.
  private initCanEditAttribution(): Signal<boolean> {
    return computed(() => {
      const initiative = this.initiative();
      return this.lens === 'me' && !!initiative?.isOwner && initiative.status === 'submitted';
    });
  }

  private initInitiative(): Signal<InitiativeDetail | null> {
    return toSignal(
      toObservable(computed(() => ({ slug: this.initiativeSlug(), reload: this.reloadCount() }))).pipe(
        filter(({ slug }) => !!slug),
        tap(() => {
          this.isLoading.set(true);
          this.loadError.set(null);
        }),
        switchMap(({ slug }) =>
          this.crowdfundingService.getInitiativeBySlug(slug).pipe(
            catchError((err: HttpErrorResponse) => {
              this.loadError.set(this.toLoadError(err));
              return of(null);
            }),
            tap(() => this.isLoading.set(false))
          )
        )
      ),
      { initialValue: null }
    );
  }
}
