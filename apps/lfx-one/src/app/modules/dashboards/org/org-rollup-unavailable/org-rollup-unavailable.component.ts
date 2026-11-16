// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { ORG_LENS_ROLL_UP_HOME_PAGE } from '@lfx-one/shared/constants';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';

/** Stands in for an Org Lens page that cannot render a family roll-up yet (`orgRollUpUnavailablePageGuard`). */
@Component({
  selector: 'lfx-org-rollup-unavailable',
  imports: [OrgLensEmptyStateComponent],
  templateUrl: './org-rollup-unavailable.component.html',
})
export class OrgRollUpUnavailableComponent {
  private readonly orgLens = inject(OrgLensNavigationService);

  /**
   * The roll-up's own Memberships, `/org/family-{id}/memberships`. Not the registry's legacy `/org/memberships`:
   * once the org list has loaded nothing writes the family back into a legacy address, so the link would drop it.
   */
  protected readonly membershipsLink = computed(() => this.orgLens.orgLensLink(ORG_LENS_ROLL_UP_HOME_PAGE));
}
