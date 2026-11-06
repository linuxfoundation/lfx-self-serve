// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import { NewsletterFoundationSummary, NewsletterGuestIssue } from '@lfx-one/shared/interfaces';

import { NewsletterPreviewComponent } from '../newsletter-preview/newsletter-preview.component';

/**
 * Chrome-less newsletter page for a signed-out reader (#5235): a slim top bar (foundation logo and
 * name, Sign in) over the issue. With no issue yet it renders a placeholder article — the page the
 * guest modal blurs — so nothing of the newsletter is in the DOM before the reader qualifies.
 */
@Component({
  selector: 'lfx-newsletter-guest-reader',
  imports: [DatePipe, NewsletterPreviewComponent],
  templateUrl: './newsletter-guest-reader.component.html',
})
export class NewsletterGuestReaderComponent {
  // === Inputs ===
  /** Null while the modal is up (placeholder article). */
  public readonly issue = input<NewsletterGuestIssue | null>(null);
  /** Shown in the top bar before an issue is loaded. */
  public readonly foundation = input<NewsletterFoundationSummary | null>(null);
  public readonly signInHref = input<string>('/login');

  // === Computed Signals ===
  protected readonly shownFoundation: Signal<NewsletterFoundationSummary | null> = computed(() => this.issue()?.foundation ?? this.foundation());
  protected readonly placeholderLines = [92, 100, 84, 96, 70, 100, 88, 60];
}
