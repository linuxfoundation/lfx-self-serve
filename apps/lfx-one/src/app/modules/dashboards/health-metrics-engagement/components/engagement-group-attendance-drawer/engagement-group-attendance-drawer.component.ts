// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, ElementRef, inject, input, model, PLATFORM_ID, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { buildHealthMetricsOverviewPeriods } from '@lfx-one/shared/constants';
import { formatIsoDateLabel } from '@lfx-one/shared/utils';
import { DrawerModule } from 'primeng/drawer';
import { filter } from 'rxjs';

import { EngagementAttendanceBarComponent } from '../engagement-attendance-bar/engagement-attendance-bar.component';

import type { HealthMetricsEngagementGroupRow } from '@lfx-one/shared/interfaces';

/**
 * Per-period breakdown for one group. Renders from the row already in hand — the view has one row
 * per committee and no deeper grain, so a detail fetch would return nothing the table lacks.
 */
@Component({
  selector: 'lfx-engagement-group-attendance-drawer',
  imports: [DrawerModule, EngagementAttendanceBarComponent],
  templateUrl: './engagement-group-attendance-drawer.component.html',
})
export class EngagementGroupAttendanceDrawerComponent {
  private readonly platformId = inject(PLATFORM_ID);

  public readonly visible = model<boolean>(false);
  public readonly row = input<HealthMetricsEngagementGroupRow | null>(null);

  // Lives in the `#header` template, which PrimeNG portals into the panel, so a template ref is the
  // only way to reach the `aria-labelledby` target.
  private readonly titleRef = viewChild<ElementRef<HTMLElement>>('titleRef');
  private previouslyFocusedElement: HTMLElement | null = null;

  // Year labels come from the Overview's own period options, so the drawer cannot drift out of sync
  // with the period pill across a calendar-year rollover.
  private readonly labelByRange = new Map(buildHealthMetricsOverviewPeriods().map((period) => [period.range, period.label]));

  /**
   * `p-drawer` announces as an unnamed `complementary` landmark without this — see
   * `docs/architecture/frontend/drawer-pattern.md` § Dialog semantics.
   */
  protected readonly drawerPt = {
    root: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'engagement-group-drawer-title' },
  };

  /**
   * `DatePipe` would parse the date-only value as UTC midnight and print it in the viewer's zone,
   * reading a day early west of UTC and differing between SSR and hydration.
   */
  protected readonly lastMetLabel = computed(() => {
    const iso = this.row()?.lastMetDate;
    return iso ? formatIsoDateLabel(iso) : 'Never';
  });

  /** Most recent period first — the drawer reads as a history, the table as a ranking. */
  protected readonly periods = computed(() =>
    [...(this.row()?.periods ?? [])].reverse().map((period) => ({ ...period, label: this.labelByRange.get(period.range) ?? period.range }))
  );

  public constructor() {
    // Keyed off the model rather than `(onHide)`: PrimeNG emits that only for its own Escape/mask
    // close, so a programmatic close would otherwise leave focus stranded on the removed panel.
    toObservable(this.visible)
      .pipe(
        filter((visible) => !visible),
        takeUntilDestroyed()
      )
      .subscribe(() => this.restoreFocus());
  }

  /**
   * `p-drawer` never moves focus into the panel; it only traps Tab once focus is already inside.
   * Lands on the title so the dialog announces by the group's name.
   */
  protected onDrawerShow(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.titleRef()?.nativeElement.focus();
  }

  /** The close-side half of {@link onDrawerShow}. Idempotent — the captured element is nulled after. */
  private restoreFocus(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    if (this.previouslyFocusedElement?.isConnected) {
      this.previouslyFocusedElement.focus();
    }
    this.previouslyFocusedElement = null;
  }
}
