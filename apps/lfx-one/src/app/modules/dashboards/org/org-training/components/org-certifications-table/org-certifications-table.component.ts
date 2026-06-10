// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { ENROLL_AGAIN_URL } from '@lfx-one/shared/constants';
import type { OrgCertification, OrgCertificationsResponse, PageChangeEvent, SortChangeEvent } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-org-certifications-table',
  imports: [TableComponent, TagComponent, DecimalPipe],
  templateUrl: './org-certifications-table.component.html',
})
export class OrgCertificationsTableComponent {
  public readonly certificationsResponse = input.required<OrgCertificationsResponse>();
  public readonly loading = input<boolean>(false);
  public readonly sortField = input<string>('CERTIFIED_COUNT');
  public readonly sortOrder = input<'ASC' | 'DESC'>('DESC');
  public readonly emptyStateTitle = input<string>('No certifications yet');
  public readonly emptyStateSubtitle = input<string>('No certifications were found for your organization.');

  public readonly pageChange = output<PageChangeEvent>();
  public readonly sortChange = output<SortChangeEvent>();
  public readonly certifiedClick = output<OrgCertification>();
  public readonly inProgressClick = output<OrgCertification>();

  protected readonly browseUrl = ENROLL_AGAIN_URL;

  protected readonly rppOptions = computed<number[] | undefined>(() => (this.certificationsResponse().total > 10 ? [10, 25, 50] : undefined));

  protected readonly sortAriaMap = computed<Record<string, string>>(() => {
    const field = this.sortField();
    const order = this.sortOrder();
    const forField = (f: string): string => {
      if (field !== f) return 'none';
      return order === 'ASC' ? 'ascending' : 'descending';
    };
    return {
      COURSE_NAME: forField('COURSE_NAME'),
      FOUNDATION_NAME: forField('FOUNDATION_NAME'),
      LEVEL: forField('LEVEL'),
      CERTIFIED_COUNT: forField('CERTIFIED_COUNT'),
      IN_PROGRESS_COUNT: forField('IN_PROGRESS_COUNT'),
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
      COURSE_NAME: getIcon('COURSE_NAME'),
      FOUNDATION_NAME: getIcon('FOUNDATION_NAME'),
      LEVEL: getIcon('LEVEL'),
      CERTIFIED_COUNT: getIcon('CERTIFIED_COUNT'),
      IN_PROGRESS_COUNT: getIcon('IN_PROGRESS_COUNT'),
    };
  });

  protected onPageChange(event: { first: number; rows: number }): void {
    this.pageChange.emit({ offset: event.first, pageSize: event.rows });
  }

  protected onHeaderClick(field: string): void {
    this.sortChange.emit({ field });
  }
}
