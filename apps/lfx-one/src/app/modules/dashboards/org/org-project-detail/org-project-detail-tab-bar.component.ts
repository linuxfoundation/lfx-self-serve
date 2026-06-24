// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, inject, input, output, PLATFORM_ID, QueryList, ViewChildren } from '@angular/core';
import type { OrgLensLeaderboardTimeRange, OrgLensProjectDetailTab } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-project-detail-tab-bar',
  templateUrl: './org-project-detail-tab-bar.component.html',
})
export class OrgProjectDetailTabBarComponent {
  @ViewChildren('tabBtn') private readonly tabBtns!: QueryList<ElementRef<HTMLButtonElement>>;

  private readonly platformId = inject(PLATFORM_ID);

  public readonly tabs = input.required<{ id: OrgLensProjectDetailTab; label: string }[]>();
  public readonly activeTab = input.required<OrgLensProjectDetailTab>();
  public readonly timeRange = input.required<OrgLensLeaderboardTimeRange>();
  public readonly timeRangeOptions = input.required<{ id: OrgLensLeaderboardTimeRange; label: string }[]>();
  public readonly tabChange = output<OrgLensProjectDetailTab>();
  public readonly timeRangeChange = output<OrgLensLeaderboardTimeRange>();

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

  protected onRangeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as OrgLensLeaderboardTimeRange;
    this.timeRangeChange.emit(value);
  }
}
