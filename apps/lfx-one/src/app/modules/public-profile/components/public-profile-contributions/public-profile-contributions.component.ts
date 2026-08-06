// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { PublicProfileProject, PublicProfileTechnicalContribution } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-public-profile-contributions',
  imports: [AvatarComponent, DecimalPipe],
  templateUrl: './public-profile-contributions.component.html',
})
export class PublicProfileContributionsComponent {
  public readonly technicalContribution = input<PublicProfileTechnicalContribution | null>(null);

  protected readonly projects = computed<PublicProfileProject[]>(() => this.technicalContribution()?.projects ?? []);
}
