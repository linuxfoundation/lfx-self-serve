// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { JsonPipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { NewsletterLayout } from '@lfx-one/shared/interfaces';

import { NewsletterBlockComposerComponent } from '../components/newsletter-block-composer/newsletter-block-composer.component';

/**
 * Standalone dev/preview host for the newsletter block-composer (LFXV2-2381).
 *
 * Mounts `lfx-newsletter-block-composer` and renders its emitted
 * `NewsletterLayout` as JSON so the composer can be exercised end-to-end in the
 * running app without touching the existing newsletter wizard. Reachable at
 * `/newsletters/composer-preview`.
 */
@Component({
  selector: 'lfx-newsletter-composer-preview',
  imports: [JsonPipe, NewsletterBlockComposerComponent],
  templateUrl: './newsletter-composer-preview.component.html',
})
export class NewsletterComposerPreviewComponent {
  // Latest layout emitted by the composer; rendered as JSON for inspection.
  protected readonly layout = signal<NewsletterLayout | null>(null);

  protected onLayoutChange(layout: NewsletterLayout): void {
    this.layout.set(layout);
  }
}
