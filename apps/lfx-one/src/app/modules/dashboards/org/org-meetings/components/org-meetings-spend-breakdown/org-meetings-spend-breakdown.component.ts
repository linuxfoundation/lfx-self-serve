// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { DEMO_ORG_MEETINGS_SPEND } from '@lfx-one/shared/constants';
import type { OrgMeetingsTimeRange } from '@lfx-one/shared/interfaces';

import { OrgSpendBarComponent } from './org-spend-bar.component';

@Component({
  selector: 'lfx-org-meetings-spend-breakdown',
  imports: [OrgSpendBarComponent],
  templateUrl: './org-meetings-spend-breakdown.component.html',
})
export class OrgMeetingsSpendBreakdownComponent {
  // Public fields from inputs
  // Accepted but not yet consumed — data is demo-only until this section wires to real Snowflake queries.
  public readonly timeRange = input.required<OrgMeetingsTimeRange>();

  // Configuration
  protected readonly spend = DEMO_ORG_MEETINGS_SPEND;
}
