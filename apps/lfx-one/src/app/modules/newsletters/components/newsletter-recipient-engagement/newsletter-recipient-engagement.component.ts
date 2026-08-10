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

  // Filter form
  public readonly filterForm: FormGroup;
  public readonly searchTerm: Signal<string>;

  // === Computed (complex bodies extracted to private init* methods) ===
  public readonly rows: Signal<NewsletterRecipientRow[]> = this.initRows();
  public readonly chipConfig: Signal<NewsletterRecipientEngagementChipConfig[]> = this.initChipConfig();
  public readonly filteredRows: Signal<NewsletterRecipientRow[]> = this.initFilteredRows();
  public readonly showCompletenessNote = computed(() => this.response()?.complete === false);

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

  public relativeOpened(iso: string): string {
    return formatRelativeTime(new Date(iso));
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

  private classifySegment(recipient: NewsletterRecipientEngagement): NewsletterRecipientEngagementSegment {
    if (recipient.opened) return 'opened';
    if (recipient.failed) return 'failed';
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
        }))
        .sort((a, b) => {
          if (a.opened !== b.opened) return a.opened ? -1 : 1;
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
      return [
        { key: 'all', label: 'All', count: rows.length },
        { key: 'opened', label: 'Opened', count: openedCount },
        { key: 'not-opened', label: 'Not opened', count: notOpenedCount },
        { key: 'failed', label: 'Failed', count: failedCount },
      ];
    });
  }

  private initFilteredRows(): Signal<NewsletterRecipientRow[]> {
    return computed(() => {
      let filtered = this.rows();

      const chip = this.activeChip();
      if (chip !== 'all') {
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
