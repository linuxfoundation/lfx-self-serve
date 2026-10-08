// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { NEWSLETTER_COMMITTEE_CATEGORY } from '@lfx-one/shared/constants';
import { NewsletterSignupLink } from '@lfx-one/shared/interfaces';
import { newsletterSignupPath, toAbsoluteUrl } from '@lfx-one/shared/utils';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { CommitteeService } from '@services/committee.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, map, of } from 'rxjs';

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
        map((committees) =>
          committees
            .filter((committee) => committee.category === NEWSLETTER_COMMITTEE_CATEGORY)
            .map(
              (committee): NewsletterSignupLink => ({
                groupUid: committee.uid,
                groupName: committee.display_name || committee.name,
                url: toAbsoluteUrl(newsletterSignupPath(this.projectSlug, committee.uid), isBrowser),
                // Mirrors the BFF's check — upstream refuses email-only members for these groups.
                acceptingSignups: !committee.enable_voting && !committee.business_email_required,
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
}
