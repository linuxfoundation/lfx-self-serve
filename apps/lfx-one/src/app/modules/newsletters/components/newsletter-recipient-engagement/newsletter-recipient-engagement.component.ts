// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { BadgeComponent } from '@components/badge/badge.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  NewsletterRecipientEngagement,
  NewsletterRecipientEngagementChipConfig,
  NewsletterRecipientEngagementChipKey,
  NewsletterRecipientEngagementResponse,
  NewsletterRecipientEngagementSegment,
  NewsletterRecipientRow,
  NewsletterStatus,
} from '@lfx-one/shared/interfaces';
import { formatRelativeTime } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, of, startWith, switchMap } from 'rxjs';

/**
 * "Who received this and did they open it" — sits below the aggregate
 * "Opens over time" chart on the newsletter analytics page. Self-contained:
 * owns its own fetch/loading/error/visibility so it can hide itself (e.g. on
 * 403 — the upstream endpoint is PII-gated behind the `auditor` relation,
 * stricter than the aggregate analytics' `viewer` gate) without the parent
 * needing to know why.
 */
@Component({
  selector: 'lfx-newsletter-recipient-engagement',
  imports: [DatePipe, ReactiveFormsModule, CardComponent, TableComponent, InputTextComponent, PersonAvatarComponent, TagComponent, BadgeComponent],
  templateUrl: './newsletter-recipient-engagement.component.html',
})
export class NewsletterRecipientEngagementComponent {
  private readonly newsletterService = inject(NewsletterService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly projectUid = input.required<string>();
  public readonly newsletterUid = input.required<string>();
  public readonly status = input.required<NewsletterStatus>();
  // Set by the parent from its own NewsletterAnalytics.hasClickData. See `showClicks`
  // for why this is OR-ed with, not replaced by, this component's own rows.
  public readonly analyticsHasClicks = input<boolean>(false);

  // Filter form
  public readonly filterForm: FormGroup;
  public readonly searchTerm: Signal<string>;

  // === Simple state ===
  public readonly response = signal<NewsletterRecipientEngagementResponse | null>(null);
  public readonly loading = signal<boolean>(false);
  // True on 403 (no `auditor` access) or 404 — the section renders nothing at all.
  public readonly hidden = signal<boolean>(false);
  // Set on other failures (500/503) — the section stays visible with an inline note
  // instead of hiding, since the aggregate analytics above remain usable.
  public readonly loadErrorMessage = signal<string | null>(null);
  public readonly expandedEmails = signal<Set<string>>(new Set());
  public readonly activeChip = signal<NewsletterRecipientEngagementChipKey>('all');

  // === Computed (complex bodies extracted to private init* methods) ===
  public readonly rows: Signal<NewsletterRecipientRow[]> = this.initRows();
  public readonly chipConfig: Signal<NewsletterRecipientEngagementChipConfig[]> = this.initChipConfig();
  public readonly filteredRows: Signal<NewsletterRecipientRow[]> = this.initFilteredRows();
  public readonly showCompletenessNote = computed(() => this.response()?.complete === false);
  /**
   * Click columns/chip/timeline show when EITHER the parent's aggregate analytics
   * or this component's own rows say clicks exist. The two endpoints are fetched
   * independently and can legitimately disagree: this one is gated on the stricter
   * `auditor` relation (vs. the aggregate's `viewer` gate), the aggregate rollup can
   * lag the per-recipient records in either direction, and this response can be
   * `complete: false`. OR-ing means a real click is never hidden, and `false` only
   * when both sources agree there's nothing to show.
   */
  public readonly showClicks = computed(() => this.analyticsHasClicks() || this.rows().some((row) => row.clicked || row.click_count > 0));
  // 6 base columns (chevron, Recipient, Delivery, Engagement, Opens, Last opened)
  // plus Clicks + Last clicked. Bound rather than hard-coded so the timeline and
  // empty-message rows can never drift from the header when clicks are hidden.
  public readonly columnCount = computed(() => (this.showClicks() ? 8 : 6));
  // The timeline row renders its own empty chevron cell, so it spans one fewer.
  public readonly timelineColspan = computed(() => this.columnCount() - 1);

  public constructor() {
    this.filterForm = this.initializeFilterForm();
    this.searchTerm = this.initializeSearchTerm();
    this.initializeResponse();
  }

  public toggleTimeline(email: string): void {
    const next = new Set(this.expandedEmails());
    if (next.has(email)) {
      next.delete(email);
    } else {
      next.add(email);
    }
    this.expandedEmails.set(next);
  }

  public selectChip(key: NewsletterRecipientEngagementChipKey): void {
    this.activeChip.set(key);
  }

  private initializeFilterForm(): FormGroup {
    return new FormGroup({
      search: new FormControl(''),
    });
  }

  private initializeSearchTerm(): Signal<string> {
    return toSignal(this.filterForm.get('search')!.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), { initialValue: '' });
  }

  private initializeResponse(): void {
    combineLatest([toObservable(this.projectUid), toObservable(this.newsletterUid), toObservable(this.status)])
      .pipe(
        switchMap(([projectUid, newsletterUid, status]) => {
          if (status !== 'sent' || !projectUid || !newsletterUid) {
            this.loading.set(false);
            return of(null);
          }

          this.loading.set(true);
          this.hidden.set(false);
          this.loadErrorMessage.set(null);

          return this.newsletterService.getRecipientEngagement(projectUid, newsletterUid).pipe(
            catchError((err: HttpErrorResponse) => {
              if (err.status === 403 || err.status === 404) {
                this.hidden.set(true);
              } else {
                this.loadErrorMessage.set('Could not load recipient details. Please try again.');
              }
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((data) => {
        this.response.set(data);
      });
  }

  // `failed` takes precedence over `opened`: a recipient can bounce or be marked
  // as spam *after* an earlier open, so `opened && failed` must classify as
  // 'failed' to stay consistent with the Delivery column's own tag precedence.
  private classifySegment(recipient: NewsletterRecipientEngagement): NewsletterRecipientEngagementSegment {
    if (recipient.failed) return 'failed';
    if (recipient.opened) return 'opened';
    return 'not-opened';
  }

  private initRows(): Signal<NewsletterRecipientRow[]> {
    return computed(() => {
      const recipients = this.response()?.recipients ?? [];
      return recipients
        .map((recipient) => ({
          ...recipient,
          displayName: recipient.name || recipient.email,
          segment: this.classifySegment(recipient),
          lastOpenedRelative: recipient.last_opened_at ? formatRelativeTime(new Date(recipient.last_opened_at)) : null,
          // Normalized here (never undefined) so the template never needs optional
          // chaining on these — the raw upstream fields are optional for
          // pre-deploy truthfulness, but a built row always has concrete values.
          clicked: recipient.clicked ?? false,
          click_count: recipient.click_count ?? 0,
          clicked_at_list: recipient.clicked_at_list ?? [],
          lastClickedRelative: recipient.last_clicked_at ? formatRelativeTime(new Date(recipient.last_clicked_at)) : null,
        }))
        .sort((a, b) => {
          // A click can be recorded without an open (e.g. an image-blocked client),
          // so keying on `opened` alone would bury the most-engaged recipient below
          // silent openers. This is a strict superset of the previous comparator:
          // with no click data every `clicked` is false and `click_count` is 0, so
          // `aEngaged === a.opened` and the click tiebreak is always a tie.
          const aEngaged = a.opened || a.clicked;
          const bEngaged = b.opened || b.clicked;
          if (aEngaged !== bEngaged) return aEngaged ? -1 : 1;
          if (b.click_count !== a.click_count) return b.click_count - a.click_count;
          return b.open_count - a.open_count;
        });
    });
  }

  private initChipConfig(): Signal<NewsletterRecipientEngagementChipConfig[]> {
    return computed(() => {
      const rows = this.rows();
      const openedCount = rows.filter((row) => row.segment === 'opened').length;
      const notOpenedCount = rows.filter((row) => row.segment === 'not-opened').length;
      const failedCount = rows.filter((row) => row.segment === 'failed').length;
      const chips: NewsletterRecipientEngagementChipConfig[] = [
        { key: 'all', label: 'All', count: rows.length },
        { key: 'opened', label: 'Opened', count: openedCount },
      ];
      // Overlaps 'opened' by design (see NewsletterRecipientEngagementChipKey) —
      // inserted next to it so the two engagement chips read as a pair, ahead of
      // the negative buckets.
      if (this.showClicks()) {
        chips.push({ key: 'clicked', label: 'Clicked', count: rows.filter((row) => row.clicked).length });
      }
      chips.push({ key: 'not-opened', label: 'Not opened', count: notOpenedCount }, { key: 'failed', label: 'Failed', count: failedCount });
      return chips;
    });
  }

  private initFilteredRows(): Signal<NewsletterRecipientRow[]> {
    return computed(() => {
      let filtered = this.rows();

      const chip = this.activeChip();
      // Guarded on showClicks() so a latched 'clicked' selection (from before click
      // data disappeared, e.g. a refetch) falls back to unfiltered instead of
      // filtering against an unreachable chip.
      if (chip === 'clicked' && this.showClicks()) {
        filtered = filtered.filter((row) => row.clicked);
      } else if (chip !== 'all' && chip !== 'clicked') {
        filtered = filtered.filter((row) => row.segment === chip);
      }

      const term = this.searchTerm().toLowerCase().trim();
      if (term) {
        filtered = filtered.filter((row) => row.displayName.toLowerCase().includes(term) || row.email.toLowerCase().includes(term));
      }

      return filtered;
    });
  }
}
