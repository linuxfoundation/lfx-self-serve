// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output } from '@angular/core';
import { MessageComponent } from '@components/message/message.component';
import { NewsletterJoinState } from '@lfx-one/shared/interfaces';

/**
 * Confirmation shown on the newsletter reader when a Linux Foundation member employee is added to
 * the newsletter group automatically (member benefit, #3469).
 */
@Component({
  selector: 'lfx-newsletter-member-benefit-banner',
  imports: [MessageComponent],
  templateUrl: './newsletter-member-benefit-banner.component.html',
})
export class NewsletterMemberBenefitBannerComponent {
  // === Inputs ===
  public readonly joinState = input.required<NewsletterJoinState>();
  public readonly email = input<string>('');
  public readonly companyName = input<string>('');
  public readonly groupName = input<string>('');

  // === Outputs ===
  public readonly retry = output<void>();

  // === Computed Signals ===
  protected readonly status = computed(() => this.joinState().status);
  protected readonly confirmedEmail = computed(() => this.joinState().result?.email || this.email());
  /** Only the address the server confirmed: an existing membership may be under a different email than the one that qualified. */
  protected readonly alreadyListedEmail = computed(() => this.joinState().result?.email ?? '');
  protected readonly companyLabel = computed(() => this.joinState().result?.company_name || this.companyName() || 'your company');
  protected readonly groupLabel = computed(() => this.joinState().result?.committee_name || this.groupName() || 'this newsletter');
}
