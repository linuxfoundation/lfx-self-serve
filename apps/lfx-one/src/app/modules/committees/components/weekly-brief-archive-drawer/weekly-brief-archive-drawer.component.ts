// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { WEEKLY_BRIEF_ARCHIVE_PAGE_SIZE, WEEKLY_BRIEF_SHAREABLE_STATES } from '@lfx-one/shared/constants';
import { WeeklyBrief } from '@lfx-one/shared/interfaces';
import { formatUtcDateRangeLabel } from '@lfx-one/shared/utils';
import { WeeklyBriefService } from '@services/weekly-brief.service';
import { DrawerModule } from 'primeng/drawer';
import { SkeletonModule } from 'primeng/skeleton';
import { finalize } from 'rxjs';

@Component({
  selector: 'lfx-weekly-brief-archive-drawer',
  imports: [DrawerModule, ButtonComponent, TagComponent, SkeletonModule],
  templateUrl: './weekly-brief-archive-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyBriefArchiveDrawerComponent {
  // === Services ===
  private readonly weeklyBriefService = inject(WeeklyBriefService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly committeeId = input.required<string>();

  // === Model (two-way) ===
  public readonly visible = model<boolean>(false);

  // === State ===
  public readonly loading = signal(false);
  public readonly loadingMore = signal(false);
  public readonly error = signal(false);
  public readonly briefs = signal<WeeklyBrief[]>([]);
  public readonly hasMore = signal(false);

  private nextCursor: string | undefined;

  public constructor() {
    // Lazy fetch: load on first open; clear on close so a reopened drawer always starts fresh.
    effect(() => {
      if (this.visible()) {
        this.load();
      } else {
        this.reset();
      }
    });
  }

  public onClose(): void {
    this.visible.set(false);
  }

  public onRetry(): void {
    this.load();
  }

  public onLoadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    this.weeklyBriefService
      .listWeeklyBriefs(this.committeeId(), { limit: WEEKLY_BRIEF_ARCHIVE_PAGE_SIZE, page_token: this.nextCursor })
      .pipe(
        finalize(() => this.loadingMore.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (response) => {
          const filtered = (response.data ?? []).filter((b) => WEEKLY_BRIEF_SHAREABLE_STATES.includes(b.state));
          this.briefs.update((prev) => [...prev, ...filtered]);
          this.nextCursor = response.page_token;
          this.hasMore.set(!!response.page_token);
        },
        error: () => {
          // A load-more failure only surfaces via the console — the existing briefs remain visible.
          console.error('[weekly-brief-archive-drawer] failed to load more briefs');
        },
      });
  }

  protected formatDateRange(windowStart: string, windowEnd: string): string {
    return formatUtcDateRangeLabel(windowStart, windowEnd);
  }

  protected stateLabel(state: WeeklyBrief['state']): string {
    switch (state) {
      case 'approved':
        return 'Approved';
      case 'edited':
        return 'Edited';
      default:
        return 'Generated';
    }
  }

  protected stateSeverity(state: WeeklyBrief['state']): 'success' | 'info' | 'secondary' {
    switch (state) {
      case 'approved':
        return 'success';
      case 'edited':
        return 'info';
      default:
        return 'secondary';
    }
  }

  private load(): void {
    this.reset();
    this.loading.set(true);
    this.weeklyBriefService
      .listWeeklyBriefs(this.committeeId(), { limit: WEEKLY_BRIEF_ARCHIVE_PAGE_SIZE })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (response) => {
          const filtered = (response.data ?? []).filter((b) => WEEKLY_BRIEF_SHAREABLE_STATES.includes(b.state));
          this.briefs.set(filtered);
          this.nextCursor = response.page_token;
          this.hasMore.set(!!response.page_token);
          this.error.set(false);
        },
        error: () => {
          console.error('[weekly-brief-archive-drawer] failed to load brief archive');
          this.error.set(true);
        },
      });
  }

  private reset(): void {
    this.briefs.set([]);
    this.nextCursor = undefined;
    this.hasMore.set(false);
    this.error.set(false);
  }
}
