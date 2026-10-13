// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate, isPlatformBrowser, isPlatformServer } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, REQUEST_CONTEXT, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IMPERSONATION_READ_ONLY_ERROR_CODE, NEWSLETTER_NOT_SENT_ERROR_CODE } from '@lfx-one/shared/constants';
import { NewsletterJoinState, NewsletterReaderState, ServerRequestContext } from '@lfx-one/shared/interfaces';
import { newsletterIssuePath, toAbsoluteUrl } from '@lfx-one/shared/utils';
import { LensService } from '@services/lens.service';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectService } from '@services/project.service';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, distinctUntilChanged, filter, map, of, startWith, Subject, switchMap, tap } from 'rxjs';

import { NewsletterMemberBenefitBannerComponent } from './newsletter-member-benefit-banner/newsletter-member-benefit-banner.component';
import { NewsletterNotFoundComponent } from './newsletter-not-found/newsletter-not-found.component';
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
 * URL: slug-based (human-readable, not UID-based).
 */
@Component({
  selector: 'lfx-newsletter-reader',
  imports: [NewsletterMemberBenefitBannerComponent, NewsletterNotFoundComponent, NewsletterPreviewComponent, SkeletonModule],
  templateUrl: './newsletter-reader.component.html',
})
export class NewsletterReaderComponent {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lensService = inject(LensService);
  private readonly projectService = inject(ProjectService);
  private readonly newsletterService = inject(NewsletterService);
  private readonly clipboardShare = inject(ClipboardShareService);
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

  // === Computed: share URL (SSR-safe) ===
  protected readonly shareUrl = computed(() => {
    const slug = this.projectSlug();
    const id = this.newsletterId();
    if (!slug || !id) return null;
    return toAbsoluteUrl(newsletterIssuePath(slug, id), isPlatformBrowser(this.platformId));
  });

  // === Protected Methods ===
  protected copyLink(): void {
    const url = this.shareUrl();
    if (!url) return;

    this.clipboardShare.copyLink(url, 'Newsletter link copied to clipboard.');
  }

  protected retryJoin(): void {
    this.joinRetry$.next();
  }

  // The personal route restores Me; eager selection updates this tab immediately,
  // including when a modified click opens the feed in another tab.
  protected goToMyNewsletters(event: MouseEvent): void {
    // Persist the lens before branching for a new-tab/window click.
    this.lensService.setLens('me');

    // Let the browser honor the href for modified/non-primary clicks — same
    // guard as the docs-article anchor interception.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    void this.router.navigate(['/newsletters/my']);
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
}
