// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { NEWSLETTER_COMMITTEE_CATEGORY } from '@lfx-one/shared/constants';
import { Committee, NewsletterSignupLink } from '@lfx-one/shared/interfaces';
import { newsletterSignupPath, toAbsoluteUrl } from '@lfx-one/shared/utils';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { CommitteeService } from '@services/committee.service';
import { NewsletterService } from '@services/newsletter.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';

/**
 * Lists the active project's Newsletter groups with a copyable public signup link for each.
 * Opened via `DialogService.open()` with `{ projectUid, projectSlug }` as dialog data.
 */
@Component({
  selector: 'lfx-newsletter-signup-links-dialog',
  imports: [ButtonComponent, SkeletonModule],
  templateUrl: './newsletter-signup-links-dialog.component.html',
})
export class NewsletterSignupLinksDialogComponent {
  public static readonly headingId = 'newsletter-signup-links-dialog-title';

  // === Services ===
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly committeeService = inject(CommitteeService);
  private readonly newsletterService = inject(NewsletterService);
  private readonly clipboardShare = inject(ClipboardShareService);
  private readonly platformId = inject(PLATFORM_ID);

  // === Dialog data ===
  private readonly projectUid: string = this.dialogConfig.data?.projectUid ?? '';
  private readonly projectSlug: string = this.dialogConfig.data?.projectSlug ?? '';

  // === Computed Signals ===
  // `null` while loading; `'error'` when the group list could not be fetched.
  protected readonly links: Signal<NewsletterSignupLink[] | 'error' | null> = this.initLinks();
  protected readonly headingId = NewsletterSignupLinksDialogComponent.headingId;

  // === Protected Methods ===
  protected copy(link: NewsletterSignupLink): void {
    this.clipboardShare.copyLink(link.url, 'Signup link copied to clipboard.');
  }

  protected close(): void {
    this.dialogRef.close();
  }

  // === Private Initializers ===
  private initLinks(): Signal<NewsletterSignupLink[] | 'error' | null> {
    const isBrowser = isPlatformBrowser(this.platformId);
    return toSignal(
      this.committeeService.getCommitteesByProjectOrThrow(this.projectUid).pipe(
        map((committees) => committees.filter((committee) => committee.category === NEWSLETTER_COMMITTEE_CATEGORY)),
        // Ask the signup endpoint itself whether each group accepts signups: it applies the exact
        // server rule, including `business_email_required`, which the committee list doesn't carry.
        switchMap((groups) =>
          groups.length === 0
            ? of<[Committee, boolean | null][]>([])
            : forkJoin(
                groups.map((group) =>
                  this.newsletterService.getPublicSignupInfo(this.projectSlug, group.uid).pipe(
                    map((info): [Committee, boolean | null] => [group, info.accepting_signups]),
                    // Unknown — fall back to what the list response can tell us.
                    catchError(() => of<[Committee, boolean | null]>([group, null]))
                  )
                )
              )
        ),
        map((rows) =>
          rows
            .map(
              ([committee, serverAccepting]): NewsletterSignupLink => ({
                groupUid: committee.uid,
                groupName: committee.display_name || committee.name,
                url: toAbsoluteUrl(newsletterSignupPath(this.projectSlug, committee.uid), isBrowser),
                ...this.signupAvailability(committee, serverAccepting),
              })
            )
            .sort((a, b) => a.groupName.localeCompare(b.groupName, 'en'))
        ),
        catchError((error: unknown) => {
          console.error('Failed to load Newsletter groups for signup links', error);
          return of('error' as const);
        })
      ),
      { initialValue: null }
    );
  }

  // === Private Helpers ===
  /**
   * `serverAccepting` is the signup endpoint's verdict (`null` when it couldn't be read). The list
   * response explains the join-mode and voting cases; a refusal it can't explain is the
   * business-email setting, which only the settings sub-resource carries.
   */
  private signupAvailability(committee: Committee, serverAccepting: boolean | null): Pick<NewsletterSignupLink, 'acceptingSignups' | 'unavailableReason'> {
    let localReason: string | undefined;
    if (committee.join_mode !== 'open') {
      localReason = "Signups are off. Set this group's join mode to Open to accept signups from this link.";
    } else if (committee.enable_voting) {
      localReason = 'Signups are off because voting is enabled for this group.';
    }

    if (serverAccepting === true) {
      return { acceptingSignups: true };
    }
    if (serverAccepting === false) {
      return { acceptingSignups: false, unavailableReason: localReason ?? 'Signups are off because this group requires a business email.' };
    }
    return localReason ? { acceptingSignups: false, unavailableReason: localReason } : { acceptingSignups: true };
  }
}
