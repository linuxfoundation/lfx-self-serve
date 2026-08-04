// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { CardComponent } from '@components/card/card.component';
import { PublicProfileContributionTotals, PublicProfileProject, PublicProfileTechnicalContribution } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-public-profile-contributions',
  imports: [CardComponent, AvatarComponent, DecimalPipe],
  templateUrl: './public-profile-contributions.component.html',
})
export class PublicProfileContributionsComponent {
  public readonly technicalContribution = input<PublicProfileTechnicalContribution | null>(null);

  protected readonly projects = computed<PublicProfileProject[]>(() => this.technicalContribution()?.projects ?? []);
  protected readonly totals: Signal<PublicProfileContributionTotals> = this.initTotals();

  private initTotals(): Signal<PublicProfileContributionTotals> {
    return computed(() =>
      this.projects().reduce<PublicProfileContributionTotals>(
        (acc, project) => ({
          commits: acc.commits + (project.commits ?? 0),
          prs: acc.prs + (project.prs ?? 0),
          issues: acc.issues + (project.issues ?? 0),
          added: acc.added + (project.added ?? 0),
          deleted: acc.deleted + (project.deleted ?? 0),
        }),
        { commits: 0, prs: 0, issues: 0, added: 0, deleted: 0 }
      )
    );
  }
}
