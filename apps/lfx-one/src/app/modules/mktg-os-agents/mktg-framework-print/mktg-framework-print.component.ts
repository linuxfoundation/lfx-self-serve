// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, PLATFORM_ID } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FoundationMessagePrintView } from '@lfx-one/shared/interfaces';
import { distinctUntilChanged, filter } from 'rxjs';

// The Messaging Framework's PRINT rendering (Download PDF): the framework
// view's tabs as one document on letter pages, portrait — a cover, then the
// framework (the statements, the goal columns, say and avoid, the anchor
// questions), the ICPs, the message house and the key numbers. The run's
// sources and gaps, and the reviewer's note, stay on screen. Set in the
// project's brand when it has a Brand Kit (its colours, typeface and logo),
// in the LF look otherwise. On screen the framework is its app page
// (lfx-mktg-framework-view), which holds this document in a print-only
// wrapper and prints it with Download PDF (the browser's print; the global
// print rules in styles.scss show it alone). The layout grew from the brand
// kit book's sheet and the one pager's letter page.
@Component({
  selector: 'lfx-mktg-framework-print',
  imports: [NgTemplateOutlet],
  templateUrl: './mktg-framework-print.component.html',
  styleUrl: './mktg-framework-print.component.scss',
})
export class MktgFrameworkPrintComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  /** The framework as the print lays it out, with the brand it is set in. */
  public readonly view = input.required<FoundationMessagePrintView>();

  // === Computed ===
  /** The Google Fonts stylesheet of the brand's typeface, when the kit says it is there (null otherwise). */
  private readonly fontUrl$ = toObservable(computed(() => this.view().brand.fontUrl));

  public constructor() {
    // The typeface comes from Google Fonts, loaded once per family in the
    // browser, as the brand kit book loads it; SSR renders the fallback and
    // never touches the head.
    if (isPlatformBrowser(this.platformId)) {
      this.fontUrl$
        .pipe(
          filter((url): url is string => !!url),
          distinctUntilChanged(),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((url) => this.ensureFontLink(url));
    }
  }

  // === Private helpers ===
  private ensureFontLink(url: string): void {
    // The same id as the book's, so a typeface the kit view already loaded is not loaded twice.
    const id = `brand-kit-font-${encodeURIComponent(url)}`;
    if (this.document.getElementById(id)) {
      return;
    }
    const link = this.document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = url;
    this.document.head.appendChild(link);
  }
}
