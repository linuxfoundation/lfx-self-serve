// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, inject, input, output, PLATFORM_ID } from '@angular/core';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import { DEFAULT_MENTION_PAGE_SIZE, MENTION_PAGE_SIZE_OPTIONS } from '@lfx-one/shared/constants';
import { SkeletonModule } from 'primeng/skeleton';

import type { Mention } from '@lfx-one/shared/interfaces';

import { MentionCardComponent } from '../mention-card/mention-card.component';

/**
 * The Social Listening feed list (LFXV2-3016): one `lfx-mention-card` per row inside a lazy
 * `lfx-table`; the page feeds the current window slice, `totalRecords` comes from the count endpoint.
 */
@Component({
  selector: 'lfx-mentions-list',
  imports: [DatePipe, TableComponent, MentionCardComponent, EmptyStateComponent, SkeletonModule],
  templateUrl: './mentions-list.component.html',
  styleUrl: './mentions-list.component.scss',
})
export class MentionsListComponent {
  private readonly platformId = inject(PLATFORM_ID);

  public readonly mentions = input<Mention[]>([]);
  public readonly loading = input(false);
  public readonly totalMentions = input(0);
  public readonly first = input(0);
  public readonly rows = input(DEFAULT_MENTION_PAGE_SIZE);
  public readonly rowsPerPageOptions = input<number[]>(MENTION_PAGE_SIZE_OPTIONS);
  /** "Data as of" watermark — the feed response's `computedAt`, converted to a Date by the page. */
  public readonly dataComputedAt = input<Date | null>(null);
  /** Shared relative-time heartbeat from the page, passed through to each card. */
  public readonly timeTick = input(0);

  public readonly pageChange = output<{ page: number; rows: number }>();

  protected onTablePage(event: { first: number; rows: number }): void {
    this.pageChange.emit({ page: event.rows > 0 ? Math.floor(event.first / event.rows) : 0, rows: event.rows });
    if (isPlatformBrowser(this.platformId)) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
}
