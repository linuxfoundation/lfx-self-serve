// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FoundationEventStatus } from '@lfx-one/shared/enums';
import { EventsResponse, FoundationEventWithActions, PageChangeEvent, SortChangeEvent, TagSeverity } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-foundation-events-table',
  imports: [TableComponent, TagComponent, ButtonComponent, DecimalPipe],
  templateUrl: './events-table.component.html',
  styleUrls: ['./events-table.component.scss'],
})
export class EventsTableComponent {
  public readonly eventsResponse = input.required<EventsResponse>();
  public readonly isPastEvents = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly sortField = input<string>('EVENT_START_DATE');
  public readonly sortOrder = input<'ASC' | 'DESC'>('ASC');
  public readonly pageChange = output<PageChangeEvent>();
  public readonly sortChange = output<SortChangeEvent>();

  protected readonly statusSeverityMap: Partial<Record<string, TagSeverity>> = {
    Planned: 'secondary',
    Pending: 'secondary',
    Completed: 'success',
    Active: 'info',
  };

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

  protected readonly eventsWithActions = computed<FoundationEventWithActions[]>(() => {
    const isPast = this.isPastEvents();
    return this.eventsResponse().data.map((event) => ({
      ...event,
      actionLabel: isPast ? 'View Recap' : this.resolveActionLabel(event.status),
      isOutlined: !isPast && (event.status === FoundationEventStatus.PLANNED || event.status === FoundationEventStatus.PENDING),
    }));
  });

  protected onPageChange(event: { first: number; rows: number }): void {
    this.pageChange.emit({ offset: event.first, pageSize: event.rows });
  }

  protected onHeaderClick(field: string): void {
    this.sortChange.emit({ field });
  }

  private resolveActionLabel(status: string | null): string {
    switch (status) {
      case FoundationEventStatus.PLANNED:
      case FoundationEventStatus.PENDING:
        return 'Notify Me';
      case FoundationEventStatus.COMPLETED:
        return 'View Recap';
      default:
        return 'Register';
    }
  }
}
