// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { inject, Pipe, PipeTransform, SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { extractUrls, isPrivateHost } from '@lfx-one/shared/utils';

/** Linkifies text nodes without escaping rich descriptions or nesting existing anchors. */
@Pipe({
  name: 'linkifyHtml',
})
export class LinkifyHtmlPipe implements PipeTransform {
  private readonly document = inject(DOCUMENT);
  private readonly sanitizer = inject(DomSanitizer);

  public transform(value: string | null | undefined): string {
    if (!value) return '';

    // DOCUMENT also supplies the server DOM. Work on a detached, sanitized tree rather
    // than browser globals or the rendered view, keeping SSR and hydration consistent.
    const container = this.document.createElement('div');
    container.innerHTML = this.sanitizer.sanitize(SecurityContext.HTML, value) || '';
    const nodes: Node[] = Array.from(container.childNodes);
    while (nodes.length) {
      const node = nodes.pop()!;
      if (node.nodeType === 3) {
        this.linkifyText(node);
      } else if (node.nodeType === 1 && (node as Element).tagName.toLowerCase() !== 'a') {
        nodes.push(...Array.from(node.childNodes));
      }
    }

    // Return a string, not trusted HTML: the template's [innerHTML] sanitizer still applies.
    return container.innerHTML;
  }

  private linkifyText(node: Node): void {
    const text = node.textContent || '';
    const urls = extractUrls(text).filter((url) => !isPrivateHost(new URL(url).hostname));
    if (!urls.length) return;

    const fragment = this.document.createDocumentFragment();
    let offset = 0;
    for (const url of urls) {
      const start = text.indexOf(url, offset);
      fragment.appendChild(this.document.createTextNode(text.slice(offset, start)));
      const anchor = this.document.createElement('a');
      anchor.setAttribute('href', url);
      anchor.textContent = url;
      fragment.appendChild(anchor);
      offset = start + url.length;
    }
    fragment.appendChild(this.document.createTextNode(text.slice(offset)));
    node.parentNode?.replaceChild(fragment, node);
  }
}
