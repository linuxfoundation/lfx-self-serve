// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '@environments/environment';
import { CrowdfundingInitiative, CrowdfundingInitiativesStats } from '@lfx-one/shared/interfaces';
import { MOCK_INITIATIVES } from '../crowdfunding.mock';
import { InitiativesStatsBarComponent } from './components/initiatives-stats-bar/initiatives-stats-bar.component';
import { InitiativesListComponent } from './components/initiatives-list/initiatives-list.component';

@Component({
  selector: 'lfx-my-initiatives',
  imports: [InitiativesStatsBarComponent, InitiativesListComponent],
  templateUrl: './my-initiatives.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyInitiativesComponent {
  private readonly router = inject(Router);
  protected readonly crowdfundingUrl = environment.urls.crowdfunding;
  protected readonly initiatives = signal<CrowdfundingInitiative[]>(MOCK_INITIATIVES);

  protected readonly stats: Signal<CrowdfundingInitiativesStats> = this.initStats();

  protected onInitiativeClick(id: string): void {
    void this.router.navigate(['/crowdfunding/initiatives', id]);
  }

  private initStats(): Signal<CrowdfundingInitiativesStats> {
    return computed(() => {
      const all = this.initiatives();
      return {
        activeCount: all.filter((i) => i.status === 'active').length,
        totalRaised: all.reduce((sum, i) => sum + i.raised, 0),
        monthlyGain: 8400,
        totalSponsors: all.reduce((sum, i) => sum + i.sponsorsCount, 0),
      };
    });
  }
}
