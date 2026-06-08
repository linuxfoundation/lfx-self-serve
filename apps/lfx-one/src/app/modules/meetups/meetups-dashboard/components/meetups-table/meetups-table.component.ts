// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output } from '@angular/core';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { MyMeetupsResponse, PageChangeEvent, SortChangeEvent, TagSeverity } from '@lfx-one/shared/interfaces';

type MeetupSortAria = 'ascending' | 'descending' | 'none';
type MeetupSortField = 'EVENT_NAME' | 'COMMUNITY' | 'STARTS_AT' | 'LOCATION';

@Component({
  selector: 'lfx-meetups-table',
  imports: [TableComponent, TagComponent],
  templateUrl: './meetups-table.component.html',
})
export class MeetupsTableComponent {
  public readonly meetupsResponse = input.required<MyMeetupsResponse>();
  public readonly isPastMeetups = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly sortField = input<string>('STARTS_AT');
  public readonly sortOrder = input<'ASC' | 'DESC'>('ASC');
  public readonly pageChange = output<PageChangeEvent>();
  public readonly sortChange = output<SortChangeEvent>();

  protected readonly statusSeverityMap: Partial<Record<string, TagSeverity>> = {
    Registered: 'info',
    'Not Registered': 'secondary',
  };

  protected readonly rppOptions = computed<number[] | undefined>(() => (this.meetupsResponse().total > 10 ? [10, 25, 50] : undefined));

  protected readonly ariaSortMap = computed<Record<MeetupSortField, MeetupSortAria>>(() => {
    const field = this.sortField();
    const order = this.sortOrder();
    const getAriaSort = (f: MeetupSortField): MeetupSortAria => {
      if (field !== f) return 'none';
      return order === 'ASC' ? 'ascending' : 'descending';
    };
    return {
      EVENT_NAME: getAriaSort('EVENT_NAME'),
      COMMUNITY: getAriaSort('COMMUNITY'),
      STARTS_AT: getAriaSort('STARTS_AT'),
      LOCATION: getAriaSort('LOCATION'),
    };
  });

  protected readonly sortIcons = computed(() => {
    const field = this.sortField();
    const order = this.sortOrder();
    const getIcon = (f: MeetupSortField): string => {
      if (field !== f) return 'fa-light fa-sort text-gray-300';
      return order === 'ASC' ? 'fa-solid fa-caret-up text-blue-500' : 'fa-solid fa-caret-down text-blue-500';
    };
    return {
      EVENT_NAME: getIcon('EVENT_NAME'),
      COMMUNITY: getIcon('COMMUNITY'),
      STARTS_AT: getIcon('STARTS_AT'),
      LOCATION: getIcon('LOCATION'),
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
}
