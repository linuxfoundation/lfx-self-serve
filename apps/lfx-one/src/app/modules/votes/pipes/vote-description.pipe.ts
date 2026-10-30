// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { inject, Pipe, PipeTransform, SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { isPrivateHost } from '@lfx-one/shared/utils';
import { Parser } from 'htmlparser2';

/** Keeps textarea text literal while retaining sanitized descriptions from the legacy HTML editor. */
@Pipe({ name: 'voteDescription' })
export class VoteDescriptionPipe implements PipeTransform {
  private readonly document = inject(DOCUMENT);
  private readonly sanitizer = inject(DomSanitizer);

  public transform(value: string | null | undefined): string {
    if (!value) return '';

    const container = this.document.createElement('div');
    container.innerHTML = this.sanitizer.sanitize(SecurityContext.HTML, value) || '';

    // With no stored format discriminator, bare unsupported tags make the input ambiguous.
    // Prefer a fully literal fallback over losing placeholders/entities in otherwise supported HTML.
    const elementNames = new Set(Array.from(container.querySelectorAll('*'), (element) => element.tagName.toLowerCase()));
    const visibleMarkup = elementNames.size ? this.stripHiddenMarkup(value, elementNames) : value;
    const hasUnsupportedPlaceholder = Array.from(visibleMarkup.matchAll(/<\/?([a-z][a-z0-9-]*)\s*\/?>/gi)).some(([, tag]) => {
      if (elementNames.has(tag.toLowerCase())) return false;
      // A discarded active-content subtree is not a placeholder. Ask the same sanitizer
      // whether this tag retains text, rather than duplicating its unsafe-element list.
      return !!this.sanitizer.sanitize(SecurityContext.HTML, `<${tag}>text</${tag}>`);
    });
    if (!elementNames.size || hasUnsupportedPlaceholder) {
      const text = this.document.createElement('span');
      text.className = 'whitespace-pre-wrap';
      text.textContent = visibleMarkup;
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

  private stripHiddenMarkup(value: string, supportedTags: ReadonlySet<string>): string {
    // Keep original visible source slices so placeholders, entities, and unmatched closing
    // tags stay literal. Token offsets exclude comments/active content without regex parsing HTML.
    const parts: string[] = [];
    let offset = 0;
    let discardedStart = 0;
    let discardedDepth = 0;
    const discard = (start: number, end: number): void => {
      parts.push(value.slice(offset, start));
      offset = end;
    };
    const parser = new Parser({
      onopentag: (tag) => {
        if (discardedDepth) {
          discardedDepth++;
        } else if (!supportedTags.has(tag) && !this.sanitizer.sanitize(SecurityContext.HTML, `<${tag}>text</${tag}>`)) {
          discardedStart = parser.startIndex;
          discardedDepth = 1;
        }
      },
      onclosetag: () => {
        if (discardedDepth && --discardedDepth === 0) discard(discardedStart, parser.endIndex + 1);
      },
      oncomment: () => {
        if (!discardedDepth) discard(parser.startIndex, parser.endIndex + 1);
      },
    });
    parser.end(value);
    return parts.join('') + value.slice(offset);
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
        this.normalizeExplicitBreakWhitespace(wrapper);
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

  private normalizeExplicitBreakWhitespace(container: HTMLElement): void {
    // Flatten inline descendants so a formatting element between a break and its source
    // newline cannot add a second visual line. Block/pre content never enters this helper.
    const leaves: Node[] = [];
    const collect = (node: Node): void => {
      if (!node.childNodes.length) {
        leaves.push(node);
      } else {
        for (const child of Array.from(node.childNodes)) collect(child);
      }
    };
    collect(container);

    for (let index = 0; index < leaves.length; index++) {
      if (leaves[index].nodeName.toLowerCase() !== 'br') continue;
      const previous = leaves[index - 1];
      const next = leaves[index + 1];
      if (previous?.nodeType === 3) previous.textContent = (previous.textContent || '').replace(/[ \t]*\n[ \t]*$/, '');
      if (next?.nodeType === 3) next.textContent = (next.textContent || '').replace(/^[ \t]*\n/, '');
    }
  }
}
