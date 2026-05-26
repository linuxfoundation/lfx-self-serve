// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, signal, Signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { filter, map, switchMap } from 'rxjs';
import { ButtonComponent } from '@components/button/button.component';
import { InitiativeDetail } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { InitiativeDetailHeaderComponent } from './components/initiative-detail-header/initiative-detail-header.component';
import { InitiativeOverviewComponent } from './components/initiative-overview/initiative-overview.component';
import { InitiativeFinancialsComponent } from './components/initiative-financials/initiative-financials.component';
import { InitiativeAnnouncementsComponent } from './components/initiative-announcements/initiative-announcements.component';
import { InitiativeSettingsDrawerComponent } from './components/initiative-settings-drawer/initiative-settings-drawer.component';

@Component({
  selector: 'lfx-initiative-detail',
  imports: [
    ButtonComponent,
    InitiativeDetailHeaderComponent,
    InitiativeOverviewComponent,
    InitiativeFinancialsComponent,
    InitiativeAnnouncementsComponent,
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

  // ─── WritableSignals ───────────────────────────────────────────────────────
  protected readonly activeTab = signal<string>('overview');
  protected readonly settingsDrawerVisible = signal(false);

  // ─── Computed Signals ──────────────────────────────────────────────────────
  protected readonly initiativeSlug = toSignal(this.route.paramMap.pipe(map((params) => params.get('slug') ?? '')), { initialValue: '' });
  protected readonly initiative: Signal<InitiativeDetail | null> = this.initInitiative();

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initInitiative(): Signal<InitiativeDetail | null> {
    return toSignal(
      toObservable(this.initiativeSlug).pipe(
        filter((slug) => !!slug),
        switchMap((slug) => this.crowdfundingService.getInitiativeBySlug(slug))
      ),
      { initialValue: null }
    );
  }
}
