// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FOUNDATION_EVENT_STATUS_SEVERITY_MAP } from '@lfx-one/shared/constants';
import { FoundationEventStatus } from '@lfx-one/shared/enums';
import { EventsResponse, FoundationEventWithActions, PageChangeEvent, SortChangeEvent } from '@lfx-one/shared/interfaces';

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

  protected readonly statusSeverityMap = FOUNDATION_EVENT_STATUS_SEVERITY_MAP;

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
    return this.eventsResponse().data.map((event) => {
      const displayStatus = this.mapFoundationEventStatus(event.status);
      return {
        ...event,
        displayStatus,
        actionLabel: isPast ? 'View Recap' : this.resolveActionLabel(displayStatus),
        isOutlined: !isPast && displayStatus === FoundationEventStatus.COMING_SOON,
      };
    });
  });

  protected onPageChange(event: { first: number; rows: number }): void {
    this.pageChange.emit({ offset: event.first, pageSize: event.rows });
  }

  protected onHeaderClick(field: string): void {
    this.sortChange.emit({ field });
  }

  private resolveActionLabel(displayStatus: string | null): string {
    switch (displayStatus) {
      case FoundationEventStatus.COMING_SOON:
        return 'Notify Me';
      case FoundationEventStatus.COMPLETED:
        return 'View Recap';
      default:
        return 'Register';
    }
  }

  private mapFoundationEventStatus(raw: string | null): string | null {
    switch (raw) {
      case FoundationEventStatus.ACTIVE:
        return FoundationEventStatus.REGISTRATION_OPEN;
      case FoundationEventStatus.PENDING:
      case FoundationEventStatus.PLANNED:
        return FoundationEventStatus.COMING_SOON;
      default:
        return raw;
    }
  }
}
