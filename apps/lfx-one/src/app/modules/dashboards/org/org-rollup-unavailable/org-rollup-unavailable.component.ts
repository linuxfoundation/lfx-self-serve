// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';

/** Stands in for an Org Lens page that cannot render a family roll-up yet (`orgRollUpUnavailablePageGuard`). */
@Component({
  selector: 'lfx-org-rollup-unavailable',
  imports: [OrgLensEmptyStateComponent],
  templateUrl: './org-rollup-unavailable.component.html',
})
export class OrgRollUpUnavailableComponent {}
