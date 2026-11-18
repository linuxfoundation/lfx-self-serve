// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { ORG_EVENTS_PAGE_COPY, ORG_EVENTS_ROLL_UP_PAGE_COPY } from '@lfx-one/shared/constants';
import type { OrgEvent, OrgEventRowVm, OrgEventsResponse, PageChangeEvent, SortChangeEvent } from '@lfx-one/shared/interfaces';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-org-events-table',
  imports: [TableComponent, TagComponent, DecimalPipe, TooltipModule],
  templateUrl: './org-events-table.component.html',
})
export class OrgEventsTableComponent {
  public readonly eventsResponse = input.required<OrgEventsResponse>();
  public readonly loading = input<boolean>(false);
  public readonly loadFailed = input<boolean>(false);
  public readonly sortField = input<string>('EVENT_START_DATE');
  public readonly sortOrder = input<'ASC' | 'DESC'>('ASC');
  // Past tab (LFXV2-1900) drops the Action column; upcoming keeps it.
  public readonly showAction = input<boolean>(true);
  // A family roll-up adds the Company column and names the sponsoring organizations; the single-organization table is unchanged.
  public readonly rollUp = input<boolean>(false);
  // What the Event Attendees number counts and who it is credited to (the shared caption phrases), as the column's tooltip.
  public readonly attendeesCaption = input<string>('');
  public readonly emptyStateTitle = input<string>('No upcoming events');
  public readonly emptyStateSubtitle = input<string>(ORG_EVENTS_PAGE_COPY.upcomingEmpty);
  public readonly emptyStateIcon = input<string>('fa-light fa-calendar-plus');

  public readonly pageChange = output<PageChangeEvent>();
  public readonly sortChange = output<SortChangeEvent>();
  public readonly attendeesClick = output<OrgEvent>();
  public readonly speakersClick = output<OrgEvent>();
  public readonly retry = output<void>();

  protected readonly rppOptions = computed<number[] | undefined>(() => (this.eventsResponse().total > 10 ? [10, 25, 50] : undefined));

  protected readonly copy = computed(() => (this.rollUp() ? ORG_EVENTS_ROLL_UP_PAGE_COPY : ORG_EVENTS_PAGE_COPY));

  // Single source of truth for the empty-row colspan: 7 columns, plus Action and the roll-up's Company column.
  protected readonly columnCount = computed<number>(() => 7 + (this.showAction() ? 1 : 0) + (this.rollUp() ? 1 : 0));

  /**
   * Whether to name the goal in the column header. Driven by the data, not by a role input: the
   * server omits `eventRegistrationsGoal` entirely for an external admin (#4432), so its presence
   * on any row is exactly the signal that this viewer is allowed to see it. Keeps the component
   * free of any notion of staff, and keeps the header honest when every goal happens to be null.
   */
  protected readonly showGoal = computed<boolean>(() =>
    this.rows().some((row) => row.eventRegistrationsGoal !== null && row.eventRegistrationsGoal !== undefined)
  );

  // Pre-bake the formatted date range and sponsor names per row so the template reads properties instead of calling methods each CD cycle.
  protected readonly rows = computed<OrgEventRowVm[]>(() =>
    this.eventsResponse().data.map((event) => ({
      ...event,
      dateRange: this.formatDateRange(event.eventStartDate, event.eventEndDate),
      sponsorNames: this.rollUp() && event.sponsors?.length ? event.sponsors.map((sponsor) => sponsor.name).join(', ') : null,
    }))
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
