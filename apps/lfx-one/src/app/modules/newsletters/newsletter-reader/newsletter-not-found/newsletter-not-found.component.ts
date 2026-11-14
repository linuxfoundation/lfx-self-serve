// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { NewsletterReaderDeniedReason } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

@Component({
  selector: 'lfx-newsletter-not-found',
  imports: [ButtonComponent, CardComponent],
  templateUrl: './newsletter-not-found.component.html',
})
export class NewsletterNotFoundComponent {
  private readonly router = inject(Router);
  private readonly lensService = inject(LensService);

  public readonly reason = input<'draft' | 'not-found' | 'members-only'>('not-found');
  /** `members-only` only: why the reader did not qualify for the Linux Foundation member benefit. */
  public readonly deniedReason = input<NewsletterReaderDeniedReason | null>(null);

  protected readonly icon = computed(() => {
    if (this.reason() === 'not-found') return 'fa-light fa-paper-plane-slash';
    return this.reason() === 'members-only' ? 'fa-light fa-envelope-open-text' : 'fa-light fa-lock';
  });

  protected readonly title = computed(() => {
    if (this.reason() === 'draft') return 'Draft Newsletter';
    if (this.reason() === 'not-found') return 'Newsletter Not Found';
    return this.deniedReason() === 'no_newsletter_group' ? 'Restricted Newsletter' : 'This newsletter is a member benefit';
  });

  protected readonly description = computed(() => {
    if (this.reason() === 'draft') {
      return 'Only project managers can view draft newsletters. If you have access questions, contact your project manager.';
    }
    if (this.reason() === 'not-found') {
      return "We couldn't find the newsletter you're looking for. It may have been removed or the link may be incorrect.";
    }
    if (this.deniedReason() === 'no_newsletter_group') {
      return 'This issue was sent to a private group and is not offered as a member benefit. Contact the project team if you need access.';
    }
    if (this.deniedReason() === 'no_company_email') {
      return "Employees of Linux Foundation member companies get this newsletter. Add and confirm your company email address on your LFX account, then open this link again — you'll be added automatically.";
    }
    return 'Employees of Linux Foundation member companies get this newsletter. None of the confirmed email addresses on your LFX account belong to a member company. If you work for one, add and confirm your company email address, then open this link again.';
  });

  // Eager Me selection updates this tab and the persisted lens preference
  // before navigating to the personal feed.
  protected goToMyNewsletters(): void {
    this.lensService.setLens('me');
    void this.router.navigate(['/newsletters/my']);
  }

  protected goToEmailSettings(): void {
    void this.router.navigate(['/profile/emails']);
  }
}
