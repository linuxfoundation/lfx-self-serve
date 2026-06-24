// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import type { OrgLensLeaderboardTimeRange } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-project-detail-tab-bar',
  templateUrl: './org-project-detail-tab-bar.component.html',
})
export class OrgProjectDetailTabBarComponent {
  public readonly timeRange = input.required<OrgLensLeaderboardTimeRange>();
  public readonly timeRangeOptions = input.required<{ id: OrgLensLeaderboardTimeRange; label: string }[]>();
  public readonly timeRangeChange = output<OrgLensLeaderboardTimeRange>();
}
