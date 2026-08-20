// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'lfx-newsletter-preview',
  templateUrl: './newsletter-preview.component.html',
  styleUrl: './newsletter-preview.component.scss',
})
export class NewsletterPreviewComponent {
  private readonly sanitizer = inject(DomSanitizer);

  // Inputs
  public readonly subject = input<string>('');
  public readonly bodyHtml = input<string>('');
  public readonly logoUrl = input<string | undefined>(undefined);
  public readonly displayName = input<string>('');
  // When true, bodyHtml is a COMPLETE email document (a blocks newsletter whose
  // server render already carries the template wrapper and its <head> styles).
  // It renders as-is in a fully-sandboxed iframe so the <head> CSS survives and
  // no frontend chrome is layered on top — the preview matches the real email.
  // When false, bodyHtml is an authored body fragment (simple editor) and the
  // frontend chrome previews the email envelope around it.
  public readonly fullDocument = input<boolean>(false);

  // Computed
  public readonly hasContent: Signal<boolean> = computed(() => Boolean(this.subject().trim() || this.bodyHtml().trim()));
  // The complete document is writer-rendered email HTML (the same body dispatched
  // to recipients). It is shown only inside a fully-sandboxed iframe (no scripts,
  // no same-origin), so bypassing sanitization here affects only that isolated
  // frame — it cannot script or reach the host page.
  public readonly trustedDocument: Signal<SafeHtml> = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.bodyHtml()));
}
