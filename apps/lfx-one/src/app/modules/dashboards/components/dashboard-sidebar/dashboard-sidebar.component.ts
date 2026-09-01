// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input } from '@angular/core';
import { FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@services/feature-flag.service';
import { ProjectContextService } from '@services/project-context.service';
import { DashboardQuicklinksComponent } from '../dashboard-quicklinks/dashboard-quicklinks.component';
import { FormationCardComponent } from '../formation-card/formation-card.component';
import { ProjectStaffCardComponent } from '../project-staff-card/project-staff-card.component';

@Component({
  selector: 'lfx-dashboard-sidebar',
  host: { class: 'block w-full shrink-0 xl:w-64' },
  imports: [DashboardQuicklinksComponent, ProjectStaffCardComponent, FormationCardComponent],
  templateUrl: './dashboard-sidebar.component.html',
})
export class DashboardSidebarComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly projectContextService = inject(ProjectContextService);

  public readonly projectUid = input.required<string>();
  public readonly staffHeading = input.required<string>();

  /** GH-1955 — see `FORMATION_ENABLED_FLAG`'s doc comment for what this does and doesn't gate. */
  protected readonly formationFlagEnabled = this.featureFlagService.getBooleanFlag(FORMATION_ENABLED_FLAG, false);
  protected readonly isFormation = this.projectContextService.isActiveProjectInFormation;
}
