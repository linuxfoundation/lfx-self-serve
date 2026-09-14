// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output } from '@angular/core';
import { EventsService } from '@app/shared/services/events.service';
import { ButtonComponent } from '@components/button/button.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { MY_EVENT_STATUS } from '@lfx-one/shared/constants';
import { MyEventsResponse, PageChangeEvent, SortChangeEvent, TagSeverity } from '@lfx-one/shared/interfaces';
import { downloadFromUrl, parseContentDispositionFilename } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { take } from 'rxjs/operators';

@Component({
  selector: 'lfx-events-table',
  imports: [TableComponent, TagComponent, ButtonComponent],
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

  /** Exposed for template comparison (gates the Download Certificate button). */
  protected readonly MY_EVENT_STATUS = MY_EVENT_STATUS;

  protected readonly statusSeverityMap: Partial<Record<string, TagSeverity>> = {
    [MY_EVENT_STATUS.REGISTERED]: 'info',
    [MY_EVENT_STATUS.ATTENDED]: 'success',
    [MY_EVENT_STATUS.NOT_REGISTERED]: 'secondary',
    Waitlisted: 'warn',
    Cancelled: 'danger',
  };

  protected readonly rppOptions = computed<number[] | undefined>(() => (this.eventsResponse().total > 10 ? [10, 25, 50] : undefined));

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

  protected onTableRowSelect(event: { data: { url?: string } }): void {
    if (event.data?.url) {
      this.openUrl(event.data.url);
    }
  }

  protected openUrl(url: string): void {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
      window.open(parsed.href, '_blank', 'noopener,noreferrer');
    } catch {
      // invalid URL — no-op
    }
  }

  protected downloadCertificate(eventId: string): void {
    // No catchError: this is a one-shot subscription (take(1)), and the subscribe `error`
    // callback below already surfaces failures via the toast — a deliberate, equivalent trade-off.
    this.eventsService
      .getCertificate({ eventId })
      .pipe(take(1))
      .subscribe({
        next: (response) => {
          const blob = response.body;
          if (!blob) return;
          const headerFileName = parseContentDispositionFilename(response.headers.get('Content-Disposition'));
          const fileName = headerFileName ?? `certificate-${eventId}.pdf`;
          const url = URL.createObjectURL(blob);
          downloadFromUrl(url, fileName);
          // Deferred: some browsers begin the download asynchronously, and revoking
          // synchronously can invalidate the blob URL before it is consumed (see
          // brand-kit-form.component.ts and mktg-agent-run.component.ts).
          setTimeout(() => URL.revokeObjectURL(url), 0);
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
