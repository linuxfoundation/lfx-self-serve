// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, inject, input, output, PLATFORM_ID, QueryList, ViewChildren } from '@angular/core';
import type { OrgLensLeaderboardMetric, OrgLensLeaderboardTimeRange, OrgLensProjectDetailTab } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-project-detail-tab-bar',
  host: {
    class: 'flex w-full items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm',
    'data-testid': 'project-detail-controls-bar',
  },
  templateUrl: './org-project-detail-tab-bar.component.html',
})
export class OrgProjectDetailTabBarComponent {
  @ViewChildren('tabBtn') private readonly tabBtns!: QueryList<ElementRef<HTMLButtonElement>>;

  private readonly platformId = inject(PLATFORM_ID);

  public readonly tabs = input.required<{ id: OrgLensProjectDetailTab; label: string }[]>();
  public readonly activeTab = input.required<OrgLensProjectDetailTab>();
  public readonly timeRange = input.required<OrgLensLeaderboardTimeRange>();
  public readonly timeRangeOptions = input.required<{ id: OrgLensLeaderboardTimeRange; label: string }[]>();
  /** When provided, renders the metric toggle between the tab pills and the time dropdown. */
  public readonly metric = input<OrgLensLeaderboardMetric | null>(null);
  public readonly metricOptions = input<{ id: OrgLensLeaderboardMetric; label: string; icon: string }[] | null>(null);
  public readonly tabChange = output<OrgLensProjectDetailTab>();
  public readonly timeRangeChange = output<OrgLensLeaderboardTimeRange>();
  public readonly metricChange = output<OrgLensLeaderboardMetric>();

  protected onTabKeydown(event: KeyboardEvent): void {
    const ids = this.tabs().map((t) => t.id);
    const idx = ids.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (idx + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (idx - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    if (next !== null) {
      event.preventDefault();
      this.tabChange.emit(ids[next]);
      if (isPlatformBrowser(this.platformId)) {
        const n = next;
        setTimeout(() => this.tabBtns.get(n)?.nativeElement.focus());
      }
    }
  }
}
