// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output } from '@angular/core';
import { EventsService } from '@app/shared/services/events.service';
import { ButtonComponent } from '@components/button/button.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { MyEventsResponse, PageChangeEvent, SortChangeEvent, TagSeverity } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { take } from 'rxjs/operators';

@Component({
  selector: 'lfx-events-table',
  imports: [TableComponent, TagComponent, ButtonComponent, TooltipModule],
  templateUrl: './events-table.component.html',
})
export class EventsTableComponent {
  private readonly eventsService = inject(EventsService);
  private readonly messageService = inject(MessageService);

  public readonly eventsResponse = input.required<MyEventsResponse>();
  public readonly isPastEvents = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly sortField = input<string>('EVENT_START_DATE');
  public readonly sortOrder = input<'ASC' | 'DESC'>('ASC');
  public readonly pageChange = output<PageChangeEvent>();
  public readonly sortChange = output<SortChangeEvent>();

  protected readonly roleSeverityMap: Partial<Record<string, TagSeverity>> = {
    Attendee: 'secondary',
    Registered: 'secondary',
    Speaker: 'info',
    Sponsor: 'info',
  };

  protected readonly statusSeverityMap: Partial<Record<string, TagSeverity>> = {
    Registered: 'info',
    Attended: 'success',
    'Not Registered': 'secondary',
    Waitlisted: 'warn',
    Cancelled: 'danger',
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
      PROJECT_NAME: getIcon('PROJECT_NAME'),
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

  protected downloadCertificate(eventId: string): void {
    this.eventsService
      .getCertificate({ eventId })
      .pipe(take(1))
      .subscribe({
        next: (blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `certificate-${eventId}.pdf`;
          anchor.click();
          URL.revokeObjectURL(url);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to download certificate. Please try again.',
          });
        },
      });
  }
}
