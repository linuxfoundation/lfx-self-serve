// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, Signal } from '@angular/core';
import { TranscendService } from '@app/shared/services/transcend.service';
import { NEWSLETTER_GUEST_LEGAL_LINKS } from '@lfx-one/shared/constants';
import { NewsletterFoundationSummary, NewsletterGuestIssue, NewsletterGuestTeaser } from '@lfx-one/shared/interfaces';

import { NewsletterPreviewComponent } from '../newsletter-preview/newsletter-preview.component';

/**
 * Chrome-less newsletter page for a signed-out reader (#5235): a slim top bar (foundation logo and
 * name, Sign in) over the issue. With no issue yet it renders the page the guest modal blurs: the
 * server's teaser (subject, first image, a short plain-text opening) when there is one, else a
 * placeholder article. The issue body itself is never in the DOM before the reader qualifies.
 */
@Component({
  selector: 'lfx-newsletter-guest-reader',
  imports: [DatePipe, NewsletterPreviewComponent],
  templateUrl: './newsletter-guest-reader.component.html',
})
export class NewsletterGuestReaderComponent {
  // === Services ===
  private readonly transcendService = inject(TranscendService);

  // === Inputs ===
  /** Null while the modal is up (placeholder article). */
  public readonly issue = input<NewsletterGuestIssue | null>(null);
  /** Shown behind the modal before an issue is loaded; null keeps the placeholder article. */
  public readonly teaser = input<NewsletterGuestTeaser | null>(null);
  /** Shown in the top bar before an issue is loaded. */
  public readonly foundation = input<NewsletterFoundationSummary | null>(null);
  public readonly signInHref = input<string>('/login');

  // === Computed Signals ===
  protected readonly shownFoundation: Signal<NewsletterFoundationSummary | null> = computed(() => this.issue()?.foundation ?? this.foundation());
  protected readonly placeholderLines = [92, 100, 84, 96, 70, 100, 88, 60];
  protected readonly legalLinks = NEWSLETTER_GUEST_LEGAL_LINKS;

  // === Protected Methods ===
  /** The guest pages hide Transcend's automatic prompt, so the footer keeps cookie preferences reachable. */
  protected onCookieSettings(): void {
    this.transcendService.showPreferences();
  }
}
