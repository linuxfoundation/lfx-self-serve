// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, output, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { IMPERSONATION_READ_ONLY_ERROR_CODE } from '@lfx-one/shared/constants';
import { NewsletterGroupJoinStatus, NewsletterInviteLandingState, NewsletterJoinState } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { SkeletonModule } from 'primeng/skeleton';

import { NewsletterMemberBenefitBannerComponent } from '../../newsletter-reader/newsletter-member-benefit-banner/newsletter-member-benefit-banner.component';

/**
 * Where a newsletter invite lands (#3483): the foundation drill-down with `?invite=<group uid>`.
 * Checks the signed-in user against the member-benefit rules on their own verified emails, then
 * asks them to confirm before they are added. Nothing is joined without the click.
 */
@Component({
  selector: 'lfx-newsletter-invite-landing',
  imports: [AvatarComponent, ButtonComponent, MessageComponent, NewsletterMemberBenefitBannerComponent, SkeletonModule],
  templateUrl: './newsletter-invite-landing.component.html',
})
export class NewsletterInviteLandingComponent {
  // === Services ===
  private readonly newsletterService = inject(NewsletterService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  public readonly committeeUid = input.required<string>();
  /** The drill-down's foundation slug — an invite for another foundation's group is invalid here. */
  public readonly foundationSlug = input.required<string>();

  // === Outputs ===
  /** The user was added (or already on the list): the page reloads its feed. */
  public readonly joined = output<void>();
  public readonly dismissed = output<void>();

  // === Writable Signals ===
  protected readonly state = signal<NewsletterInviteLandingState>({ status: 'loading' });

  // === Computed Signals ===
  protected readonly join: Signal<NewsletterGroupJoinStatus | null> = computed(() => this.state().join ?? null);
  protected readonly initial: Signal<string> = computed(() => (this.join()?.foundation.name ?? '').charAt(0).toUpperCase());
  protected readonly groupLabel: Signal<string> = computed(() => {
    const name = this.join()?.foundation.name;
    return name ? `the ${name} newsletter` : '';
  });
  /** Banner state for the outcomes the reader page already renders (added / already on the list / failed). */
  protected readonly bannerState: Signal<NewsletterJoinState | null> = this.initBannerState();

  // === Constructor ===
  public constructor() {
    // Browser only; re-check whenever the invite changes (`?invite=A` → `?invite=B` keeps this instance).
    if (isPlatformBrowser(this.platformId)) {
      toObservable(this.committeeUid)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.loadStatus());
    }
  }

  // === Protected Methods ===
  protected loadStatus(): void {
    this.state.set({ status: 'loading' });
    this.newsletterService
      .getNewsletterGroupJoinStatus(this.committeeUid())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (join) => {
          const slug = this.foundationSlug();
          if (join.foundation.slug !== slug && join.foundation.uid !== slug) {
            this.state.set({ status: 'invalid' });
            return;
          }
          if (join.state === 'already_member') {
            this.state.set({ status: 'already_member', join });
            this.joined.emit();
            return;
          }
          this.state.set({ status: 'ready', join });
        },
        error: (error: unknown) => {
          // 404 `NEWSLETTER_INVITE_INVALID` (not a newsletter group any more) or 400 (malformed uid).
          const httpStatus = error instanceof HttpErrorResponse ? error.status : 0;
          this.state.set({ status: httpStatus === 404 || httpStatus === 400 ? 'invalid' : 'error' });
        },
      });
  }

  protected onConfirm(): void {
    const join = this.join();
    if (!join || join.state !== 'eligible') return;

    this.state.set({ status: 'joining', join });
    this.newsletterService
      .joinNewsletterGroupByInvite(this.committeeUid())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.state.set({ status: result.status, join, result });
          this.joined.emit();
        },
        error: (error: unknown) => {
          // Impersonation is read-only by design — say nothing rather than a misleading failure.
          if (this.errorCode(error) === IMPERSONATION_READ_ONLY_ERROR_CODE) {
            this.state.set({ status: 'ready', join });
            return;
          }
          this.state.set({ status: 'failed', join });
        },
      });
  }

  protected onDismiss(): void {
    this.dismissed.emit();
  }

  // === Private Initializers ===
  private initBannerState(): Signal<NewsletterJoinState | null> {
    return computed(() => {
      const { status, result } = this.state();
      if (status === 'joining' || status === 'added' || status === 'already_member' || status === 'failed') {
        return { status, result };
      }
      return null;
    });
  }

  // === Private Helpers ===
  private errorCode(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return '';
    const code = (error.error as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? code : '';
  }
}
