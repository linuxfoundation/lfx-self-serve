// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

@Component({
  selector: 'lfx-newsletter-not-found',
  imports: [RouterLink, ButtonComponent, CardComponent],
  templateUrl: './newsletter-not-found.component.html',
})
export class NewsletterNotFoundComponent {
  public readonly reason = input<'draft' | 'not-found'>('not-found');

  protected readonly icon = computed(() => (this.reason() === 'draft' ? 'fa-light fa-lock' : 'fa-light fa-paper-plane-slash'));
  protected readonly title = computed(() => (this.reason() === 'draft' ? 'Draft Newsletter' : 'Newsletter Not Found'));
  protected readonly description = computed(() =>
    this.reason() === 'draft'
      ? 'Only project managers can view draft newsletters. If you have access questions, contact your project manager.'
      : "We couldn't find the newsletter you're looking for. It may have been removed or the link may be incorrect."
  );
}
