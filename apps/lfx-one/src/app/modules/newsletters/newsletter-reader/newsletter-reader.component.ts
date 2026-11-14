// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate, isPlatformBrowser, isPlatformServer } from '@angular/common';
import { Component, computed, inject, linkedSignal, PLATFORM_ID, REQUEST_CONTEXT, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { IMPERSONATION_READ_ONLY_ERROR_CODE, NEWSLETTER_INVITE_RELOOKUP_DELAY_MS, NEWSLETTER_NOT_SENT_ERROR_CODE } from '@lfx-one/shared/constants';
import {
  MyNewsletterFoundation,
  MyNewsletterFoundationsResponse,
  NewsletterInviteDialogData,
  NewsletterInviteLookup,
  NewsletterReaderCrumb,
  NewsletterJoinState,
  NewsletterReaderState,
  NewsletterShareEvent,
  NewsletterShareTally,
  NewsletterShareTarget,
  ServerRequestContext,
} from '@lfx-one/shared/interfaces';
import { addShareToTally, combinedViewCount, newsletterIssuePath, toAbsoluteUrl } from '@lfx-one/shared/utils';
import { LensService } from '@services/lens.service';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectService } from '@services/project.service';
import { ShareDialogService } from '@services/share-dialog.service';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, defer, distinctUntilChanged, filter, map, of, startWith, Subject, switchMap, tap, timer } from 'rxjs';

import { NewsletterMemberBenefitBannerComponent } from './newsletter-member-benefit-banner/newsletter-member-benefit-banner.component';
import { NewsletterNotFoundComponent } from './newsletter-not-found/newsletter-not-found.component';
import { NewsletterInviteDialogComponent } from '../components/newsletter-invite-dialog/newsletter-invite-dialog.component';
import { NewsletterEngagementRailComponent } from '../components/newsletter-engagement-rail/newsletter-engagement-rail.component';
import { NewsletterPreviewComponent } from '../components/newsletter-preview/newsletter-preview.component';

/**
 * Standalone reader page for shareable newsletter permalinks.
 * Route: /newsletters/:projectSlug/:id
 *
 * Access is decided server-side (GET /api/newsletters/:projectUid/:id/reader, #3469):
 * project managers (drafts included), members of the issue's group, and employees of Linux
 * Foundation member companies read the issue; everyone else gets a members-only screen. A member
 * employee who is not yet in the group is added automatically — the join call fires once, in the
 * browser only, so SSR never writes.
 * Readers allowed to invite coworkers to the issue's foundation newsletter (the same `can_invite`
 * the My Newsletters cards use) get an "Invite a colleague" button; the lookup is browser-only too.
 * URL: slug-based (human-readable, not UID-based).
 */
@Component({
  selector: 'lfx-newsletter-reader',
  imports: [
    ButtonComponent,
    NewsletterEngagementRailComponent,
    NewsletterMemberBenefitBannerComponent,
    NewsletterNotFoundComponent,
    NewsletterPreviewComponent,
    SkeletonModule,
  ],
  providers: [DialogService],
  templateUrl: './newsletter-reader.component.html',
})
export class NewsletterReaderComponent {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lensService = inject(LensService);
  private readonly projectService = inject(ProjectService);
  private readonly newsletterService = inject(NewsletterService);
  private readonly shareDialog = inject(ShareDialogService);
  private readonly dialogService = inject(DialogService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly reqContext = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;

  /** Re-runs the member-benefit join after a failure. */
  private readonly joinRetry$ = new Subject<void>();

  // === Route Params (toSignal) ===
  protected readonly projectSlug: Signal<string | null> = toSignal(this.route.paramMap.pipe(map((m) => m.get('projectSlug'))), {
    initialValue: null,
  });
  protected readonly newsletterId: Signal<string | null> = toSignal(this.route.paramMap.pipe(map((m) => m.get('id'))), {
    initialValue: null,
  });

  // === Computed: params valid ===
  protected readonly paramsValid = computed(() => !!this.projectSlug() && !!this.newsletterId());

  // === Data Signals (Complex — init via private functions) ===
  /** Single load-state stream: loading, project/newsletter resolution, access, and failures all derive from one emission. */
  protected readonly state: Signal<NewsletterReaderState> = this.initState();
  /** Automatic member-benefit group add, driven by an `eligible` access decision. */
  protected readonly joinState: Signal<NewsletterJoinState> = this.initJoinState();
  /**
   * The issue's foundation card from My Newsletters (null until resolved, on SSR, or on failure). Drives the
   * invite CTA and the breadcrumb's link back to that foundation's list (`/newsletters/my/:slug`, #4979).
   */
  protected readonly issueFoundation: Signal<MyNewsletterFoundation | null> = this.initIssueFoundation();
  protected readonly canInvite = computed(() => !!this.issueFoundation()?.can_invite);
  /**
   * Breadcrumb middle crumb (#4979): the issue's foundation, linking to its newsletter list. Until the
   * foundation resolves — or when the reader doesn't receive it — the project, linking to the cards.
   */
  protected readonly foundationCrumb: Signal<NewsletterReaderCrumb> = computed(() => {
    const foundation = this.issueFoundation();
    if (foundation?.slug) {
      return { label: foundation.name, href: `/newsletters/my/${encodeURIComponent(foundation.slug)}`, commands: ['/newsletters/my', foundation.slug] };
    }
    return { label: this.pageTitle(), href: '/newsletters/my', commands: ['/newsletters/my'] };
  });

  // === Computed: state projections ===
  protected readonly loading = computed(() => this.state().loading);
  protected readonly error = computed(() => this.state().error);
  protected readonly project = computed(() => this.state().project);
  protected readonly newsletter = computed(() => this.state().newsletter);
  protected readonly access = computed(() => this.state().access);
  protected readonly isDraftHidden = computed(() => !!this.state().draftHidden);

  // === Computed: members-only (signed in, but neither manager, group member nor member employee) ===
  protected readonly membersOnly = computed(() => !this.loading() && !this.error() && this.access()?.access === 'denied');

  // === Computed: 404 (unresolvable project/newsletter; drafts 404 server-side for non-managers) ===
  protected readonly notFound = computed(() => {
    const { loading, error, project, newsletter } = this.state();
    return !loading && !error && !this.membersOnly() && (!project || !newsletter);
  });

  // === Computed: page display strings ===
  protected readonly pageTitle = computed(() => this.project()?.name || 'Newsletter');
  protected readonly pageSubtitle = computed(() => {
    const nl = this.newsletter();
    return nl?.sent_at ? `Received ${formatDate(nl.sent_at, 'MMM d, y', 'en-US')}` : '';
  });

  // === Computed: views (email opens + unique web page views; null when both are unknown so the rail hides it) ===
  protected readonly viewCount = computed(() => combinedViewCount(this.newsletter()?.total_opens, this.newsletter()?.page_view_count));

  // === Computed: share URL (SSR-safe) ===
  protected readonly shareUrl = computed(() => {
    const slug = this.projectSlug();
    const id = this.newsletterId();
    if (!slug || !id) return null;
    return toAbsoluteUrl(newsletterIssuePath(slug, id), isPlatformBrowser(this.platformId));
  });

  // === Writable Signals (linked) ===
  /** Share count on the engagement rail's Share button: the server's `share_count`, bumped after each accepted share. Resets per issue. */
  protected readonly shareTally = linkedSignal<NewsletterShareTally>(() => ({ count: this.newsletter()?.share_count ?? null, channels: [] }));

  public constructor() {
    this.initPageViewTracking();
  }

  // === Protected Methods ===
  protected openShare(): void {
    const url = this.shareUrl();
    const project = this.project();
    const newsletter = this.newsletter();
    if (!url) return;

    // Bind the share to the issue the dialog opened for: Back/Forward can show another issue while it is open.
    const target: NewsletterShareTarget | null = project && newsletter ? { projectUid: project.uid, newsletterId: newsletter.id } : null;
    this.shareDialog.open({
      url,
      title: newsletter?.subject || this.pageTitle(),
      copiedMessage: 'Newsletter link copied to clipboard.',
      onShare: (channel) => {
        if (target) this.onShared({ ...target, channel });
      },
    });
  }

  protected onInvite(): void {
    const foundation = this.issueFoundation();
    if (!foundation?.can_invite) return;
    this.dialogService.open(NewsletterInviteDialogComponent, {
      header: 'Invite a colleague',
      width: '480px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { foundation } satisfies NewsletterInviteDialogData,
    });
  }

  /**
   * Records the share and, once the server accepts it, bumps the visible count if that issue is still shown.
   * Not tied to the component's lifetime: leaving the page must not abort the write. `recordShare`
   * completes after one emission, so nothing leaks, and the id check keeps a late result off another issue.
   */
  protected onShared(event: NewsletterShareEvent): void {
    this.newsletterService.recordShare(event.projectUid, event.newsletterId, event.channel).subscribe((accepted) => {
      if (accepted && this.newsletter()?.id === event.newsletterId) {
        this.shareTally.update((tally) => addShareToTally(tally, event.channel));
      }
    });
  }

  protected retryJoin(): void {
    this.joinRetry$.next();
  }

  // The personal routes restore Me; eager selection updates this tab immediately,
  // including when a modified click opens the feed in another tab. Serves both
  // breadcrumb links: the foundation cards (default) and one foundation's list.
  protected goToMyNewsletters(event: MouseEvent, commands: string[] = ['/newsletters/my']): void {
    // Persist the lens before branching for a new-tab/window click.
    this.lensService.setLens('me');

    // Let the browser honor the href for modified/non-primary clicks — same
    // guard as the docs-article anchor interception.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    void this.router.navigate(commands);
  }

  // === Private Initializers ===
  private initState(): Signal<NewsletterReaderState> {
    const loadingState: NewsletterReaderState = { loading: true, error: false, project: null, newsletter: null, access: null };
    return toSignal(
      combineLatest([toObservable(this.projectSlug), toObservable(this.newsletterId)]).pipe(
        filter((params): params is [string, string] => !!params[0] && !!params[1]),
        switchMap(([slug, id]) =>
          // Strict slug lookup: propagates HTTP failures so a project-service
          // outage surfaces as the error state (HTTP 200) rather than being
          // conflated with a bad slug and emitted as a real SSR 404.
          this.projectService.getProjectStrict(slug).pipe(
            switchMap((project) => {
              if (!project?.uid) {
                return of<NewsletterReaderState>({ loading: false, error: false, project: null, newsletter: null, access: null });
              }
              return this.newsletterService.getReaderAccess(project.uid, id).pipe(
                map((access): NewsletterReaderState => ({ loading: false, error: false, project, newsletter: access.newsletter ?? null, access })),
                catchError((err) => {
                  // 400/404 is the expected "no such newsletter" path (drafts
                  // 404 for non-managers too); anything else (gateway 5xx,
                  // network) is a transient failure and must not masquerade as
                  // a permanent 404.
                  const status = err?.status;
                  if (typeof status === 'number' && [400, 404].includes(status)) {
                    const draftHidden = err?.error?.code === NEWSLETTER_NOT_SENT_ERROR_CODE;
                    return of<NewsletterReaderState>({ loading: false, error: false, project, newsletter: null, access: null, draftHidden });
                  }
                  console.error('Failed to load newsletter', err);
                  return of<NewsletterReaderState>({ loading: false, error: true, project, newsletter: null, access: null });
                })
              );
            }),
            // Only sees project-fetch errors — the newsletter fetch handles its
            // own above. 400/404 = no such slug (not-found); anything else is
            // transient and must not render (or SSR-return) as a 404.
            catchError((err) => {
              const status = err?.status;
              if (typeof status === 'number' && [400, 404].includes(status)) {
                return of<NewsletterReaderState>({ loading: false, error: false, project: null, newsletter: null, access: null });
              }
              console.error('Failed to load project for newsletter reader', err);
              return of<NewsletterReaderState>({ loading: false, error: true, project: null, newsletter: null, access: null });
            }),
            // Emit a real HTTP 404 during SSR for the not-found branches
            // (missing project/newsletter) — same in-place pattern as
            // not-found.component.ts. Error and members-only states
            // intentionally stay 200-family.
            tap((state) => {
              if (isPlatformServer(this.platformId) && this.reqContext && !state.loading && !state.error && state.access?.access !== 'denied') {
                if (!state.project || !state.newsletter) {
                  this.reqContext.notFound = true;
                }
              }
            }),
            // Reset to the skeleton on every param change: the component is
            // reused across permalink navigations (back/forward between
            // issues), so without this the previous issue stays on screen
            // until the new fetch resolves.
            startWith<NewsletterReaderState>(loadingState)
          )
        )
      ),
      { initialValue: loadingState }
    );
  }

  /**
   * Records one unique web page view per readable, sent issue shown. Browser-only, so SSR never writes,
   * and once per issue: `distinctUntilChanged` collapses the repeated state emissions of one load, and the
   * server counts each user once per issue, ever, so a refresh is a no-op upstream. Denied readers and
   * drafts are skipped. Each POST is subscribed on its own so leaving the page doesn't abort it; the
   * on-screen count is not bumped, so reloads can't inflate what the reader sees.
   */
  private initPageViewTracking(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    toObservable(this.state)
      .pipe(
        map(({ project, newsletter, access }) =>
          project && newsletter && newsletter.status === 'sent' && access && access.access !== 'denied' ? `${project.uid}/${newsletter.id}` : null
        ),
        distinctUntilChanged(),
        filter((target): target is string => target !== null),
        takeUntilDestroyed()
      )
      .subscribe((target) => {
        const [projectUid, newsletterId] = target.split('/');
        this.newsletterService.recordPageView(projectUid, newsletterId).subscribe();
      });
  }

  private initJoinState(): Signal<NewsletterJoinState> {
    const idle: NewsletterJoinState = { status: 'idle' };
    return toSignal(
      toObservable(this.state).pipe(
        // Never write during SSR: the add happens once the page is live in the browser.
        filter(() => isPlatformBrowser(this.platformId)),
        map((state) => (state.access?.access === 'eligible' && state.project && state.newsletter ? `${state.project.uid}/${state.newsletter.id}` : null)),
        distinctUntilChanged(),
        switchMap((target) => {
          if (!target) return of(idle);
          const [projectUid, newsletterId] = target.split('/');
          return this.joinRetry$.pipe(
            startWith(undefined),
            switchMap(() =>
              this.newsletterService.joinNewsletterGroup(projectUid, newsletterId).pipe(
                map((result): NewsletterJoinState => ({ status: result.status, result })),
                catchError((err) => {
                  // An admin impersonating a member cannot write on their behalf; that is not a
                  // failure the reader can retry, so show no banner at all.
                  if (err?.error?.code === IMPERSONATION_READ_ONLY_ERROR_CODE) {
                    return of(idle);
                  }
                  console.error('Failed to add reader to newsletter group', err);
                  return of<NewsletterJoinState>({ status: 'failed' });
                }),
                startWith<NewsletterJoinState>({ status: 'joining' })
              )
            )
          );
        })
      ),
      { initialValue: idle }
    );
  }

  /**
   * Looks up the issue's foundation in GET /api/newsletters/my-foundations once a readable issue has
   * loaded, and again after the member-benefit join adds the reader to the group (they may now be
   * able to invite). That second lookup waits {@link NEWSLETTER_INVITE_RELOOKUP_DELAY_MS}: the
   * endpoint reads memberships from the query-service index, which picks up the join asynchronously.
   * Browser-only; a failure just hides the CTA — the invite POST re-checks everything — and points the
   * breadcrumb's middle crumb at the foundation cards instead of one foundation's list.
   */
  private initIssueFoundation(): Signal<MyNewsletterFoundation | null> {
    const lookup = computed<NewsletterInviteLookup | null>(
      () => {
        const { loading, error, project, newsletter, access } = this.state();
        if (loading || error || !project || !newsletter || !access || access.access === 'denied') return null;
        const joinStatus = this.joinState().status;
        return { projectUid: project.uid, newsletterId: newsletter.id, joined: joinStatus === 'added' || joinStatus === 'already_member' };
      },
      { equal: (a, b) => a?.projectUid === b?.projectUid && a?.newsletterId === b?.newsletterId && a?.joined === b?.joined }
    );
    return toSignal(
      toObservable(lookup).pipe(
        filter(() => isPlatformBrowser(this.platformId)),
        switchMap((target) => {
          if (!target) return of(null);
          const fetch$ = defer(() => this.newsletterService.getMyNewsletterFoundations()).pipe(
            map((response) => this.findIssueFoundation(response, target)),
            // NewsletterService already logs the failure; here it only hides an optional button.
            catchError(() => of(null))
          );
          return target.joined ? timer(NEWSLETTER_INVITE_RELOOKUP_DELAY_MS).pipe(switchMap(() => fetch$)) : fetch$;
        })
      ),
      { initialValue: null }
    );
  }

  /**
   * The issue's foundation card, keyed the way the server grouped the feed: the issue's own row, else
   * any row from the same project (both carry the server-resolved `foundation_uid`), else the project's
   * own card. Never guesses a parent — the server only maps a project to its parent when that parent
   * is a foundation, and a wrong guess would invite to another newsletter group.
   */
  private findIssueFoundation(response: MyNewsletterFoundationsResponse, target: NewsletterInviteLookup): MyNewsletterFoundation | null {
    const row =
      response.newsletters.find((entry) => entry.id === target.newsletterId) ?? response.newsletters.find((entry) => entry.project_uid === target.projectUid);
    const foundationUid = row ? (row.foundation_uid ?? row.project_uid) : target.projectUid;
    return response.foundations.find((entry) => entry.uid === foundationUid) ?? null;
  }
}
