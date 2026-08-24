// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { escapeHtml, isValidUrl } from '@lfx-one/shared/utils';
import { Marked, marked, RendererObject } from 'marked';

@Component({
  selector: 'lfx-markdown-renderer',
  templateUrl: './markdown-renderer.component.html',
  styleUrl: './markdown-renderer.component.scss',
})
export class MarkdownRendererComponent {
  private readonly sanitizer = inject(DomSanitizer);

  public readonly content = input<string>('');
  /** GFM line-break mode: single newlines render as `<br>` (social posts, chat-style content). */
  public readonly breaks = input<boolean>(false);
  /** Attacker-controlled content: drops images, escapes raw HTML, and gates links behind the external-URL policy. */
  public readonly restricted = input<boolean>(false);

  private restrictedMarked?: Marked;

  protected readonly renderedHtml = computed(() => {
    const raw = this.content();
    if (!raw) return '';
    const options = { breaks: this.breaks(), gfm: true };
    const html = (this.restricted() ? this.getRestrictedMarked().parse(raw, options) : marked.parse(raw, options)) as string;
    return this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
  });

  private getRestrictedMarked(): Marked {
    this.restrictedMarked ??= this.buildRestrictedMarked();
    return this.restrictedMarked;
  }

  // Images are dropped because they make the viewer's browser fetch arbitrary (tracking-pixel / internal-network) URLs on render.
  private buildRestrictedMarked(): Marked {
    const renderer: RendererObject = {
      image: () => '',
      html: ({ text }) => escapeHtml(text),
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        return isValidUrl(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
      },
    };
    return new Marked({ renderer });
  }
}
