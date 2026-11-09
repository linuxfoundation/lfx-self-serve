// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { LINKS_CONFIG } from '@lfx-one/shared/constants';
import type { OrgLensRoiCoverageReason } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-roi-empty-state',
  templateUrl: './org-roi-empty-state.component.html',
})
export class OrgRoiEmptyStateComponent {
  public readonly reason = input.required<OrgLensRoiCoverageReason>();

  protected readonly docsUrl = LINKS_CONFIG.DOCS.COMPANY_LENS_OVERVIEW;

  protected readonly isUnmapped: Signal<boolean> = computed(() => this.reason() === 'unmapped');
}
