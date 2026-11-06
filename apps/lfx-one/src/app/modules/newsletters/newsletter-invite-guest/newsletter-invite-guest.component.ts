// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, PLATFORM_ID, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { TranscendService } from '@app/shared/services/transcend.service';
import { UserService } from '@app/shared/services/user.service';
import { extractFieldOrEnvelopeMessage } from '@app/shared/utils/http-error.utils';
import { NEWSLETTER_INVITE_QUERY_PARAM, NEWSLETTER_INVITE_TOKEN_FRAGMENT_KEY } from '@lfx-one/shared/constants';
import { NewsletterGuestInviteInfo, NewsletterGuestPageState } from '@lfx-one/shared/interfaces';
import { formatLfxDocumentTitle } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';

import { NewsletterGuestModalComponent } from '../components/newsletter-guest-modal/newsletter-guest-modal.component';
import { NewsletterGuestReaderComponent } from '../components/newsletter-guest-reader/newsletter-guest-reader.component';

/**
 * `/newsletters/invite#token=…` (#5235) — where a newsletter invite or subscription-confirmation email
 * lands. Signed in, it hands over to the existing drill-down confirm card. Signed out, it shows the
 * guest modal with the invited address read-only and masked; Continue joins that address to the list, shows the
 * latest issue, and drops the token from the URL so a reload reads through the guest session.
 */
@Component({
  selector: 'lfx-newsletter-invite-guest',
  imports: [NewsletterGuestModalComponent, NewsletterGuestReaderComponent],
  templateUrl: './newsletter-invite-guest.component.html',
})
export class NewsletterInviteGuestComponent implements OnInit {
  // === Services ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly title = inject(Title);
  private readonly userService = inject(UserService);
  private readonly newsletterService = inject(NewsletterService);
  private readonly transcendService = inject(TranscendService);

  // === Writable Signals ===
  protected readonly state: WritableSignal<NewsletterGuestPageState> = signal({ status: 'loading' });
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal('');

  // === Computed Signals ===
  protected readonly invite: Signal<NewsletterGuestInviteInfo | null> = computed(() => this.state().invite ?? null);
  /** Expired, invalid or no-longer-member invites offer only Sign in. */
  protected readonly blocked: Signal<boolean> = computed(() => this.state().status === 'error' || this.invite()?.status !== 'valid');
  protected readonly modalError: Signal<string> = this.initModalError();
  protected readonly signInHref: Signal<string> = this.initSignInHref();

  // === Private fields ===
  private token = '';

  // === Lifecycle ===
  public ngOnInit(): void {
    this.title.setTitle(formatLfxDocumentTitle('Newsletter'));
    // The guest modal carries its own consent line; set on the server too so the prompt never flashes.
    this.transcendService.suppressPrompt();
    this.destroyRef.onDestroy(() => this.transcendService.restorePrompt());
    if (!isPlatformBrowser(this.platformId)) return;

    this.token = new URLSearchParams(this.route.snapshot.fragment ?? '').get(NEWSLETTER_INVITE_TOKEN_FRAGMENT_KEY) ?? '';
    if (!this.token) {
      this.loadSessionWithoutInvite();
      return;
    }

    this.newsletterService
      .inspectNewsletterGuestInvite(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (invite) => this.onInspected(invite),
        error: (error: unknown) => {
          console.error('Failed to check newsletter invite', error);
          this.state.set({ status: 'error' });
        },
      });
  }

  // === Protected Methods ===
  protected onContinue(): void {
    if (this.submitting() || this.blocked()) return;
    this.submitting.set(true);
    this.errorMessage.set('');
    this.newsletterService
      // A write: not cancelled on destroy (the service's take(1) completes it), so leaving the page cannot abort the add or email.
      .acceptNewsletterGuestInvite(this.token)
      .subscribe({
        next: (issue) => {
          this.submitting.set(false);
          this.state.set({ status: 'reading', invite: this.invite() ?? undefined, issue });
          // Drop the token from the address bar and history: a reload now reads through the guest session.
          void this.router.navigate([], { relativeTo: this.route, replaceUrl: true });
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.errorMessage.set(extractFieldOrEnvelopeMessage(error, "We couldn't open the newsletter. Please try again."));
        },
      });
  }

  // === Private Initializers ===
  private initModalError(): Signal<string> {
    return computed(() => {
      if (this.errorMessage()) return this.errorMessage();
      const { status, invite } = this.state();
      if (status === 'error') return "We couldn't load this invitation. Please try again, or sign in.";
      switch (invite?.status) {
        case 'expired':
        case 'invalid':
          return 'This invite link has expired or is invalid.';
        case 'not_eligible':
          return `This newsletter is a member benefit of ${invite.membership_name ?? invite.foundation?.name ?? 'its foundation'}, and we couldn't confirm your company is a member.`;
        default:
          return '';
      }
    });
  }

  private initSignInHref(): Signal<string> {
    return computed(() => {
      const invite = this.invite();
      const returnTo =
        invite?.foundation && invite.committee_uid
          ? `/newsletters/my/${encodeURIComponent(invite.foundation.slug)}?${NEWSLETTER_INVITE_QUERY_PARAM}=${encodeURIComponent(invite.committee_uid)}`
          : '/newsletters/my';
      return `/login?returnTo=${encodeURIComponent(returnTo)}`;
    });
  }

  // === Private Helpers ===
  private onInspected(invite: NewsletterGuestInviteInfo): void {
    // Signed in: the existing drill-down confirm card owns the invite.
    if (this.userService.authenticated()) {
      if (invite.foundation && invite.committee_uid) {
        void this.router.navigate(['/newsletters/my', invite.foundation.slug], {
          queryParams: { [NEWSLETTER_INVITE_QUERY_PARAM]: invite.committee_uid },
          replaceUrl: true,
        });
      } else {
        void this.router.navigate(['/newsletters/my'], { replaceUrl: true });
      }
      return;
    }

    // Always ask before accepting: the link may be a confirmation the reader has not used yet, even
    // when a guest session (from a shared-link read) is already open.
    this.state.set({ status: 'prompt', invite });
  }

  /** No token (a reload after Continue, or a lost fragment): an open guest session still reads; otherwise there is nothing to accept. */
  private loadSessionWithoutInvite(): void {
    if (this.userService.authenticated()) {
      void this.router.navigate(['/newsletters/my'], { replaceUrl: true });
      return;
    }
    this.newsletterService
      .getNewsletterGuestLatestIssue()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ issue }) => this.state.set(issue ? { status: 'reading', issue } : { status: 'prompt', invite: { status: 'invalid' } }),
        // The service already logged it; a failed read is not "invalid link", so show the retry copy.
        error: () => this.state.set({ status: 'error' }),
      });
  }
}
