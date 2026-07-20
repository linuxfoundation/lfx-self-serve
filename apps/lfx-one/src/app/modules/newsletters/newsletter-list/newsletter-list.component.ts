// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { NEWSLETTER_ANALYTICS_FETCH_CONCURRENCY } from '@lfx-one/shared/constants';
import {
  FilterPillOption,
  NewsletterAnalytics,
  NewsletterListItem,
  NewsletterListLoadResult,
  NewsletterOptOut,
  NewsletterRow,
  NewsletterStatusTabId,
} from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, distinctUntilChanged, EMPTY, finalize, from, map, mergeMap, of, switchMap, take } from 'rxjs';

import { NewsletterPreviewDrawerComponent } from '../components/newsletter-preview-drawer/newsletter-preview-drawer.component';

@Component({
  selector: 'lfx-newsletter-list',
  imports: [
    DatePipe,
    ButtonComponent,
    CardComponent,
    CardTabsBarComponent,
    EmptyStateComponent,
    TableComponent,
    TagComponent,
    ConfirmDialogModule,
    SkeletonModule,
    TooltipModule,
    NewsletterPreviewDrawerComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './newsletter-list.component.html',
  styleUrl: './newsletter-list.component.scss',
})
export class NewsletterListComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly newsletterService = inject(NewsletterService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  // === Tab options ===
  protected readonly statusTabOptions: FilterPillOption[] = [
    { id: 'draft', label: 'Drafts' },
    { id: 'sent', label: 'Sent' },
    { id: 'optout', label: 'Opt-out' },
  ];

  // === Writable Signals ===
  protected readonly statusTab = signal<NewsletterStatusTabId>('draft');
  protected readonly newsletters = signal<NewsletterListItem[]>([]);
  protected readonly optOuts = signal<NewsletterOptOut[]>([]);
  protected readonly optOutsLoadFailed = signal<boolean>(false);
  protected readonly loading = signal<boolean>(false);
  protected readonly loadingMore = signal<boolean>(false);
  protected readonly nextPageToken = signal<string | undefined>(undefined);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly previewVisible = signal<boolean>(false);
  protected readonly selectedNewsletter = signal<NewsletterListItem | null>(null);
  // Analytics fetched lazily per sent row (the list endpoint intentionally omits
  // open_rate/unique_opens). Kept in a side map keyed by newsletter id — never
  // written back into `newsletters` — so row identity stays stable and results
  // are cached across draft/sent tab toggles. `null` marks a failed fetch for a
  // settled (`sent`) row; those are not retried while the project context is
  // unchanged. The cache is cleared on project change to keep it bounded.
  private readonly openRateAnalytics = signal<Map<string, NewsletterAnalytics | null>>(new Map());
  private readonly openRatePendingIds = signal<Set<string>>(new Set());
  private lastLoadedUid: string | null = null;
  // Incremented whenever the analytics cache is cleared (project change). Each
  // fan-out batch captures it at start; results from an older generation are
  // discarded so a stale batch can't repopulate the pruned cache or race a
  // newer batch's entries and pending markers (A→B→A project toggles).
  private analyticsCacheGeneration = 0;
  // Incremented on every context-driven list reload. loadMore captures it at
  // request time and discards responses from an older generation — covering
  // change-and-revert (A→B→A) sequences a value comparison would miss. Not a
  // signal: nothing renders from it.
  private loadGeneration = 0;

  // === Reactive context ===
  public readonly projectUid: Signal<string> = this.projectContextService.activeContextUid;
  protected readonly canLoadMore: Signal<boolean> = computed(() => !!this.nextPageToken() && !this.loading() && !this.loadingMore() && !!this.projectUid());
  protected readonly hasNewsletters: Signal<boolean> = computed(() => this.newsletters().length > 0);
  protected readonly hasOptOuts: Signal<boolean> = computed(() => this.optOuts().length > 0);

  // Pre-compute per-row labels so the template doesn't call functions-with-args.
  protected readonly rows: Signal<NewsletterRow[]> = this.initRows();

  public constructor() {
    const tabFromQuery = this.route.snapshot.queryParamMap.get('tab');
    if (tabFromQuery === 'sent' || tabFromQuery === 'draft' || tabFromQuery === 'optout') {
      this.statusTab.set(tabFromQuery);
    }
    this.initLoadOnContextOrTab();
  }

  protected onStatusTabChange(tab: string): void {
    if (tab === 'draft' || tab === 'sent' || tab === 'optout') {
      this.statusTab.set(tab);
    }
  }

  protected goToCreate(): void {
    this.router.navigate(['..', 'create'], { relativeTo: this.route });
  }

  protected goToRow(item: NewsletterListItem): void {
    const target = this.statusTab() === 'sent' ? 'analytics' : 'edit';
    // Carry the newsletter's own project_uid in the URL instead of relying on
    // ambient context — see newsletters.routes.ts for the rationale.
    this.router.navigate(['..', item.project_uid, item.id, target], { relativeTo: this.route });
  }

  protected openPreview(item: NewsletterListItem, event: Event): void {
    event.stopPropagation();
    this.selectedNewsletter.set(item);
    this.previewVisible.set(true);
  }

  protected loadMore(): void {
    const token = this.nextPageToken();
    const uid = this.projectUid();
    const status = this.statusTab();
    const generation = this.loadGeneration;
    // Opt-out has no pagination — canLoadMore() never yields true for it, so
    // this is just the type guard that lets `status` narrow below.
    if (!token || this.loadingMore() || !uid || status === 'optout') return;
    this.loadingMore.set(true);
    this.newsletterService
      .listNewsletters(uid, { status, page_token: token })
      .pipe(
        take(1),
        finalize(() => this.loadingMore.set(false))
      )
      .subscribe({
        next: (response) => {
          // Discard the page if the list was reloaded while it was in flight —
          // appending it would clobber the newer load's rows and page token.
          if (generation !== this.loadGeneration) {
            return;
          }
          this.newsletters.update((current) => [...current, ...response.newsletters]);
          this.nextPageToken.set(response.next_page_token);
          this.loadOpenRates(response.newsletters);
        },
        error: (err: HttpErrorResponse) => {
          // A stale request's failure is irrelevant to the context now on screen.
          if (generation !== this.loadGeneration) {
            return;
          }
          this.showLoadError(err);
        },
      });
  }

  protected onDeleteDraft(item: NewsletterListItem, event: Event): void {
    event.stopPropagation();
    this.confirmationService.confirm({
      key: 'newsletter-list',
      header: 'Delete draft?',
      message: `Are you sure you want to delete "${item.subject || 'Untitled draft'}"? This action cannot be undone.`,
      icon: 'pi pi-trash',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.runDelete(item.id),
    });
  }

  private initRows(): Signal<NewsletterRow[]> {
    return computed(() => {
      const analyticsMap = this.openRateAnalytics();
      const pendingIds = this.openRatePendingIds();
      return this.newsletters().map((n) => {
        const analytics = analyticsMap.get(n.id);
        const total = n.total_recipients ?? 0;
        const opens = n.unique_opens ?? analytics?.unique_opens ?? 0;
        const openRate = n.open_rate ?? analytics?.open_rate;
        const groupCount = n.committee_uids?.length ?? 0;
        const hasOpenRate = openRate !== undefined && openRate !== null;
        const openRateLabel = hasOpenRate ? `${Math.round(openRate * 100)}%` : '—';
        // Don't fabricate "0 of N opened" when analytics are missing or failed.
        const openRateTooltip = hasOpenRate ? `${opens} of ${total} recipients opened` : 'Analytics not available';
        return {
          ...n,
          openRateLabel,
          openRatePending: pendingIds.has(n.id),
          openRateTooltip,
          openRateAria: hasOpenRate ? `Open rate ${openRateLabel}, ${openRateTooltip}` : 'Open rate not available',
          recipientsLabel: n.total_recipients !== undefined && n.total_recipients !== null ? String(n.total_recipients) : '—',
          groupsLabel: `${groupCount} ${groupCount === 1 ? 'group' : 'groups'}`,
        };
      });
    });
  }

  // switchMap cancels the in-flight initial list request when the tab or project
  // changes, so a slow response can never clobber the newer tab's rows or fan out
  // analytics for rows that are no longer displayed. (loadMore requests are not
  // cancelled — loadMore guards its own response against context changes instead.)
  // Loading is cleared explicitly on every outcome path (empty uid, error, next)
  // rather than via finalize, so cancellation can never produce a loading write
  // regardless of operator teardown ordering.
  private initLoadOnContextOrTab(): void {
    combineLatest([toObservable(this.projectUid), toObservable(this.statusTab)])
      .pipe(
        distinctUntilChanged(([prevUid, prevTab], [uid, tab]) => prevUid === uid && prevTab === tab),
        switchMap(([uid, status]) => {
          this.loadGeneration++;
          this.previewVisible.set(false);
          this.selectedNewsletter.set(null);
          this.nextPageToken.set(undefined);
          this.newsletters.set([]);
          this.optOuts.set([]);
          this.optOutsLoadFailed.set(false);
          if (uid !== this.lastLoadedUid) {
            this.lastLoadedUid = uid;
            this.analyticsCacheGeneration++;
            this.openRateAnalytics.set(new Map());
            this.openRatePendingIds.set(new Set());
          }
          if (!uid) {
            this.loading.set(false);
            return EMPTY;
          }
          this.loading.set(true);
          if (status === 'optout') {
            return this.newsletterService.listOptOuts(uid).pipe(
              map((response): NewsletterListLoadResult => ({ kind: 'optout', response })),
              catchError((err: HttpErrorResponse) => {
                this.loading.set(false);
                this.optOutsLoadFailed.set(true);
                this.showLoadError(err, 'Could not load opt-outs');
                return EMPTY;
              })
            );
          }
          return this.newsletterService.listNewsletters(uid, { status }).pipe(
            map((response): NewsletterListLoadResult => ({ kind: 'newsletters', response })),
            catchError((err: HttpErrorResponse) => {
              this.loading.set(false);
              this.showLoadError(err);
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        this.loading.set(false);
        if (result.kind === 'optout') {
          this.optOuts.set(result.response.opt_outs);
          return;
        }
        this.newsletters.set(result.response.newsletters);
        this.nextPageToken.set(result.response.next_page_token);
        this.loadOpenRates(result.response.newsletters);
      });
  }

  private runDelete(id: string): void {
    if (!this.projectUid()) return;
    this.deletingId.set(id);
    this.newsletterService
      .deleteNewsletter(this.projectUid(), id)
      .pipe(
        take(1),
        finalize(() => this.deletingId.set(null))
      )
      .subscribe({
        next: () => {
          this.newsletters.update((current) => current.filter((n) => n.id !== id));
          this.messageService.add({ severity: 'success', summary: 'Draft deleted', detail: 'The draft has been removed.' });
        },
        error: (err: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Delete failed',
            detail: err?.error?.message || err?.message || 'Could not delete the draft. Please try again.',
          });
        },
      });
  }

  // Fan out one analytics call per newly loaded sent row to fill the Open Rate
  // column. Browser-only: SSR skips the fan-out and the client replay of the
  // list load (via the transfer cache) triggers it. Rows whose analytics are
  // already loaded or in flight are skipped, so tab toggles and load-more never
  // duplicate requests. `sending` rows are excluded rather than negatively
  // cached — their analytics don't exist yet, and the next list load (tab or
  // project change) retries them once they settle to `sent`.
  private loadOpenRates(items: NewsletterListItem[]): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const targets = items.filter(
      (n) =>
        n.status === 'sent' &&
        (n.open_rate === undefined || n.open_rate === null) &&
        !this.openRateAnalytics().has(n.id) &&
        !this.openRatePendingIds().has(n.id)
    );
    if (targets.length === 0) {
      return;
    }
    const cacheGeneration = this.analyticsCacheGeneration;
    this.openRatePendingIds.update((ids) => new Set([...ids, ...targets.map((n) => n.id)]));
    from(targets)
      .pipe(
        mergeMap(
          // Use the item's own project_uid rather than ambient context — see goToRow.
          (n) =>
            this.newsletterService.getAnalytics(n.project_uid, n.id).pipe(
              map((analytics): { id: string; analytics: NewsletterAnalytics | null } => ({ id: n.id, analytics })),
              // A single failed row keeps its "—" without breaking the rest.
              catchError((err: HttpErrorResponse) => {
                console.error(`Failed to load analytics for newsletter ${n.id}:`, err);
                return of({ id: n.id, analytics: null });
              })
            ),
          NEWSLETTER_ANALYTICS_FETCH_CONCURRENCY
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ id, analytics }) => {
        // A result from before the last cache clear is stale — writing it would
        // repopulate the pruned cache and race the newer batch for the same ids.
        // Within a generation the pending-set dedupe guarantees one fetch per id.
        if (cacheGeneration !== this.analyticsCacheGeneration) {
          return;
        }
        this.openRateAnalytics.update((current) => new Map(current).set(id, analytics));
        this.openRatePendingIds.update((ids) => {
          const next = new Set(ids);
          next.delete(id);
          return next;
        });
      });
  }

  private showLoadError(err: HttpErrorResponse, summary = 'Could not load newsletters'): void {
    this.messageService.add({
      severity: 'error',
      summary,
      detail: err?.error?.message || err?.message || 'Please try again later.',
    });
  }
}
