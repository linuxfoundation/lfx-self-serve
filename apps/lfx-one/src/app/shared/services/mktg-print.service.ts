// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { MKTG_PRINT_FONT_WAIT_MS, MKTG_PRINT_FONT_WEIGHTS } from '@lfx-one/shared/constants';

/**
 * Download PDF for a Marketing OS asset view: the browser's print dialog
 * ("Save as PDF") with the asset's print document alone on paper. The asset
 * view holds its print document in a print-only wrapper; while the body
 * carries the asset's print class (styles.scss) only that document prints.
 * The Brand Kit's book is printed the same way by its web view.
 *
 * The brand's typeface is loaded before the dialog opens: the print document
 * is never laid out on screen, so nothing else would fetch it, and a print
 * taken before the face arrives comes out in the fallback. The wait is
 * capped, so a slow or blocked font never keeps the dialog shut.
 */
@Injectable({ providedIn: 'root' })
export class MktgPrintService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  /** Numbers each print request: a request whose number is no longer current after the font wait was cleared (or superseded) and never prints. */
  private request = 0;

  /**
   * Prints the document the body class shows, once the given typeface (if
   * any) has loaded or the wait has run out. The class stays while the dialog
   * is up (the preview renders from it) and goes when the print ends. A
   * {@link clear} during the font wait cancels the print: the view that asked
   * for it is gone.
   */
  public async print(bodyClass: string, fontFamily: string | null = null): Promise<void> {
    // SSR guard: window and the print dialog are browser-only (ssr-safety rule).
    const view = this.document.defaultView;
    if (!isPlatformBrowser(this.platformId) || !view) {
      return;
    }
    const request = ++this.request;
    if (fontFamily) {
      await this.loadFont(fontFamily);
    }
    if (request !== this.request) {
      return;
    }
    const body = this.document.body;
    body.classList.add(bodyClass);
    view.addEventListener('afterprint', () => body.classList.remove(bodyClass), { once: true });
    view.print();
  }

  /** Takes the print class off the body and cancels a print still waiting for its font: for a view that goes while its print is under way. */
  public clear(bodyClass: string): void {
    this.request++;
    this.document.body?.classList.remove(bodyClass);
  }

  // === Private helpers ===
  private async loadFont(family: string): Promise<void> {
    // Not every browser (nor the test DOM) has the CSS Font Loading API: then the print goes ahead at once.
    const fonts: FontFaceSet | undefined = this.document.fonts;
    if (!fonts) {
      return;
    }
    const name = family.replace(/["']/g, '');
    const loads = MKTG_PRINT_FONT_WEIGHTS.map((weight) => fonts.load(`${weight} 1em "${name}"`));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, MKTG_PRINT_FONT_WAIT_MS);
    });
    await Promise.race([Promise.allSettled(loads), timeout]);
    clearTimeout(timer);
  }
}
