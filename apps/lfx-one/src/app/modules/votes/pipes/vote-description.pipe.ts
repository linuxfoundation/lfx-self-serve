// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { inject, Pipe, PipeTransform, SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { isPrivateHost } from '@lfx-one/shared/utils';

/** Keeps textarea text literal while retaining sanitized descriptions from the legacy HTML editor. */
@Pipe({ name: 'voteDescription' })
export class VoteDescriptionPipe implements PipeTransform {
  private readonly document = inject(DOCUMENT);
  private readonly sanitizer = inject(DomSanitizer);

  public transform(value: string | null | undefined): string {
    if (!value) return '';

    const container = this.document.createElement('div');
    container.innerHTML = this.sanitizer.sanitize(SecurityContext.HTML, value) || '';

    // There is no stored format discriminator. Elements that survive Angular's sanitizer
    // identify supported HTML; otherwise keep placeholders and entities literal.
    if (!container.querySelector('*')) {
      const text = this.document.createElement('span');
      text.className = 'whitespace-pre-wrap';
      text.textContent = value;
      return text.outerHTML;
    }

    // Strip destinations before binding, so browser context-menu navigation cannot bypass
    // click-time guards. A fixed public-shaped base keeps relative links SSR-consistent;
    // it is used only for parsing, never as the rendered href or a network destination.
    for (const anchor of Array.from(container.querySelectorAll('a[href]'))) {
      const href = anchor.getAttribute('href') || '';
      try {
        const destination = new URL(href, 'https://vote-description.invalid');
        if ((destination.protocol === 'http:' || destination.protocol === 'https:') && isPrivateHost(destination.hostname)) {
          anchor.removeAttribute('href');
        }
      } catch {
        anchor.removeAttribute('href');
      }
    }

    this.preserveInlineWhitespace(container);

    // No trusted-HTML bypass: the template sanitizer still applies.
    return container.innerHTML;
  }

  private preserveInlineWhitespace(container: HTMLElement): void {
    // Only top-level text/inline runs need textarea spacing. Legacy HTML blocks keep
    // normal whitespace, including source indentation between paragraphs and list items.
    const blockSelector =
      'address, article, aside, blockquote, caption, center, dd, details, dialog, dir, div, dl, dt, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hgroup, hr, li, main, menu, nav, ol, p, pre, section, summary, table, tbody, td, tfoot, th, thead, tr, ul';
    let run: Node[] = [];
    const wrapRun = (): void => {
      if (run.some((node) => node.nodeType === 1 || node.textContent?.trim())) {
        const wrapper = this.document.createElement('span');
        wrapper.className = 'whitespace-pre-wrap';
        container.insertBefore(wrapper, run[0]);
        for (const node of run) wrapper.appendChild(node);
      }
      run = [];
    };

    for (const node of Array.from(container.childNodes)) {
      const element = node as Element;
      if (node.nodeType === 1 && (element.matches(blockSelector) || element.querySelector(blockSelector))) {
        wrapRun();
      } else {
        run.push(node);
      }
    }
    wrapRun();
  }
}
