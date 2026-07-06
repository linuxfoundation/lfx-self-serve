// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { UserService } from '@services/user.service';

import { ProfileAffiliationsComponent } from '../affiliations/profile-affiliations.component';
import { ProfileWorkExperienceComponent } from '../work-experience/profile-work-experience.component';

@Component({
  selector: 'lfx-profile-attribution',
  imports: [ButtonComponent, ProfileAffiliationsComponent, ProfileWorkExperienceComponent],
  templateUrl: './profile-attribution.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileAttributionComponent {
  private readonly userService = inject(UserService);
  private readonly workExperience = viewChild(ProfileWorkExperienceComponent);
  private readonly affiliations = viewChild(ProfileAffiliationsComponent);

  // Read-only when impersonating — the add affordance is visible but disabled (writes are blocked server-side).
  public readonly impersonating = this.userService.impersonating;

  public readonly isWorkExperienceEmpty = computed(() => this.workExperience()?.isEmpty() ?? true);

  public onAddWorkExperience(): void {
    this.workExperience()?.onAdd();
  }

  public onWorkExperienceChanged(): void {
    this.affiliations()?.refreshWorkExperience();
  }
}
