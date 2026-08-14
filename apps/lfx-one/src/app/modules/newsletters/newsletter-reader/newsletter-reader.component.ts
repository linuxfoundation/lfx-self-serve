// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate, isPlatformBrowser, isPlatformServer } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, REQUEST_CONTEXT, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { NewsletterReaderState, ServerRequestContext } from '@lfx-one/shared/interfaces';
import { newsletterIssuePath, toAbsoluteUrl } from '@lfx-one/shared/utils';
import { LensService } from '@services/lens.service';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectService } from '@services/project.service';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, filter, map, of, startWith, switchMap, tap } from 'rxjs';

import { NewsletterNotFoundComponent } from './newsletter-not-found/newsletter-not-found.component';
import { NewsletterPreviewComponent } from '../components/newsletter-preview/newsletter-preview.component';

/**
 * Standalone reader page for shareable newsletter permalinks.
 * Route: /newsletters/:projectSlug/:id
 *
 * Access: authGuard only (any authenticated user).
 * Draft gating: non-managers see 404 for unsent newsletters.
 * URL: slug-based (human-readable, not UID-based).
 */
@Component({
  selector: 'lfx-newsletter-reader',
  imports: [NewsletterNotFoundComponent, NewsletterPreviewComponent, SkeletonModule],
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
  /** Single load-state stream: loading, project/newsletter resolution, and failures all derive from one emission. */
  protected readonly state: Signal<NewsletterReaderState> = this.initState();

  // === Computed: state projections ===
  protected readonly loading = computed(() => this.state().loading);
  protected readonly error = computed(() => this.state().error);
  protected readonly project = computed(() => this.state().project);
  protected readonly newsletter = computed(() => this.state().newsletter);

  // === Computed: draft hidden from non-manager ===
  protected readonly isDraftHidden = computed(() => {
    const { newsletter, project } = this.state();
    return !!newsletter && newsletter.status !== 'sent' && !!project && !project.writer;
  });

  // === Computed: 404 (unresolvable project/newsletter, or draft gated) ===
  protected readonly notFound = computed(() => {
    const { loading, error, project, newsletter } = this.state();
    return !loading && !error && (!project || !newsletter || this.isDraftHidden());
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

  // The feed is a Me-lens page: with a foundation/project lens active, a plain
  // routerLink to /newsletters/my gets rewritten by lensRedirectGuard to the
  // lens-prefixed mount, whose newsletterAccessGuard bounces non-writers to the
  // overview. Switching to the always-allowed 'me' lens first keeps the
  // permalink audience (any authenticated user) able to reach their feed.
  protected goToMyNewsletters(event: MouseEvent): void {
    // Persist the lens before branching: setLens writes the lens cookie, so a
    // browser-handled modified click (new tab/window) also lands on the feed.
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
                return of<NewsletterReaderState>({ loading: false, error: false, project: null, newsletter: null });
              }
              return this.newsletterService.getNewsletter(project.uid, id).pipe(
                map((newsletter): NewsletterReaderState => ({ loading: false, error: false, project, newsletter })),
                catchError((err) => {
                  // 400/404 is the expected "no such newsletter" path; anything
                  // else (gateway 5xx, network) is a transient failure and must
                  // not masquerade as a permanent 404.
                  const status = err?.status;
                  if (typeof status === 'number' && [400, 404].includes(status)) {
                    return of<NewsletterReaderState>({ loading: false, error: false, project, newsletter: null });
                  }
                  console.error('Failed to load newsletter', err);
                  return of<NewsletterReaderState>({ loading: false, error: true, project, newsletter: null });
                })
              );
            }),
            // Only sees project-fetch errors — the newsletter fetch handles its
            // own above. 400/404 = no such slug (not-found); anything else is
            // transient and must not render (or SSR-return) as a 404.
            catchError((err) => {
              const status = err?.status;
              if (typeof status === 'number' && [400, 404].includes(status)) {
                return of<NewsletterReaderState>({ loading: false, error: false, project: null, newsletter: null });
              }
              console.error('Failed to load project for newsletter reader', err);
              return of<NewsletterReaderState>({ loading: false, error: true, project: null, newsletter: null });
            }),
            // Emit a real HTTP 404 during SSR for the not-found branches (missing
            // project/newsletter or draft gated) — same in-place pattern as
            // not-found.component.ts. Error states intentionally stay 200-family.
            tap((state) => {
              if (isPlatformServer(this.platformId) && this.reqContext && !state.loading && !state.error) {
                const draftHidden = !!state.newsletter && state.newsletter.status !== 'sent' && !!state.project && !state.project.writer;
                if (!state.project || !state.newsletter || draftHidden) {
                  this.reqContext.notFound = true;
                }
              }
            }),
            // Reset to the skeleton on every param change: the component is
            // reused across permalink navigations (back/forward between
            // issues), so without this the previous issue stays on screen
            // until the new fetch resolves.
            startWith<NewsletterReaderState>({ loading: true, error: false, project: null, newsletter: null })
          )
        )
      ),
      { initialValue: { loading: true, error: false, project: null, newsletter: null } }
    );
  }
}
