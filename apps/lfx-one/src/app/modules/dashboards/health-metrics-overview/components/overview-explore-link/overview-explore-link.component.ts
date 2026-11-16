// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { HealthMetricsOverviewExploreLink } from '@lfx-one/shared/interfaces';

/** The design's outlined "Explore …" pill: an in-app link into a tab section, or an external link when `href` is set. */
@Component({
  selector: 'lfx-overview-explore-link',
  imports: [RouterLink],
  templateUrl: './overview-explore-link.component.html',
  host: { class: 'inline-flex' },
})
export class OverviewExploreLinkComponent {
  public readonly link = input<HealthMetricsOverviewExploreLink | null>(null);
  public readonly href = input<string>('');
  public readonly label = input<string>('');
  /** An empty state's action puts its icon before the label, in place of the trailing arrow. */
  public readonly leadingIcon = input<string>('');
  public readonly testId = input.required<string>();

  protected readonly linkClass =
    'inline-flex h-[30px] items-center gap-[6px] rounded-[12px] border border-blue-400 bg-white px-[13px] text-[12px] font-medium text-blue-600 transition-colors hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500';
}
