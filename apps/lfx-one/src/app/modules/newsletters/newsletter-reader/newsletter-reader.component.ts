// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Project } from '@lfx-one/shared/interfaces';
import { toAbsoluteUrl } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectService } from '@services/project.service';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, finalize, filter, map, of, switchMap } from 'rxjs';

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

  // === WritableSignals ===
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);

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
  protected readonly project: Signal<Project | null> = this.initProject();
  protected readonly newsletter: Signal<{ id: string; subject: string; body_html: string; status: string; sent_at?: string } | null> = this.initNewsletter();

  // === Computed: draft hidden from non-manager ===
  protected readonly isDraftHidden = computed(() => {
    const nl = this.newsletter();
    const proj = this.project();
    return nl && nl.status !== 'sent' && proj && !proj.writer;
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
  private initProject(): Signal<Project | null> {
    return toSignal(
      toObservable(this.projectSlug).pipe(
        filter((slug): slug is string => !!slug),
        switchMap((slug) => this.projectService.getProject(slug, false).pipe(catchError(() => of(null))))
      ),
      { initialValue: null }
    );
  }

  private initNewsletter(): Signal<{ id: string; subject: string; body_html: string; status: string; sent_at?: string } | null> {
    return toSignal(
      combineLatest([toObservable(this.project), toObservable(this.newsletterId).pipe(filter((id) => !!id))]).pipe(
        switchMap(([project, id]) => {
          if (!project?.uid || !id) return of(null);
          return this.newsletterService.getNewsletter(project.uid, id).pipe(catchError(() => of(null)));
        }),
        finalize(() => {
          // If draft is hidden from this user, or resources couldn't be loaded, render 404.
          if (this.isDraftHidden() || (!this.project() && this.projectSlug()) || (!this.newsletter() && this.newsletterId() && this.project())) {
            this.notFound.set(true);
          }
          this.loading.set(false);
        })
      ),
      { initialValue: null }
    );
  }
}
