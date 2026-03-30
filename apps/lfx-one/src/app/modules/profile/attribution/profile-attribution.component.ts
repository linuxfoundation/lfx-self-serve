// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';

import { ProfileAffiliationsComponent } from '../affiliations/profile-affiliations.component';
import { ProfileWorkExperienceComponent } from '../work-experience/profile-work-experience.component';

@Component({
  selector: 'lfx-profile-attribution',
  imports: [ButtonComponent, ProfileAffiliationsComponent, ProfileWorkExperienceComponent],
  templateUrl: './profile-attribution.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileAttributionComponent {
  private readonly workExperience = viewChild(ProfileWorkExperienceComponent);
  private readonly affiliations = viewChild(ProfileAffiliationsComponent);

  public onAddWorkExperience(): void {
    this.workExperience()?.onAdd();
  }

  public onWorkExperienceChanged(): void {
    this.affiliations()?.refreshWorkExperience();
  }
}
