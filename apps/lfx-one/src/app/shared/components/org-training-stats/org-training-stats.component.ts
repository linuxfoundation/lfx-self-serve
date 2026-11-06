// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, input, signal } from '@angular/core';
import { ORG_TRAINING_STAT_PRIMARY_KEYS } from '@lfx-one/shared/constants';
import type { OrgLensTimeRange, OrgTrainingStats, OrgTrainingStatTileVm } from '@lfx-one/shared/interfaces';
import { buildOrgTrainingStatTiles } from '@lfx-one/shared/utils';
import { TooltipModule } from 'primeng/tooltip';

const PRIMARY_KEYS: ReadonlySet<string> = new Set(ORG_TRAINING_STAT_PRIMARY_KEYS);

/**
 * The one stat strip of Training & Certification and People › Trainees: every number, label, caption and tooltip comes
 * from `ORG_TRAINING_STAT_DEFINITIONS`, so both pages show identical values for one stats payload. `stats` null (loading
 * or failed) renders the labels with an em dash. With `collapsible` the strip shows only the tiles of
 * `ORG_TRAINING_STAT_PRIMARY_KEYS` until a "Show more stats" link reveals the rest (lfx-self-serve#5304); the hidden
 * tiles stay in the DOM, so their values never differ between the two states.
 */
@Component({
  selector: 'lfx-org-training-stats',
  imports: [TooltipModule],
  templateUrl: './org-training-stats.component.html',
})
export class OrgTrainingStatsComponent {
  public readonly stats = input.required<OrgTrainingStats | null>();
  public readonly range = input.required<OrgLensTimeRange>();
  public readonly collapsible = input<boolean>(false);

  protected readonly expanded = signal<boolean>(false);

  protected readonly tiles = computed<OrgTrainingStatTileVm[]>(() => buildOrgTrainingStatTiles(this.stats(), this.range()));
  protected readonly collapsed = computed<boolean>(() => this.collapsible() && !this.expanded());
  protected readonly hiddenCount = computed<number>(() => (this.collapsible() ? this.tiles().filter((tile) => !PRIMARY_KEYS.has(tile.key)).length : 0));

  protected isHidden(tile: OrgTrainingStatTileVm): boolean {
    return this.collapsed() && !PRIMARY_KEYS.has(tile.key);
  }

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }
}
