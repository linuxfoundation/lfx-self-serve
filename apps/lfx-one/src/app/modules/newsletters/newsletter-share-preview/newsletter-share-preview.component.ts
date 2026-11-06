// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, PLATFORM_ID, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { extractErrorMessage } from '@app/shared/utils/http-error.utils';
import { NEWSLETTER_SHARE_PREVIEW_FALLBACK_TITLE } from '@lfx-one/shared/constants';
import { NewsletterGuestIssueResponse, NewsletterGuestPageState, NewsletterSharePreviewState } from '@lfx-one/shared/interfaces';
import { formatLfxDocumentTitle, newsletterIssuePath } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { catchError, map, of, startWith } from 'rxjs';

import { NewsletterGuestModalComponent } from '../components/newsletter-guest-modal/newsletter-guest-modal.component';
import { NewsletterGuestReaderComponent } from '../components/newsletter-guest-reader/newsletter-guest-reader.component';

/**
 * Signed-out newsletter permalink, matched by `newsletterAnonymousSsrMatchGuard`.
 *
 * - Server render (#4940): link-preview crawlers (LinkedIn, X) get Open Graph / Twitter tags whose title
 *   and description are the issue's subject — what the email itself already shows — instead of the login
 *   page. The preview endpoint returns the subject of a sent issue only; an unknown or unsent issue gets
 *   a neutral card. The page body is a placeholder article: nothing of the issue is rendered.
 * - Browser (#5235): a signed-out reader of a member-benefit issue gets the guest modal over that
 *   blurred placeholder. A work email at a member company reads the issue (and is emailed a link that
 *   subscribes it); a guest session already open for the issue's foundation skips the modal. An issue
 *   the member benefit does not open keeps the plain sign-in card.
 */
@Component({
  selector: 'lfx-newsletter-share-preview',
  imports: [NewsletterGuestModalComponent, NewsletterGuestReaderComponent],
  templateUrl: './newsletter-share-preview.component.html',
})
export class NewsletterSharePreviewComponent implements OnInit {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly newsletterService = inject(NewsletterService);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  // === Route Params ===
  private readonly projectSlug = this.route.snapshot.paramMap.get('projectSlug') ?? '';
  private readonly newsletterId = this.route.snapshot.paramMap.get('id') ?? '';

  // === Writable Signals ===
  /** Browser-only guest state; stays `loading` on the server, which renders the placeholder article. */
  protected readonly guest: WritableSignal<NewsletterGuestPageState> = signal({ status: 'loading' });
  protected readonly prompt = signal<NewsletterGuestIssueResponse | null>(null);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal('');

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

  // === Lifecycle ===
  public ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId) || !this.projectSlug || !this.newsletterId) return;
    this.newsletterService
      .getNewsletterGuestSharedIssue(this.projectSlug, this.newsletterId)
      .pipe(
        catchError((error: unknown) => {
          console.error('Failed to load newsletter guest access', error);
          return of<NewsletterGuestIssueResponse>({ issue: null });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        if (response.issue) {
          this.guest.set({ status: 'reading', issue: response.issue });
          return;
        }
        // No foundation: not an issue the member benefit opens (or the check failed) — keep the sign-in card.
        this.prompt.set(response);
        this.guest.set({ status: response.foundation ? 'prompt' : 'error' });
      });
  }

  // === Protected Methods ===
  protected onContinue(email: string): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.errorMessage.set('');
    this.newsletterService
      .requestNewsletterGuestAccess(this.projectSlug, this.newsletterId, email)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (issue) => {
          this.submitting.set(false);
          this.guest.set({ status: 'reading', issue });
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.errorMessage.set(this.continueErrorMessage(error));
        },
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
        catchError((error: unknown) => {
          // 404 (unknown or unsent issue) is the expected neutral-card path; anything else degrades the
          // same way, but is logged so an outage is not mistaken for "nothing to show".
          if ((error as { status?: number } | null)?.status !== 404) {
            console.error('Failed to load newsletter share preview', error);
          }
          return of<NewsletterSharePreviewState>({ loading: false, preview: null });
        }),
        startWith(loading)
      ),
      { initialValue: loading }
    );
  }

  // === Private Helpers ===
  /** Field-level validation messages first (e.g. "This newsletter is a member benefit of …"), then the envelope. */
  private continueErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const fieldMessage = (error.error as { errors?: { message?: string }[] } | null)?.errors?.[0]?.message;
      if (fieldMessage) return fieldMessage;
    }
    return extractErrorMessage(error, "We couldn't open the newsletter. Please try again.");
  }

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
