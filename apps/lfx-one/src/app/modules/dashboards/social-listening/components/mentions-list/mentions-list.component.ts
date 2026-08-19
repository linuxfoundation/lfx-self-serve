// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, inject, input, output, PLATFORM_ID, viewChild } from '@angular/core';
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
  /** Current window's background fill failed past its auto-retry — the empty state swaps to a retry row. */
  public readonly phase2Failed = input(false);
  /** Count endpoint failed while the feed has rows — keeps the paginator visible so the user isn't stranded. */
  public readonly countError = input(false);

  public readonly pageChange = output<{ page: number; rows: number }>();
  /** Manual retry of a phase-2-failed window. */
  public readonly retry = output<void>();

  private readonly listContainer = viewChild<ElementRef<HTMLElement>>('listContainer');

  protected onTablePage(event: { first: number; rows: number }): void {
    this.pageChange.emit({ page: event.rows > 0 ? Math.floor(event.first / event.rows) : 0, rows: event.rows });
    this.scrollListIntoView();
  }

  // Scrolls the list, not the window — paging shouldn't yank the user past the page header.
  private scrollListIntoView(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const container = this.listContainer()?.nativeElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  }
}
