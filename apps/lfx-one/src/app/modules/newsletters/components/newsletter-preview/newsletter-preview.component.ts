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
  // Optional override to force the complete-document (iframe) render even before
  // any bodyHtml has loaded. Detection below already covers the normal case, so
  // most callers can leave this unset.
  public readonly fullDocument = input<boolean>(false);

  // Computed
  public readonly hasContent: Signal<boolean> = computed(() => Boolean(this.subject().trim() || this.bodyHtml().trim()));
  // A blocks newsletter's server render is a COMPLETE email document (the
  // template wrapper + its <head> styles), which starts with a doctype/<html>.
  // Detect that from the content itself rather than relying on a body_layout
  // flag — a SENT newsletter's list DTO may omit body_layout even though its
  // body_html is a full document. A complete document renders as-is in a
  // fully-sandboxed iframe so its <head> CSS survives and no frontend chrome is
  // layered on top; an authored fragment (simple editor) keeps the chrome preview.
  public readonly isFullDocument: Signal<boolean> = computed(() => {
    if (this.fullDocument()) return true;
    const head = this.bodyHtml().trimStart().slice(0, 200).toLowerCase();
    return head.startsWith('<!doctype') || head.startsWith('<html');
  });
  // The complete document is writer-rendered email HTML (the same body dispatched
  // to recipients). It is shown only inside a fully-sandboxed iframe (no scripts,
  // no same-origin), so bypassing sanitization here affects only that isolated
  // frame — it cannot script or reach the host page.
  public readonly trustedDocument: Signal<SafeHtml> = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.bodyHtml()));
}
