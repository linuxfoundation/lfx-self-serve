// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { ButtonComponent } from '@components/button/button.component';
import { MOCK_INITIATIVE_DETAIL } from '../crowdfunding.mock';
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
  private readonly route = inject(ActivatedRoute);

  protected readonly initiativeId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), { initialValue: '' });
  protected readonly initiative = computed(() => {
    // For now, always return mock data. In a real app, fetch from service based on initiativeId()
    return MOCK_INITIATIVE_DETAIL;
  });
  protected readonly activeTab = signal<string>('overview');
  protected readonly settingsDrawerVisible = signal(false);
}
