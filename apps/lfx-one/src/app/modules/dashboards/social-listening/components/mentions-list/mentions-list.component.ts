// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, output, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import { SkeletonModule } from 'primeng/skeleton';

import type { Mention } from '@lfx-one/shared/interfaces';

import { MentionCardComponent } from '../mention-card/mention-card.component';

/**
 * The Social Listening feed list (LFXV2-3016): one `lfx-mention-card` per row inside a paginator-less
 * `lfx-table`; the page feeds the cumulative loaded rows and a Load More footer advances the feed.
 */
@Component({
  selector: 'lfx-mentions-list',
  imports: [DatePipe, TableComponent, MentionCardComponent, EmptyStateComponent, SkeletonModule, ButtonComponent],
  templateUrl: './mentions-list.component.html',
  styleUrl: './mentions-list.component.scss',
})
export class MentionsListComponent {
  public readonly mentions = input<Mention[]>([]);
  public readonly loading = input(false);
  public readonly totalMentions = input(0);
  /** Rows rendered so far — the Load More footer reports it against `servableTotal`. */
  public readonly loadedCount = input(0);
  /** Reachable total — the page caps this at the server's deepest servable offset; `totalMentions` keeps the true count. */
  public readonly servableTotal = input(0);
  public readonly hasMore = input(false);
  /** A Load More fetch is in flight — the footer spins while the loaded rows stay on screen. */
  public readonly loadingMore = input(false);
  /** Rendered rows hit MENTION_FEED_RENDER_LIMIT with more still servable — the footer swaps the button for a refine note. */
  public readonly renderCapped = input(false);
  /** "Data as of" watermark — the feed response's `computedAt`, converted to a Date by the page. */
  public readonly dataComputedAt = input<Date | null>(null);
  /** Shared relative-time heartbeat from the page, passed through to each card. */
  public readonly timeTick = input(0);
  /** Current window's background fill failed past its auto-retry — the empty state swaps to a retry row. */
  public readonly phase2Failed = input(false);
  /** A Load More window fetch failed with rows on screen — the list stays mounted and offers an inline retry. */
  public readonly loadError = input(false);
  /** Count endpoint failed while the feed has rows — keeps the Load More footer visible so the user isn't stranded. */
  public readonly countError = input(false);
  /** Bookmarked mention IDs for the current foundation (LFXV2-3002 Block 1) — decorates each card's bookmark toggle. */
  public readonly bookmarkedIds = input<Set<string>>(new Set());
  /** Read mention IDs for the current foundation (LFXV2-3002 Block 2) — decorates each card's read toggle. */
  public readonly readMentionIds = input<Set<string>>(new Set());
  /** Unread view — selects the "all caught up" empty state variant. Totals stay visible: the server returns the exact unread count. */
  public readonly unreadView = input(false);

  public readonly loadMore = output<void>();
  /** Empty-state escape hatch — the page owns the reset via resetToDefaultViewState() (scope + filters). */
  public readonly clearFilters = output<void>();
  /** Manual retry of a phase-2-failed window. */
  public readonly retry = output<void>();
  /** Re-emitted card toggle — the page owns the write via MentionBookmarkService. */
  public readonly bookmarkToggled = output<Mention>();
  /** Re-emitted card toggle — the page owns the write via MentionReadStateService. */
  public readonly readToggled = output<Mention>();
  /** Header bulk actions (LFXV2-3002 Block 2) — the page derives the cutoff from the loaded window. */
  public readonly markAllRead = output<void>();
  public readonly markAllUnread = output<void>();

  public readonly isBookmarkedFn: Signal<(id: string) => boolean> = this.initIsBookmarkedFn();
  public readonly isReadFn: Signal<(id: string) => boolean> = this.initIsReadFn();
  /** Load More footer visibility — gated on a landed row so an early advance can't cancel the in-flight window-0 fetch. */
  public readonly showLoadMore = computed(() => this.hasMore() && this.loadedCount() > 0 && !this.phase2Failed() && !this.loadError());

  /** Per-card bookmark lookup (PCC port): one computed over the input set, not a per-row method call. */
  private initIsBookmarkedFn(): Signal<(id: string) => boolean> {
    return computed(() => {
      const ids = this.bookmarkedIds();
      return (id: string) => ids.has(id);
    });
  }

  /** Per-card read lookup (PCC port): one computed over the input set, not a per-row method call. */
  private initIsReadFn(): Signal<(id: string) => boolean> {
    return computed(() => {
      const ids = this.readMentionIds();
      return (id: string) => ids.has(id);
    });
  }
}
