// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
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

  public readonly reason = input<'draft' | 'not-found'>('not-found');

  protected readonly icon = computed(() => (this.reason() === 'draft' ? 'fa-light fa-lock' : 'fa-light fa-paper-plane-slash'));
  protected readonly title = computed(() => (this.reason() === 'draft' ? 'Draft Newsletter' : 'Newsletter Not Found'));
  protected readonly description = computed(() =>
    this.reason() === 'draft'
      ? 'Only project managers can view draft newsletters. If you have access questions, contact your project manager.'
      : "We couldn't find the newsletter you're looking for. It may have been removed or the link may be incorrect."
  );

  // The feed is a Me-lens page: with a foundation/project lens active, a plain
  // routerLink to /newsletters/my gets rewritten by lensRedirectGuard to the
  // lens-prefixed mount, whose newsletterAccessGuard bounces non-writers to the
  // overview. Switch to the always-allowed 'me' lens before navigating.
  protected goToMyNewsletters(): void {
    this.lensService.setLens('me');
    void this.router.navigate(['/newsletters/my']);
  }
}
