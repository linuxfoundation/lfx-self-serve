// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, model, Signal, viewChild } from '@angular/core';
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
      const today = new Date();
      return ORG_MEETINGS_TIME_RANGE_GROUPS.map((group) =>
        group.map((value) => ({
          value,
          label: ORG_MEETINGS_TIME_RANGE_LABELS[value],
          rangeLabel: this.rangeLabelFor(value, today),
        }))
      );
    });
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
        return `${today.getFullYear() - 1}`;
      case 'previous5y':
        return `${today.getFullYear() - 5} → ${today.getFullYear() - 1}`;
      case 'previous10y':
        return `${today.getFullYear() - 10} → ${today.getFullYear() - 1}`;
      default:
        return null;
    }
  }

  private pastDaysLabel(today: Date, days: number): string {
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    return `${formatShortDate(start)} → Today`;
  }

  private previousQuarterLabel(today: Date): string {
    const currentQuarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
    const startMonth = currentQuarterStartMonth - 3;
    const start = new Date(today.getFullYear(), startMonth, 1);
    const end = new Date(today.getFullYear(), startMonth + 2, 1);
    const monthYear = (date: Date): string => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return `${monthYear(start)} → ${monthYear(end)}`;
  }
}
