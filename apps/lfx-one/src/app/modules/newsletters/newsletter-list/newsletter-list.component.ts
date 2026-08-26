// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
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
import {
  divergentProjectQueryParam,
  formatFutureRelativeTime,
  formatShortDateInTimezone,
  formatTo12HourInTimezone,
  getTimezoneUtcOffsetString,
  getUserTimezone,
  toValidUuid,
} from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, distinctUntilChanged, EMPTY, finalize, forkJoin, from, map, mergeMap, of, switchMap, take } from 'rxjs';

import { extractErrorMessage } from '@shared/utils/http-error.utils';

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

  // === Writable Signals ===
  protected readonly statusTab = signal<NewsletterStatusTabId>('draft');
  protected readonly newsletters = signal<NewsletterListItem[]>([]);
  // `status=sending` rows carrying `scheduled_at` — arms in progress. Populated
  // only while `statusTab() === 'scheduled'`; prepended to `newsletters` for
  // display since they aren't paginated (see initLoadOnContextOrTab).
  protected readonly armingNewsletters = signal<NewsletterListItem[]>([]);
  protected readonly optOuts = signal<NewsletterOptOut[]>([]);
  protected readonly optOutsLoadFailed = signal<boolean>(false);
  protected readonly loading = signal<boolean>(false);
  protected readonly loadingMore = signal<boolean>(false);
  protected readonly nextPageToken = signal<string | undefined>(undefined);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly removingOptOutId = signal<string | null>(null);
  protected readonly cancelingScheduleId = signal<string | null>(null);
  protected readonly previewVisible = signal<boolean>(false);
  protected readonly selectedNewsletter = signal<NewsletterListItem | null>(null);
  // Upstream authorizes opt-out removal for the `writer` relation only, while the
  // newsletters route guard also fast-paths the ED persona — gate the destructive
  // action on writer permission so ED non-writers don't get a button that 403s.
  protected readonly canWrite = this.projectContextService.canWrite;
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
  // Publication id from the `:pubId` route param, when this instance is showing
  // one publication's editions rather than the flat list. Subscribed via
  // `toSignal`, not a one-time snapshot: Angular reuses this component instance
  // across navigations that change only route params, so a snapshot would go
  // stale navigating between two publications' editions (e.g. a deep link opened
  // while this page is already showing a different publication) and keep
  // querying the first one. Drives `initLoadOnContextOrTabAndPublication` below.
  // Gated with the shared toValidUuid: an unvalidated :pubId flows straight
  // into the publication_id list filter and (via goToCreate) into the create
  // payload, both of which upstream 400s on a malformed value — gating here
  // degrades a bad segment to the unfiltered list / unfiled create instead of
  // a hard failure. Deliberately NOT the same treatment as routeProjectUid
  // below: an unvalidated :projectUid path segment is left ungated there,
  // since upstream reads project_uid as an opaque filter with no format
  // validation of its own (a malformed one just yields an empty result), so
  // degrading it here would substitute a *different* project's data instead
  // of the intended fail-safe of showing none.
  protected readonly publicationId: Signal<string | undefined> = toSignal(this.route.paramMap.pipe(map((p) => toValidUuid(p.get('pubId')))), {
    initialValue: toValidUuid(this.route.snapshot.paramMap.get('pubId')),
  });
  // The `:pubId` editions route carries `:projectUid` alongside it (see
  // newsletters.routes.ts) so a deep link resolves the publication's own project
  // even next to a stale or different active-context cookie. The flat `list`
  // route has no projectUid segment, so it falls back next to a `?project=`
  // query param (see below), then the active context — same fallback pattern
  // as newsletter-manage.component.ts's routeProjectUid.
  private readonly routeProjectUid: Signal<string | null> = toSignal(this.route.paramMap.pipe(map((p) => p.get('projectUid'))), {
    initialValue: this.route.snapshot.paramMap.get('projectUid'),
  });
  // newsletter-manage.component.ts's goToList() carries the resolved project
  // on ?project= for the same divergent-context reason goToCreate() does.
  // Every navigation that reaches 'list' comes from a different route config
  // (create, :projectUid/:id/edit), which Angular destroys/recreates rather
  // than reuses, so an entry-snapshot read (like newsletter-manage's sibling
  // queryProjectRef) would suffice today — this is read reactively instead as
  // belt-and-braces against a future list-to-list navigation being added
  // without updating this read, not because one exists now. ?project= is
  // otherwise always a slug everywhere else it's produced in this app;
  // goToList/goToCreate are the exception that write a UID (see their own
  // comments), so only a UID-shaped value is used directly here — a slug
  // falls through to activeContextUid() instead, same shared toValidUuid
  // gating as newsletter-manage.component.ts's queryProjectUid.
  private readonly routeProjectRef: Signal<string | null> = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('project'))), {
    initialValue: this.route.snapshot.queryParamMap.get('project'),
  });
  private readonly routeProjectRefUid: Signal<string | null> = computed(() => toValidUuid(this.routeProjectRef()) ?? null);
  public readonly projectUid: Signal<string> = computed(
    () => this.routeProjectUid() || this.routeProjectRefUid() || this.projectContextService.activeContextUid()
  );
  protected readonly canLoadMore: Signal<boolean> = computed(() => !!this.nextPageToken() && !this.loading() && !this.loadingMore() && !!this.projectUid());
  protected readonly hasNewsletters: Signal<boolean> = computed(() => this.newsletters().length > 0 || this.armingNewsletters().length > 0);
  protected readonly hasOptOuts: Signal<boolean> = computed(() => this.optOuts().length > 0);
  // Opt-outs are project-wide — listOptOuts(uid) has no publication scope — so
  // the tab doesn't belong on a single publication's editions page. Showing it
  // there would let a per-publication view read and mutate a project-wide list.
  protected readonly statusTabOptions: Signal<FilterPillOption[]> = computed(() => {
    const base: FilterPillOption[] = [
      { id: 'draft', label: 'Drafts' },
      { id: 'scheduled', label: 'Scheduled' },
      { id: 'sent', label: 'Sent' },
    ];
    return this.publicationId() ? base : [...base, { id: 'optout', label: 'Opt-out' }];
  });
  // Per-tab empty-state copy, keyed by tab id — avoids nesting ternaries in the template
  // (repo convention) for what's otherwise a flat lookup with no other tab-specific branching.
  protected readonly emptyStateCopy: Signal<{ title: string; subtitle: string }> = computed(() => {
    const copy: Record<'draft' | 'scheduled' | 'sent', { title: string; subtitle: string }> = {
      draft: { title: 'No drafts yet', subtitle: 'Start writing your first newsletter and your draft will appear here.' },
      scheduled: { title: 'No scheduled newsletters', subtitle: 'Schedule a draft to send later and it will appear here until it goes out.' },
      sent: { title: 'No sent newsletters yet', subtitle: 'Send your first newsletter and engagement metrics will show up here.' },
    };
    const tab = this.statusTab();
    return tab === 'optout' ? copy.sent : copy[tab];
  });
  // Resolved once per browser session — SSR has no `Intl` zone to resolve, so
  // scheduled labels fall back to UTC there and are replaced on client hydration.
  protected readonly viewerTimezone: string = isPlatformBrowser(this.platformId) ? getUserTimezone() : 'UTC';

  // Pre-compute per-row labels so the template doesn't call functions-with-args.
  protected readonly rows: Signal<NewsletterRow[]> = this.initRows();

  public constructor() {
    const tabFromQuery = this.route.snapshot.queryParamMap.get('tab');
    // A `?tab=optout` deep link into a publication-scoped page must not select
    // the hidden tab — statusTabOptions() omits it there, and the load branch
    // below assumes optout only runs unscoped. Reads publicationId() (the
    // isUuid()-gated signal), not the raw :pubId param: a malformed segment
    // already makes the page behave unscoped everywhere else (statusTabOptions,
    // onStatusTabChange, the fetch guard), so this must agree rather than
    // independently treat any non-empty segment as "scoped" — that mismatch
    // would gate a deep-linked ?tab=optout shut while every other check on the
    // same malformed URL renders and permits it.
    const optoutAllowed = !this.publicationId();
    if (tabFromQuery === 'sent' || tabFromQuery === 'draft' || tabFromQuery === 'scheduled' || (tabFromQuery === 'optout' && optoutAllowed)) {
      this.statusTab.set(tabFromQuery);
    }
    this.initLoadOnContextOrTabAndPublication();
  }

  protected onStatusTabChange(tab: string): void {
    if (tab === 'draft' || tab === 'sent' || tab === 'scheduled' || (tab === 'optout' && !this.publicationId())) {
      this.statusTab.set(tab);
    }
  }

  // The composer sits at the flat `newsletters/create` path, so both the
  // publication being composed into AND the owning project have to travel
  // with the navigation rather than being inferred.
  //
  // publication: without it the new edition is created unfiled —
  // `publication_id` is optional upstream and there is no project default to
  // fall back to, so the edition would silently not belong to the
  // publication the user opened. Unfiled is a valid state (the weekly brief
  // creates editions that way), which is exactly why this has to be passed
  // explicitly rather than inferred.
  //
  // project: on the `:projectUid/:pubId/editions` mount, this.projectUid()
  // resolves from the route's own path segment (authoritative even beside a
  // stale active-context cookie) — a real UID, unlike every other producer
  // of ?project= in this app, which sends a slug. Carried on that standard
  // query param rather than a bespoke one: newsletterAccessGuard reads it
  // directly at the create leaf, and NewsletterManageComponent reads it
  // directly for its save payload too (both bypass depending on
  // projectQueryParamGuard, which runs on the newsletters parent mounts but
  // is skipped by Angular's default guard-reuse rules when only this leaf
  // changes and the parent mount's own path params don't) — see both call
  // sites' own comments for why. NewsletterManageComponent gates the value
  // with isUuid() first, so this UID is only ever used where a UID is
  // expected and a stray slug still falls through to its own slug-resolving
  // fallback; newsletterAccessGuard passes its ?project= source through
  // ungated, since getProject already resolves either a slug or a UID and
  // needs no gate to do so correctly. The composer's
  // displayName/logoUrl are resolved from projectUid() too (see
  // NewsletterManageComponent's resolvedProject), so they end up describing
  // the same project as the save target rather than lagging on activeContext.
  //
  // Only written when it actually diverges from activeContextUid(), via the
  // shared divergentProjectQueryParam (also used by NewsletterManageComponent
  // and NewsletterAnalyticsComponent for the same rule): a written pin
  // persists in the URL even after an in-page project switch
  // (ProjectContextService.syncProjectQueryParam rewrites ?project= via
  // location.replaceState, which bypasses the Router entirely, so a route
  // param read never sees it change) — on the lens-prefixed mounts a switch
  // navigates away from this 3-segment URL anyway, but the flat (me/org-
  // lens) mount has no such guard and would keep the create/list pages
  // pinned to a project the sidebar no longer shows as active. Omitting the
  // param in the common (non-divergent) case preserves the pre-existing
  // context-following behavior; it's written only in the one case that
  // needs it, and a switch away from that project is expected to require
  // leaving this page anyway.
  protected goToCreate(): void {
    const pubId = this.publicationId();
    this.router.navigate(['create'], {
      relativeTo: this.route.parent,
      queryParams: {
        ...(pubId ? { publication: pubId } : {}),
        ...divergentProjectQueryParam(this.projectUid(), this.projectContextService.activeContextUid()),
      },
    });
  }

  protected goToRow(item: NewsletterListItem): void {
    // A scheduled (or arming) row 409s on any edit upstream — open the preview
    // drawer instead of navigating, same treatment as a sent row.
    if (this.statusTab() === 'scheduled') {
      this.selectedNewsletter.set(item);
      this.previewVisible.set(true);
      return;
    }
    const target = this.statusTab() === 'sent' ? 'analytics' : 'edit';
    // Anchor to route.parent with the full path rather than ['..', ...]: this
    // component is mounted at both the flat 1-segment `list` route and the
    // 3-segment `:projectUid/:pubId/editions` route, and Angular's relative
    // navigation pops one URL segment per '..', not one Route match — so a
    // single '..' from the 3-segment mount would only remove 'editions',
    // landing on a URL nothing matches. route.parent is the shared
    // `newsletters` mount in both cases (see goBack in newsletter-analytics
    // and goToList in newsletter-manage for the same pattern). Carry the
    // newsletter's own project_uid in the URL instead of relying on ambient
    // context — see newsletters.routes.ts for the rationale.
    this.router.navigate([item.project_uid, item.id, target], { relativeTo: this.route.parent });
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
    const pubId = this.publicationId();
    const generation = this.loadGeneration;
    // Opt-out has no pagination — canLoadMore() never yields true for it, so
    // this is just the type guard that lets `status` narrow below.
    if (!token || this.loadingMore() || !uid || status === 'optout') return;
    this.loadingMore.set(true);
    this.newsletterService
      .listNewsletters(uid, { status, page_token: token, publication_id: pubId })
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
          // Same arming-row exclusion as the initial Sent-tab load — see initLoadOnContextOrTab.
          const newsletters = status === 'sent' ? response.newsletters.filter((n) => !(n.status === 'sending' && n.scheduled_at)) : response.newsletters;
          this.newsletters.update((current) => [...current, ...newsletters]);
          this.nextPageToken.set(response.next_page_token);
          this.loadOpenRates(newsletters);
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

  protected onCancelSchedule(item: NewsletterRow, event: Event): void {
    event.stopPropagation();
    const projectUid = this.projectUid();
    if (!projectUid) return;
    this.confirmationService.confirm({
      key: 'newsletter-list',
      header: 'Cancel schedule?',
      message: `This will cancel the "${item.subject || 'Untitled draft'}" schedule and return it to Drafts. Your picked time is kept, so you can re-schedule it later.`,
      icon: 'pi pi-times-circle',
      acceptLabel: 'Cancel schedule',
      rejectLabel: 'Keep scheduled',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.runCancelSchedule(projectUid, item),
    });
  }

  protected onRemoveOptOut(optOut: NewsletterOptOut, event: Event): void {
    event.stopPropagation();
    // Capture the project uid at dialog-open time: reading it on accept could
    // target a different project if the context switches while the dialog is open.
    const projectUid = this.projectUid();
    if (!projectUid) return;
    this.confirmationService.confirm({
      key: 'newsletter-list',
      header: 'Remove opt-out?',
      message: `Remove ${optOut.email} from the opt-out list? They will start receiving newsletters from this project again.`,
      icon: 'pi pi-trash',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.runRemoveOptOut(projectUid, optOut),
    });
  }

  private initRows(): Signal<NewsletterRow[]> {
    return computed(() => {
      const analyticsMap = this.openRateAnalytics();
      const pendingIds = this.openRatePendingIds();
      const timezone = this.viewerTimezone;
      // Arming rows lead the list — they're the newest schedule activity and
      // aren't part of the paginated response, so they'd otherwise land in an
      // arbitrary position relative to `next_page_token` pages.
      const items = [...this.armingNewsletters(), ...this.newsletters()];
      return items.map((n) => {
        const analytics = analyticsMap.get(n.id);
        const total = n.total_recipients ?? 0;
        const opens = n.unique_opens ?? analytics?.unique_opens ?? 0;
        const openRate = n.open_rate ?? analytics?.open_rate;
        const groupCount = n.committee_uids?.length ?? 0;
        const hasOpenRate = openRate !== undefined && openRate !== null;
        const openRateLabel = hasOpenRate ? `${Math.round(openRate * 100)}%` : '—';
        // Don't fabricate "0 of N opened" when analytics are missing or failed.
        const openRateTooltip = hasOpenRate ? `${opens} of ${total} recipients opened` : 'Analytics not available';
        const isArming = n.status === 'sending' && !!n.scheduled_at;
        let scheduledLabel = '';
        let scheduledTooltip = '';
        if (n.scheduled_at) {
          const scheduledDate = new Date(n.scheduled_at);
          const dateLabel = formatShortDateInTimezone(scheduledDate, timezone);
          const timeLabel = formatTo12HourInTimezone(scheduledDate, timezone);
          const offset = getTimezoneUtcOffsetString(timezone, scheduledDate);
          scheduledLabel = `${dateLabel}, ${timeLabel} (UTC${offset})`;
          scheduledTooltip = `${scheduledLabel} — ${formatFutureRelativeTime(scheduledDate)}`;
        }
        return {
          ...n,
          openRateLabel,
          openRatePending: pendingIds.has(n.id),
          openRateTooltip,
          openRateAria: hasOpenRate ? `Open rate ${openRateLabel}, ${openRateTooltip}` : 'Open rate not available',
          recipientsLabel: n.total_recipients !== undefined && n.total_recipients !== null ? String(n.total_recipients) : '—',
          groupsLabel: `${groupCount} ${groupCount === 1 ? 'group' : 'groups'}`,
          scheduledLabel,
          scheduledTooltip,
          isArming,
        };
      });
    });
  }

  // switchMap cancels the in-flight initial list request when the tab, project,
  // or publication changes, so a slow response can never clobber the newer tab's
  // rows or fan out analytics for rows that are no longer displayed. (loadMore
  // requests are not cancelled — loadMore guards its own response against context
  // changes instead.) Loading is cleared explicitly on every outcome path (empty
  // uid, error, next) rather than via finalize, so cancellation can never produce
  // a loading write regardless of operator teardown ordering.
  private initLoadOnContextOrTabAndPublication(): void {
    combineLatest([toObservable(this.projectUid), toObservable(this.statusTab), toObservable(this.publicationId)])
      .pipe(
        distinctUntilChanged(([prevUid, prevTab, prevPub], [uid, tab, pub]) => prevUid === uid && prevTab === tab && prevPub === pub),
        switchMap(([uid, status, pubId]) => {
          this.loadGeneration++;
          this.previewVisible.set(false);
          this.selectedNewsletter.set(null);
          this.nextPageToken.set(undefined);
          this.newsletters.set([]);
          this.armingNewsletters.set([]);
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
            // Opt-outs are project-wide — listOptOuts(uid) has no publication
            // scope. statusTabOptions() already hides the tab on a publication-
            // scoped page, and the tab-selection guards in the constructor and
            // onStatusTabChange keep `status` from becoming 'optout' there;
            // this is the belt-and-suspenders check on the actual fetch, so a
            // publication page can never read or mutate the project-wide list
            // even if a future caller sets statusTab directly.
            if (pubId) {
              this.loading.set(false);
              return EMPTY;
            }
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
          // `status=scheduled` alone misses arms still fanning out, and
          // `status=sent` matches both settled sends AND those same in-flight
          // arms (upstream's `sending` bucket covers both) — see the
          // list-filter trap in the plan. Handle both edge cases here so
          // neither tab shows or hides the wrong rows.
          if (status === 'scheduled') {
            return forkJoin({
              scheduled: this.newsletterService.listNewsletters(uid, { status: 'scheduled', publication_id: pubId }),
              sending: this.newsletterService.listNewsletters(uid, { status: 'sending', publication_id: pubId }),
            }).pipe(
              map(
                (results): NewsletterListLoadResult => ({
                  kind: 'newsletters',
                  response: results.scheduled,
                  arming: results.sending.newsletters.filter((n) => !!n.scheduled_at),
                })
              ),
              catchError((err: HttpErrorResponse) => {
                this.loading.set(false);
                this.showLoadError(err);
                return EMPTY;
              })
            );
          }
          return this.newsletterService.listNewsletters(uid, { status, publication_id: pubId }).pipe(
            map(
              (response): NewsletterListLoadResult => ({
                kind: 'newsletters',
                // A `sending` row carrying `scheduled_at` is an arm in progress, not
                // a send in progress — it belongs on the Scheduled tab, not here.
                response:
                  status === 'sent' ? { ...response, newsletters: response.newsletters.filter((n) => !(n.status === 'sending' && n.scheduled_at)) } : response,
              })
            ),
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
        this.armingNewsletters.set(result.arming ?? []);
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

  private runRemoveOptOut(projectUid: string, optOut: NewsletterOptOut): void {
    this.removingOptOutId.set(optOut.id);
    this.newsletterService
      .deleteOptOut(projectUid, optOut.id)
      .pipe(
        take(1),
        finalize(() => this.removingOptOutId.set(null))
      )
      .subscribe({
        next: () => {
          this.optOuts.update((current) => current.filter((o) => o.id !== optOut.id));
          this.messageService.add({ severity: 'success', summary: 'Opt-out removed', detail: `${optOut.email} will receive newsletters again.` });
        },
        error: (err: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Remove failed',
            detail: err?.error?.message || err?.message || 'Could not remove the opt-out. Please try again.',
          });
        },
      });
  }

  private runCancelSchedule(projectUid: string, item: NewsletterRow): void {
    this.cancelingScheduleId.set(item.id);
    this.newsletterService
      .cancelSchedule(projectUid, item.id, item.version)
      .pipe(
        take(1),
        finalize(() => this.cancelingScheduleId.set(null))
      )
      .subscribe({
        next: () => {
          this.newsletters.update((current) => current.filter((n) => n.id !== item.id));
          this.armingNewsletters.update((current) => current.filter((n) => n.id !== item.id));
          this.messageService.add({ severity: 'success', summary: 'Schedule cancelled', detail: 'The newsletter is back in Drafts.' });
        },
        error: (err: HttpErrorResponse) => this.handleCancelScheduleError(err, item.id),
      });
  }

  // A cancel racing the 5-minute settlement sweep fails `If-Match` (412) rather
  // than surfacing the upstream's 409 `already_sent` — the sweep bumps
  // `version` when it flips the row to `sent` before this request lands. Both
  // outcomes are the same real-world event from the viewer's perspective, so
  // they share one branch and one refresh; `cancel_window_closed` (too close
  // to send time to cancel) is a distinct, non-error outcome and keeps the row.
  private handleCancelScheduleError(err: HttpErrorResponse, id: string): void {
    const upstreamCode = err?.error?.upstreamCode;
    if (err.status === 409 && upstreamCode === 'cancel_window_closed') {
      this.messageService.add({
        severity: 'warn',
        summary: 'Too late to cancel',
        detail: 'Too close to the send time to cancel. This newsletter will go out as scheduled.',
        life: 8000,
      });
      return;
    }
    if ((err.status === 409 && upstreamCode === 'already_sent') || err.status === 412) {
      this.messageService.add({ severity: 'warn', summary: 'Already sent', detail: 'This newsletter has already been sent.' });
      this.newsletters.update((current) => current.filter((n) => n.id !== id));
      this.armingNewsletters.update((current) => current.filter((n) => n.id !== id));
      return;
    }
    this.messageService.add({
      severity: 'error',
      summary: 'Cancel failed',
      detail: extractErrorMessage(err, 'Could not cancel the schedule. Please try again.'),
      life: 8000,
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
