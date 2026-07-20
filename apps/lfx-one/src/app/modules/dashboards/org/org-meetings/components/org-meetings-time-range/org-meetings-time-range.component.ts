// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer } from '@angular/common';
import { Component, computed, inject, makeStateKey, model, PLATFORM_ID, Signal, TransferState, viewChild } from '@angular/core';
import { ORG_MEETINGS_TIME_RANGE_GROUPS, ORG_MEETINGS_TIME_RANGE_LABELS } from '@lfx-one/shared/constants';
import type { OrgMeetingsTimeRange, OrgMeetingsTimeRangeOption } from '@lfx-one/shared/interfaces';
import { formatShortDate } from '@lfx-one/shared/utils';
import { Popover, PopoverModule } from 'primeng/popover';

@Component({
  selector: 'lfx-org-meetings-time-range',
  imports: [PopoverModule],
  templateUrl: './org-meetings-time-range.component.html',
})
export class OrgMeetingsTimeRangeComponent {
  private readonly transferState = inject(TransferState);
  private readonly platformId = inject(PLATFORM_ID);

  // Server renders `rangeLabel`s off `Date.now()` at request time; without pinning that timestamp,
  // the client would recompute a different `now` during hydration (different clock/tick), producing
  // a different formatted string than what the server sent and triggering a hydration mismatch.
  // TransferState carries the exact server timestamp to the client so both compute identical labels.
  private readonly todayTimestampKey = makeStateKey<number>('org-meetings-time-range-today');

  // Model signals for two-way binding
  public readonly value = model.required<OrgMeetingsTimeRange>();

  private readonly popoverRef = viewChild<Popover>('popover');

  // Complex computed
  protected readonly groups: Signal<OrgMeetingsTimeRangeOption[][]> = this.initGroups();
  protected readonly selectedLabel: Signal<string> = computed(() => ORG_MEETINGS_TIME_RANGE_LABELS[this.value()]);

  protected select(option: OrgMeetingsTimeRangeOption): void {
    this.value.set(option.value);
    this.popoverRef()?.hide();
  }

  protected togglePanel(event: Event): void {
    this.popoverRef()?.toggle(event);
  }

  private initGroups(): Signal<OrgMeetingsTimeRangeOption[][]> {
    return computed(() => {
      const today = this.resolveToday();
      return ORG_MEETINGS_TIME_RANGE_GROUPS.map((group) =>
        group.map((value) => ({
          value,
          label: ORG_MEETINGS_TIME_RANGE_LABELS[value],
          rangeLabel: this.rangeLabelFor(value, today),
        }))
      );
    });
  }

  private resolveToday(): Date {
    if (this.transferState.hasKey(this.todayTimestampKey)) {
      const timestamp = this.transferState.get(this.todayTimestampKey, Date.now());
      this.transferState.remove(this.todayTimestampKey);
      return new Date(timestamp);
    }
    const now = Date.now();
    if (isPlatformServer(this.platformId)) {
      this.transferState.set(this.todayTimestampKey, now);
    }
    return new Date(now);
  }

  private rangeLabelFor(value: OrgMeetingsTimeRange, today: Date): string | null {
    switch (value) {
      case 'past90d':
        return this.pastDaysLabel(today, 90);
      case 'past180d':
        return this.pastDaysLabel(today, 180);
      case 'past365d':
        return this.pastDaysLabel(today, 365);
      case 'previousQuarter':
        return this.previousQuarterLabel(today);
      case 'previousYear':
        return `${today.getUTCFullYear() - 1}`;
      case 'previous5y':
        return `${today.getUTCFullYear() - 5} → ${today.getUTCFullYear() - 1}`;
      case 'previous10y':
        return `${today.getUTCFullYear() - 10} → ${today.getUTCFullYear() - 1}`;
      default:
        return null;
    }
  }

  private pastDaysLabel(today: Date, days: number): string {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    return `${formatShortDate(start)} → Today`;
  }

  private previousQuarterLabel(today: Date): string {
    const currentQuarterStartMonth = Math.floor(today.getUTCMonth() / 3) * 3;
    const startMonth = currentQuarterStartMonth - 3;
    const start = new Date(Date.UTC(today.getUTCFullYear(), startMonth, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), startMonth + 2, 1));
    const monthYear = (date: Date): string => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `${monthYear(start)} → ${monthYear(end)}`;
  }
}
