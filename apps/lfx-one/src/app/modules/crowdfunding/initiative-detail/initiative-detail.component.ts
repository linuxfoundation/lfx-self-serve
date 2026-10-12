// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom, map, switchMap, tap } from 'rxjs';
import { ButtonComponent } from '@components/button/button.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { NAV_LENSES } from '@lfx-one/shared/constants';
import { CrowdfundingInitiativeStatus, InitiativeDetail, Lens, NavLens } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { InitiativeDetailHeaderComponent } from './components/initiative-detail-header/initiative-detail-header.component';
import { InitiativeOverviewComponent } from './components/initiative-overview/initiative-overview.component';
import { InitiativeFinancialsComponent } from './components/initiative-financials/initiative-financials.component';
import { InitiativeSettingsDrawerComponent } from './components/initiative-settings-drawer/initiative-settings-drawer.component';

@Component({
  selector: 'lfx-initiative-detail',
  imports: [
    ButtonComponent,
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

  // ─── Route Fields ──────────────────────────────────────────────────────────
  // Opened from a lens Initiatives page — Project/Foundation (#347, keeping ?project=) or Org (#348, the selected
  // organization's address): go back there.
  private readonly lens = this.route.snapshot.data['lens'] as Lens | undefined;
  private readonly isNavLens = NAV_LENSES.includes(this.lens as NavLens);
  protected readonly isLensPage = this.isNavLens || this.lens === 'org';
  protected readonly backLink: string | string[] = this.initBackLink();
  protected readonly backQueryParams: Record<string, string> = this.isNavLens ? this.route.snapshot.queryParams : {};

  // ─── WritableSignals ───────────────────────────────────────────────────────
  protected readonly isLoading = signal(true);
  protected readonly activeTab = signal<string>('overview');
  protected readonly settingsDrawerVisible = signal(false);

  // Holds a server-returned update so children reflect changes without re-fetching.
  private readonly initiativeOverride: WritableSignal<InitiativeDetail | null> = signal(null);

  // ─── Computed Signals ──────────────────────────────────────────────────────
  protected readonly initiativeSlug = toSignal(this.route.paramMap.pipe(map((params) => params.get('slug') ?? '')), { initialValue: '' });
  private readonly initiativeFetched: Signal<InitiativeDetail | null> = this.initInitiative();
  protected readonly initiative = computed(() => this.initiativeOverride() ?? this.initiativeFetched());

  protected onInitiativeSaved(updated: InitiativeDetail): void {
    this.initiativeOverride.set(updated);
  }

  protected async onStatusChange(status: CrowdfundingInitiativeStatus): Promise<void> {
    const current = this.initiative();
    if (!current) return;
    try {
      const updated = await firstValueFrom(this.crowdfundingService.updateInitiative(current.id, { status }), { defaultValue: null });
      if (updated) this.initiativeOverride.set(updated);
    } catch {
      // HTTP error surfaced by the global error handler
    }
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initBackLink(): string | string[] {
    if (this.lens === 'org') return this.orgLensNavigation.orgLensLink('initiatives');
    return this.isNavLens ? `/${this.lens}/initiatives` : '/crowdfunding/initiatives';
  }

  private initInitiative(): Signal<InitiativeDetail | null> {
    return toSignal(
      toObservable(this.initiativeSlug).pipe(
        filter((slug) => !!slug),
        tap(() => this.isLoading.set(true)),
        switchMap((slug) => this.crowdfundingService.getInitiativeBySlug(slug).pipe(tap(() => this.isLoading.set(false))))
      ),
      { initialValue: null }
    );
  }
}
