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

  protected readonly renderedHtml = computed(() => {
    const raw = this.content();
    if (!raw) return '';
    const html = marked.parse(raw) as string;
    return this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
  });
}
