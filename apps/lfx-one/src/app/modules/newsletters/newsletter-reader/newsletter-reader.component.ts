// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NewsletterReaderState } from '@lfx-one/shared/interfaces';
import { toAbsoluteUrl } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectService } from '@services/project.service';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, filter, map, of, startWith, switchMap } from 'rxjs';

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
  imports: [NewsletterNotFoundComponent, NewsletterPreviewComponent, RouterLink, SkeletonModule],
  templateUrl: './newsletter-reader.component.html',
})
export class NewsletterReaderComponent {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectService = inject(ProjectService);
  private readonly newsletterService = inject(NewsletterService);
  private readonly clipboardShare = inject(ClipboardShareService);
  private readonly platformId = inject(PLATFORM_ID);

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
  protected readonly project = computed(() => this.state().project);
  protected readonly newsletter = computed(() => this.state().newsletter);

  // === Computed: draft hidden from non-manager ===
  protected readonly isDraftHidden = computed(() => {
    const { newsletter, project } = this.state();
    return !!newsletter && newsletter.status !== 'sent' && !!project && !project.writer;
  });

  // === Computed: 404 (unresolvable project/newsletter, or draft gated) ===
  protected readonly notFound = computed(() => {
    const { loading, project, newsletter } = this.state();
    return !loading && (!project || !newsletter || this.isDraftHidden());
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
    const path = `/newsletters/${slug}/${id}`;
    return toAbsoluteUrl(path, isPlatformBrowser(this.platformId));
  });

  // === Protected Methods ===
  protected copyLink(): void {
    const url = this.shareUrl();
    if (!url) return;

    this.clipboardShare.copyLink(url, 'Newsletter link copied to clipboard.');
  }

  protected onBackClick(): void {
    this.router.navigate(['/newsletters/my']);
  }

  // === Private Initializers ===
  private initState(): Signal<NewsletterReaderState> {
    return toSignal(
      combineLatest([toObservable(this.projectSlug), toObservable(this.newsletterId)]).pipe(
        filter((params): params is [string, string] => !!params[0] && !!params[1]),
        switchMap(([slug, id]) =>
          this.projectService.getProject(slug, false).pipe(
            switchMap((project) => {
              if (!project?.uid) {
                return of<NewsletterReaderState>({ loading: false, project: null, newsletter: null });
              }
              return this.newsletterService.getNewsletter(project.uid, id).pipe(
                map((newsletter): NewsletterReaderState => ({ loading: false, project, newsletter })),
                catchError(() => of<NewsletterReaderState>({ loading: false, project, newsletter: null }))
              );
            }),
            catchError(() => of<NewsletterReaderState>({ loading: false, project: null, newsletter: null })),
            // Reset to the skeleton on every param change: the component is
            // reused across permalink navigations (back/forward between
            // issues), so without this the previous issue stays on screen
            // until the new fetch resolves.
            startWith<NewsletterReaderState>({ loading: true, project: null, newsletter: null })
          )
        )
      ),
      { initialValue: { loading: true, project: null, newsletter: null } }
    );
  }
}
