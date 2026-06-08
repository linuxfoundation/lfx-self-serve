// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import type { OrgEvent, OrgEventRowVm, OrgEventsResponse, PageChangeEvent, SortChangeEvent } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-events-table',
  imports: [TableComponent, TagComponent, DecimalPipe],
  templateUrl: './org-events-table.component.html',
})
export class OrgEventsTableComponent {
  public readonly eventsResponse = input.required<OrgEventsResponse>();
  public readonly loading = input<boolean>(false);
  public readonly sortField = input<string>('EVENT_START_DATE');
  public readonly sortOrder = input<'ASC' | 'DESC'>('ASC');
  // Past tab (LFXV2-1900) drops the Action column; upcoming keeps it.
  public readonly showAction = input<boolean>(true);
  public readonly emptyStateTitle = input<string>('No upcoming events');
  public readonly emptyStateSubtitle = input<string>('No upcoming events were found for your organization.');
  public readonly emptyStateIcon = input<string>('fa-light fa-calendar-plus');

  public readonly pageChange = output<PageChangeEvent>();
  public readonly sortChange = output<SortChangeEvent>();
  public readonly attendeesClick = output<OrgEvent>();
  public readonly speakersClick = output<OrgEvent>();

  protected readonly rppOptions = computed<number[] | undefined>(() => (this.eventsResponse().total > 10 ? [10, 25, 50] : undefined));

  // Single source of truth for the empty-row colspan: 8 columns with the Action column, 7 without.
  protected readonly columnCount = computed<number>(() => (this.showAction() ? 8 : 7));

  // Pre-bake the formatted date range per row so the template reads a property instead of calling a method each CD cycle.
  protected readonly rows = computed<OrgEventRowVm[]>(() =>
    this.eventsResponse().data.map((event) => ({ ...event, dateRange: this.formatDateRange(event.eventStartDate, event.eventEndDate) }))
  );

  protected readonly sortAriaMap = computed<Record<string, string>>(() => {
    const field = this.sortField();
    const order = this.sortOrder();
    const forField = (f: string): string => {
      if (field !== f) return 'none';
      return order === 'ASC' ? 'ascending' : 'descending';
    };
    return {
      EVENT_NAME: forField('EVENT_NAME'),
      EVENT_START_DATE: forField('EVENT_START_DATE'),
      EVENT_CITY: forField('EVENT_CITY'),
    };
  });

  protected readonly sortIcons = computed(() => {
    const field = this.sortField();
    const order = this.sortOrder();
    const getIcon = (f: string): string => {
      if (field !== f) return 'fa-light fa-sort text-gray-300';
      return order === 'ASC' ? 'fa-solid fa-caret-up text-blue-500' : 'fa-solid fa-caret-down text-blue-500';
    };
    return {
      EVENT_NAME: getIcon('EVENT_NAME'),
      EVENT_START_DATE: getIcon('EVENT_START_DATE'),
      EVENT_CITY: getIcon('EVENT_CITY'),
    };
  });

  protected onPageChange(event: { first: number; rows: number }): void {
    this.pageChange.emit({ offset: event.first, pageSize: event.rows });
  }

  protected onHeaderClick(field: string): void {
    this.sortChange.emit({ field });
  }

  private formatDateRange(start: string | null, end: string | null): string {
    if (!start) return '—';
    const startDate = new Date(start);
    const singleFormat = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    if (!end) return singleFormat;
    const endDate = new Date(end);
    if (startDate.toISOString().slice(0, 10) === endDate.toISOString().slice(0, 10)) return singleFormat;
    const sameMonthYear = startDate.getUTCMonth() === endDate.getUTCMonth() && startDate.getUTCFullYear() === endDate.getUTCFullYear();
    if (sameMonthYear) {
      const month = startDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
      return `${month} ${startDate.getUTCDate()} – ${endDate.getUTCDate()}, ${startDate.getUTCFullYear()}`;
    }
    const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return `${startStr} – ${endStr}`;
  }
}
