// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Renders generated email body HTML the way a recipient will see it.
 *
 * ## Why an iframe and not `[innerHTML]`
 *
 * These previews used `[innerHTML]`, which runs through Angular's default sanitizer at
 * `SecurityContext.HTML`. That sanitizer strips `style` attributes and `<style>` blocks — and email
 * HTML is almost entirely inline-styled, because most mail clients drop everything that is not. So
 * the preview showed the email's STRUCTURE with none of its styling: correct markup, wrong colours,
 * wrong type scale, wrong spacing. An operator approving a send was approving something they had
 * not actually seen, and the HubSpot draft was the only faithful proof.
 *
 * The campaign service now applies the Linux Foundation's own palette and type scale to every
 * generated `rich_text` section as inline styles (`internal/service/email_body_style.go`), so there
 * is real styling to show. This component shows it.
 *
 * ## What keeps it safe
 *
 * The control moved from Angular's sanitizer to the BROWSER's iframe sandbox, which is a stronger
 * boundary, not a weaker one — and it had to move, because the two are mutually exclusive here: the
 * sanitizer cannot keep inline styles.
 *
 * `sandbox` omits both `allow-scripts` and `allow-same-origin`, so the document:
 *
 * - cannot execute script — an `on*` handler, a `<script>` block or a `javascript:` href is inert,
 *   whatever the HTML contains;
 * - gets a unique opaque origin, so it cannot read this app's DOM, cookies, `localStorage` or
 *   session, and this app cannot read into it either;
 * - cannot submit a form, autoplay media, or lock the pointer.
 *
 * `allow-popups allow-popups-to-escape-sandbox` IS granted, so a link opens the real site in a new
 * tab rather than silently doing nothing. With scripts disabled, a popup can only be opened by a
 * deliberate user click, and `-to-escape-sandbox` is what stops the opened page being a
 * script-less broken rendering of the event site. Verifying that the generated links point where
 * they should is most of the reason to look at this preview at all.
 *
 * `bypassSecurityTrustHtml` is therefore deliberate and not an oversight. It is required because
 * Angular treats `iframe[srcdoc]` as an HTML sink and would sanitize it exactly as it sanitized
 * `[innerHTML]`, re-creating the problem this component exists to fix. The bypass is sound ONLY
 * while the sandbox above stays as it is: granting `allow-scripts` would turn this into an
 * arbitrary-script-execution sink for model-authored content derived from scraped third-party event
 * pages. Do not add it. Granting `allow-same-origin` alongside it would be worse still — together
 * they let the framed document remove its own sandbox attribute.
 *
 * Server-side sanitization still happens first and is unchanged: `styleEmailBodyHTML` drops every
 * attribute the model wrote, every tag outside its allowlist, and the content of `<script>` and
 * `<style>`. This sandbox is the second of two independent controls, not the only one.
 */
@Component({
  selector: 'lfx-email-body-preview',
  imports: [],
  templateUrl: './email-body-preview.component.html',
})
export class EmailBodyPreviewComponent {
  private readonly sanitizer = inject(DomSanitizer);

  public readonly html = input<string>('');

  /**
   * Shown in place of the frame when there is no body yet.
   *
   * A placeholder is rendered as plain text rather than as HTML inside the frame, so an empty
   * preview reads as empty rather than as a one-line email.
   */
  public readonly emptyText = input<string>('(no body yet)');

  /**
   * The frame's height in pixels; content taller than this scrolls inside the frame.
   *
   * It cannot be measured. Auto-sizing an iframe to its content requires either reading
   * `contentDocument` (needs `allow-same-origin`) or a script inside the frame posting its height
   * (needs `allow-scripts`), and both are the grants that make the sandbox above meaningless. A
   * fixed height with an honest scrollbar is the price of the sandbox.
   */
  public readonly heightPx = input<number>(420);

  public readonly testId = input<string>('');

  public readonly hasBody: Signal<boolean> = computed(() => this.html().trim().length > 0);

  public readonly srcdoc: Signal<SafeHtml> = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.buildDocument(this.html())));

  /**
   * Wraps the body HTML in the minimal document a mail client would supply around it.
   *
   * The `<style>` block here is the PREVIEW's page reset — white background, no body margin, a
   * default family and size for anything unstyled — and deliberately styles nothing the email
   * styles itself. It is the stand-in for a mail client's own default document, not a second
   * opinion about how the email should look. Every rule it sets is one the email's own inline
   * styles override.
   *
   * `word-break` and `max-width:100%` on images are the two defensive rules: a long unbroken URL
   * and an oversized image are the usual ways a narrow preview column gets a horizontal scrollbar.
   */
  private buildDocument(body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    padding: 16px;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 16px;
    line-height: 160%;
    color: #1b1b1f;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  img { max-width: 100%; height: auto; }
</style>
</head>
<body>${body}</body>
</html>`;
  }
}
