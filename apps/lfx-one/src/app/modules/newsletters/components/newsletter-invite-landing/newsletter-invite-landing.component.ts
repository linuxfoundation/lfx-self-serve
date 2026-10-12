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
import { catchError, map, merge, of, startWith, Subject, switchMap } from 'rxjs';

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
  private readonly reload$ = new Subject<void>();

  // === Inputs ===
  public readonly committeeUid = input.required<string>();
  /** The drill-down's foundation slug — an invite for another foundation's group is invalid here. */
  public readonly foundationSlug = input.required<string>();

  // === Outputs ===
  /** The join POST succeeded (added, or already on the list): the page reloads its feed. */
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
    // Browser only. Re-check whenever the invite changes (`?invite=A` → `?invite=B` keeps this
    // instance) or the user asks to; switchMap drops a late reply for a superseded check.
    if (isPlatformBrowser(this.platformId)) {
      merge(toObservable(this.committeeUid), this.reload$)
        .pipe(
          map(() => this.committeeUid()),
          switchMap((committeeUid) =>
            this.newsletterService.getNewsletterGroupJoinStatus(committeeUid).pipe(
              map((join) => this.toLandingState(join)),
              catchError((error: unknown) => {
                console.error('[NewsletterInviteLanding] Failed to check the invite', error);
                // 404 `NEWSLETTER_INVITE_INVALID` (not a newsletter group any more) or 400 (malformed uid).
                const httpStatus = error instanceof HttpErrorResponse ? error.status : 0;
                return of<NewsletterInviteLandingState>({ status: httpStatus === 404 || httpStatus === 400 ? 'invalid' : 'error' });
              }),
              startWith<NewsletterInviteLandingState>({ status: 'loading' })
            )
          ),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((state) => this.state.set(state));
    }
  }

  // === Protected Methods ===
  protected loadStatus(): void {
    this.reload$.next();
  }

  protected onConfirm(): void {
    const join = this.join();
    if (!join || join.state !== 'eligible') return;

    this.state.set({ status: 'joining', join });
    this.newsletterService
      // A write: no takeUntilDestroyed — leaving the page mid-request must not abort the join
      // (the service's take(1) completes it).
      .joinNewsletterGroupByInvite(this.committeeUid())
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
  /** An invite for another foundation's group is invalid here; an existing membership needs no confirm (and no reload — the page already shows that feed). */
  private toLandingState(join: NewsletterGroupJoinStatus): NewsletterInviteLandingState {
    const slug = this.foundationSlug();
    if (join.foundation.slug !== slug && join.foundation.uid !== slug) {
      return { status: 'invalid' };
    }
    if (join.state === 'already_member') {
      return { status: 'already_member', join };
    }
    return { status: 'ready', join };
  }

  private errorCode(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return '';
    const code = (error.error as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? code : '';
  }
}
