// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, SecurityContext, Signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { stripRichtextAttributes, withNewsletterPreviewDate } from '@lfx-one/shared/utils';

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
  // When the newsletter was or will be sent. A stored layout body keeps its
  // send-date token after the send, so a sent issue has to show this date.
  // Unset means an unscheduled draft, which shows today.
  public readonly sendDate = input<string | null | undefined>(undefined);

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
  // to recipients). It is shown only inside a sandboxed iframe with no scripts and
  // no same-origin access, so bypassing sanitization here affects only that
  // isolated frame and cannot script or reach the host page. A <base
  // target="_blank"> is added so every link opens in a new tab rather than inside
  // the frame, which most sites refuse to be loaded in.
  // An authored fragment renders in the app page, not a frame. It is sanitized, and then class (and any target but
  // _blank) is stripped, which Angular's sanitizer keeps. Otherwise a stored class could use the app's own styles
  // to draw over the page, e.g. in the guest reader (#5295).
  public readonly fragmentHtml: Signal<string> = computed(() => stripRichtextAttributes(this.sanitizer.sanitize(SecurityContext.HTML, this.bodyHtml()) ?? ''));
  public readonly trustedDocument: Signal<SafeHtml> = computed(() => {
    const sendDate = this.sendDate();
    const html = withNewsletterPreviewDate(this.bodyHtml(), sendDate ? new Date(sendDate) : undefined);
    return this.sanitizer.bypassSecurityTrustHtml(withBlankLinkTarget(html));
  });
}

/** Adds `<base target="_blank">` to a complete HTML document so its links open in a new tab. */
export function withBlankLinkTarget(html: string): string {
  const base = '<base target="_blank">';
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + base + html.slice(at);
  }
  const root = /<html[^>]*>/i.exec(html);
  if (root) {
    const at = root.index + root[0].length;
    return html.slice(0, at) + '<head>' + base + '</head>' + html.slice(at);
  }
  return base + html;
}
