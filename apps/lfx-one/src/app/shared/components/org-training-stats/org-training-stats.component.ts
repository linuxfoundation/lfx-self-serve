// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, input } from '@angular/core';
import type { OrgLensTimeRange, OrgTrainingStats, OrgTrainingStatTileVm } from '@lfx-one/shared/interfaces';
import { buildOrgTrainingStatTiles } from '@lfx-one/shared/utils';
import { TooltipModule } from 'primeng/tooltip';

/**
 * The one stat strip of Training & Certification and People › Trainees: every number, label, caption and tooltip comes
 * from `ORG_TRAINING_STAT_DEFINITIONS`, so both pages show identical values for one stats payload. `stats` null (loading
 * or failed) renders the labels with an em dash.
 */
@Component({
  selector: 'lfx-org-training-stats',
  imports: [TooltipModule],
  templateUrl: './org-training-stats.component.html',
})
export class OrgTrainingStatsComponent {
  public readonly stats = input.required<OrgTrainingStats | null>();
  public readonly range = input.required<OrgLensTimeRange>();

  protected readonly tiles = computed<OrgTrainingStatTileVm[]>(() => buildOrgTrainingStatTiles(this.stats(), this.range()));
}
