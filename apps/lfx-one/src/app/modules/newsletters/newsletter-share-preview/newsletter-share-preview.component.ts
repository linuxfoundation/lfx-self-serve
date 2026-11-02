// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { NEWSLETTER_SHARE_PREVIEW_FALLBACK_TITLE } from '@lfx-one/shared/constants';
import { NewsletterSharePreviewState } from '@lfx-one/shared/interfaces';
import { formatLfxDocumentTitle, newsletterIssuePath } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { catchError, map, of, startWith } from 'rxjs';

/**
 * Signed-out server render of a newsletter permalink (#4940), matched by
 * `newsletterAnonymousSsrMatchGuard`. Link-preview crawlers (LinkedIn, X) fetch the permalink without a
 * session; this page gives them Open Graph / Twitter tags whose title and description are the issue's
 * subject — what the email itself already shows — instead of the login page. Nothing else about the
 * issue is exposed: the endpoint returns the subject of a sent issue only, and an unknown or unsent
 * issue gets a neutral card. A person who opens the link in a browser never stays here: the browser
 * does not match the guard and the shell's `authGuard` sends them to sign in, then back to the issue.
 */
@Component({
  selector: 'lfx-newsletter-share-preview',
  templateUrl: './newsletter-share-preview.component.html',
})
export class NewsletterSharePreviewComponent {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly newsletterService = inject(NewsletterService);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);

  // === Route Params ===
  private readonly projectSlug = this.route.snapshot.paramMap.get('projectSlug') ?? '';
  private readonly newsletterId = this.route.snapshot.paramMap.get('id') ?? '';

  // === Complex Signals ===
  protected readonly state: Signal<NewsletterSharePreviewState> = this.initState();
  /** The subject when it may be shown, else the neutral fallback — used for both the title and the description. */
  protected readonly heading: Signal<string> = computed(() => this.state().preview?.subject?.trim() || NEWSLETTER_SHARE_PREVIEW_FALLBACK_TITLE);
  /** Plain sign-in link for a visitor without JavaScript; returns them to this issue. */
  protected readonly loginHref = `/login?returnTo=${encodeURIComponent(newsletterIssuePath(this.projectSlug, this.newsletterId))}`;

  // === Constructor ===
  public constructor() {
    // `toObservable` + `takeUntilDestroyed` rather than `effect()` (frontend-checklist §5), as on the public profile page.
    toObservable(this.state)
      .pipe(takeUntilDestroyed())
      .subscribe((state) => {
        if (!state.loading) this.applyMetadata();
      });
  }

  // === Private Initializers ===
  private initState(): Signal<NewsletterSharePreviewState> {
    const loading: NewsletterSharePreviewState = { loading: true, preview: null };
    if (!this.projectSlug || !this.newsletterId) {
      return computed(() => ({ loading: false, preview: null }));
    }
    return toSignal(
      this.newsletterService.getNewsletterSharePreview(this.projectSlug, this.newsletterId).pipe(
        map((preview): NewsletterSharePreviewState => ({ loading: false, preview })),
        // 404 (unknown or unsent) is the expected neutral-card path; anything else degrades the same way.
        catchError(() => of<NewsletterSharePreviewState>({ loading: false, preview: null })),
        startWith(loading)
      ),
      { initialValue: loading }
    );
  }

  // === Private Helpers ===
  private applyMetadata(): void {
    const heading = this.heading();
    this.title.setTitle(formatLfxDocumentTitle(heading));
    this.meta.updateTag({ name: 'description', content: heading });
    this.meta.updateTag({ property: 'og:title', content: heading });
    this.meta.updateTag({ property: 'og:description', content: heading });
    this.meta.updateTag({ property: 'og:type', content: 'article' });
    this.meta.updateTag({ property: 'og:site_name', content: 'LFX' });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: heading });
    this.meta.updateTag({ name: 'twitter:description', content: heading });
  }
}
