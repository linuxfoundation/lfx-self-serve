// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';

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

  protected readonly renderedHtml = computed(() => {
    const raw = this.content();
    if (!raw) return '';
    const html = marked.parse(raw, { breaks: this.breaks(), gfm: true }) as string;
    return this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
  });
}
