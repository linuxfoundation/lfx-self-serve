// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import {
  BRAND_KIT_PORTRAIT_PRINT_CLASS,
  BRAND_KIT_PRINT_BODY_CLASS,
  BRAND_KIT_PRINT_ONLY_CLASS,
  FOUNDATION_MESSAGE_PRINT_BODY_CLASS,
  FOUNDATION_MESSAGE_PRINT_ONLY_CLASS,
  MKTG_FAMILY_PRINT_BODY_CLASS,
  MKTG_FAMILY_PRINT_ONLY_CLASS,
  MKTG_PRINT_FONT_LINK_ID_PREFIX,
  MKTG_PRINT_FONT_WAIT_MS,
  MKTG_PRINT_FONT_WEIGHTS,
  MKTG_PRINT_FRAME_LINGER_MS,
  MKTG_PRINT_FRAME_PAPER_IN,
  MKTG_PORTRAIT_PAGE_NAME,
  MKTG_PORTRAIT_PRINT_CLASS,
  MKTG_PRINT_PAGE_MARGINS_CLASS,
  MKTG_PRINT_PAGE_SETUPS,
} from '@lfx-one/shared/constants';
import { mktgPrintIsWebKit } from '@lfx-one/shared/utils';

/**
 * Download PDF for a Marketing OS document: the browser's print dialog ("Save
 * as PDF") with the document alone on paper, printed from an idle, script-free
 * same-origin frame rather than the app window.
 *
 * Why a frame: WebKit's `window.print()` defers the print while the window's
 * document loader is busy, and any open fetch, XHR or EventSource counts. LFX
 * One keeps a LaunchDarkly EventSource open from bootstrap, so the app window
 * is never idle and Safari (macOS and iOS) never printed. The frame has no
 * scripts and no streams: once its stylesheets, faces and images have settled
 * (or the cap has run out and the rest is stopped) its loader is idle, and
 * `frame.contentWindow.print()` prints it in every browser.
 *
 * What the frame holds: the page's `<html>`/`<body>` classes plus the print
 * body class, every `link[rel=stylesheet]` and `<style>` of the head (never a
 * `<script>`), and a clone of the surface's print-only wrapper, the one its
 * body class reveals (`*-print-only`, from the shared constants). The parent
 * body is never marked: the existing print CSS keeps applying inside the
 * frame, whose body carries the class instead.
 *
 * The frame is paper-sized (US Letter), fixed, transparent and inert. WebKit
 * lays a subframe out at the frame's own size and resolves `vh` there, so a
 * 1px frame collapsed the covers' viewport-height boxes and shifted the page
 * breaks; Chromium paginates against the page box either way. A fixed box adds
 * no scrollable overflow and `pointer-events: none` lets clicks through, so
 * the page under it is unchanged while the dialog is open. The frame's head
 * also gets one unnamed `@page` rule with the surface's page setup
 * (`MKTG_PRINT_PAGE_SETUPS`): WebKit's support for named pages is doubtful,
 * and on default margins a cover sized to the page area spills a blank sheet.
 * The portrait setup is the engine's: no margin, and the documents' own room
 * repeated per page by their table head and foot groups, so no browser header
 * or footer reaches the PDF; in WebKit, which prints a table's head and foot
 * once (bug 17205), the margins the pages had before, with that room
 * collapsed under `MKTG_PRINT_PAGE_MARGINS_CLASS` on the frame's body.
 *
 * The brand's typeface is loaded before the dialog opens, in the page (ahead
 * of the click) and again in the frame, and only after its Google Fonts
 * stylesheet has loaded: `fonts.load` before the `@font-face` rules exist
 * matches nothing. Every wait is capped, so a slow or blocked resource never
 * keeps the dialog shut.
 */
@Injectable({ providedIn: 'root' })
export class MktgPrintService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private request = 0;
  private readonly preparations = new Map<string, Promise<void>>();
  private readonly stylesheets = new Map<HTMLLinkElement, Promise<void>>();
  private fontFamily: string | null = null;
  private weights: readonly number[] = MKTG_PRINT_FONT_WEIGHTS;
  private frame: HTMLIFrameElement | null = null;
  private cleanupFrame: (() => void) | null = null;

  /** Preload sheets before faces; fonts.load otherwise resolves empty before @font-face exists. */
  public prepare(fontFamily: string | null, weights: readonly number[] = MKTG_PRINT_FONT_WEIGHTS): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return Promise.resolve();
    this.fontFamily = fontFamily?.replace(/["']/g, '') ?? null;
    this.weights = [...new Set(weights)].sort((a, b) => a - b);
    if (!this.fontFamily) return Promise.resolve();
    const family = this.fontFamily;
    const normalized = this.weights;
    const key = JSON.stringify([family, normalized, ...Array.from(this.stylesheets.keys(), (link) => link.href)]);
    let preparation = this.preparations.get(key);
    if (!preparation) {
      preparation = this.bounded(async () => {
        await Promise.all(this.stylesheets.values());
        await this.loadFont(this.document, family, normalized);
      });
      this.preparations.set(key, preparation);
    }
    return preparation;
  }

  /**
   * Called in the click task; creates the frame immediately, then prints once its own loader is idle.
   * `title` names the PDF the browser saves: it titles the frame's document (WebKit names the file
   * from the printed frame's title) and, while the dialog is open, the tab's (Chromium's print preview
   * names the file from the top-level `document.title`). The tab's own title comes back when the
   * print is over; without a `title` the page's own title stands everywhere.
   */
  public printNow(bodyClass: string, title?: string): void {
    const request = ++this.request;
    if (!isPlatformBrowser(this.platformId) || !this.document.defaultView) return;
    this.cleanupFrame?.();
    const roots = this.printRoots(bodyClass);
    if (!roots.length) return;
    const frame = this.document.createElement('iframe');
    frame.setAttribute('data-testid', 'lfx-print-frame');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('title', 'Print document');
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;width:${MKTG_PRINT_FRAME_PAPER_IN.width}in;height:${MKTG_PRINT_FRAME_PAPER_IN.height}in;left:0;top:0;opacity:0;pointer-events:none;border:0`;
    this.document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    if (!doc || !view) {
      frame.remove();
      return;
    }
    this.frame = frame;
    // Never switch the app to print media: its shell rules could hide the iframe itself.
    let fallback: ReturnType<typeof setTimeout> | undefined;
    let focused: HTMLElement | null = null;
    // The tab's title before the print named it; null until the swap, and again once restored.
    let previousTitle: string | null = null;
    const cleanup = () => {
      clearTimeout(fallback);
      view.removeEventListener('afterprint', cleanup);
      // Restore the tab's title exactly once, and only while it is still the one the print set: the
      // app may have retitled the page meanwhile (a navigation while the dialog was open), and that
      // title is not ours to undo. Every cleanup path comes through here: afterprint, the linger
      // timer, a superseding print and clear().
      if (previousTitle !== null) {
        if (this.document.title === title) this.document.title = previousTitle;
        previousTitle = null;
      }
      // Removing a focused frame drops focus on the body. Return it to the control that opened the
      // dialog, but only while focus is still in the frame or nowhere: cleanup also runs from the
      // iOS linger timer, a superseding print and clear(), when the user may be in another field.
      const active = this.document.activeElement;
      const restore = focused?.isConnected === true && (active === null || active === frame || active === this.document.body);
      frame.remove();
      if (restore) focused?.focus({ preventScroll: true });
      if (this.frame === frame) {
        this.frame = null;
        this.cleanupFrame = null;
      }
    };
    this.cleanupFrame = cleanup;
    // document.open() from this page gives the frame the page's URL (the HTML "document open steps"
    // run the URL update with the entry document's URL), so a browser's default header or footer
    // prints the page address, not about:blank, as when the app window printed.
    doc.open();
    doc.write('<!doctype html><html><head></head><body></body></html>');
    doc.close();
    view.addEventListener('afterprint', cleanup, { once: true });
    doc.documentElement.className = this.document.documentElement.className;
    doc.documentElement.lang = this.document.documentElement.lang;
    doc.documentElement.dir = this.document.documentElement.dir;
    doc.documentElement.style.cssText = this.document.documentElement.style.cssText;
    doc.body.className = this.document.body.className;
    doc.body.classList.add(bodyClass);
    // The engine, read once per print from the app window (the same-origin frame shares it): WebKit prints a
    // table's head and foot once, so there the pages print on their margins and the documents' room collapses.
    // A document holding fixed portrait frames prints with no page margin in every engine (a frame is the whole
    // sheet), so its flowing parts keep their own room instead of the page's.
    const frames = this.hasPortraitFrames(roots);
    const pageMargins = !frames && mktgPrintIsWebKit(this.document.defaultView.navigator.userAgent);
    if (pageMargins) doc.body.classList.add(MKTG_PRINT_PAGE_MARGINS_CLASS);
    doc.body.style.cssText = this.document.body.style.cssText;
    doc.title = title ?? this.document.title;
    const base = doc.createElement('base');
    base.href = this.document.baseURI;
    doc.head.appendChild(base);
    const sheets: Promise<void>[] = [];
    this.document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((source) => {
      const clone = source.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
      this.stripHandlers(clone);
      if (clone.tagName === 'LINK') sheets.push(this.waitForStylesheet(clone as HTMLLinkElement));
      doc.head.appendChild(clone);
    });
    // The surface's page setup as the frame's unnamed @page rule, chosen as mktg-family-print.scss
    // chooses the named page: the brand kit's legacy book is landscape, every portrait document
    // (the kit's portrait print included) is on the framework's setup. Last in the head, after
    // the cloned sheets; in Chrome the matched named rule still outranks it with the same values.
    // On the page margins (WebKit) the portrait setup also restates the named framework page, after
    // the cloned sheets, so an engine that did honour named pages could not print the margin-less
    // setup; the book's landscape setup is never written into the framework's page.
    // A document of portrait frames (MKTG_PORTRAIT_PRINT_CLASS) names its own page on every frame, the print's one
    // named page (nothing else in a print names one), so the setup is written as that named rule too.
    const setup = doc.createElement('style');
    const pageSetup = this.pageSetup(bodyClass, roots, pageMargins);
    const restatesFramework = pageSetup === MKTG_PRINT_PAGE_SETUPS['mktg-framework-page-margins'];
    let named = '';
    if (restatesFramework) named = `\n@page mktg-framework { ${pageSetup} }`;
    if (pageSetup === MKTG_PRINT_PAGE_SETUPS['mktg-portrait']) named = `\n@page ${MKTG_PORTRAIT_PAGE_NAME} { ${pageSetup} }`;
    setup.textContent = `@page { ${pageSetup} }${named}`;
    doc.head.appendChild(setup);
    // Only the three existing print-only wrappers, selected by their shared constants.
    // Keep Angular's scoping attributes; never clone the interactive app shell or its scripts/streams.
    roots.forEach((root) => {
      const clone = root.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove());
      [clone, ...Array.from(clone.querySelectorAll('*'))].forEach((element) => this.stripHandlers(element));
      clone.querySelectorAll('img').forEach((image) => (image.loading = 'eager'));
      doc.body.appendChild(clone);
    });
    const family = this.fontFamily;
    const weights = this.weights;
    // One bounded wait for the frame's own resources: its stylesheets first (the @font-face rules
    // live there), then the brand's faces in the frame's FontFaceSet and its images' decode.
    void this.bounded(async () => {
      await Promise.all(sheets);
      if (request !== this.request) return;
      await Promise.allSettled([this.loadFont(doc, family, weights), ...Array.from(doc.images, (image) => image.decode?.() ?? Promise.resolve())]);
    }).then(() => {
      if (request !== this.request || this.frame !== frame) return;
      // Cancel any resource still loading at the cap: WebKit prints only a frame whose loader is idle.
      view.stop();
      const active = this.document.activeElement;
      focused = active instanceof HTMLElement ? active : null;
      view.focus();
      // iOS may omit afterprint: keep the frame through its asynchronous preview, then reclaim it;
      // clear() and the next print remove it at once without relying on that event.
      fallback = setTimeout(cleanup, MKTG_PRINT_FRAME_LINGER_MS);
      // Chromium's Save as PDF names the file from the tab's title, not the printed frame's.
      if (title !== undefined) {
        previousTitle = this.document.title;
        this.document.title = title;
      }
      view.print();
    });
  }

  /** Cancel a pending print (its frame and resource wait); a surface calls it when it leaves. */
  public clear(): void {
    this.request++;
    if (!isPlatformBrowser(this.platformId)) return;
    this.cleanupFrame?.();
  }

  /** A shared, bounded promise for each font sheet, including sheets already requested by another surface. */
  public ensureFontStylesheet(url: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return Promise.resolve();
    const id = `${MKTG_PRINT_FONT_LINK_ID_PREFIX}${encodeURIComponent(url)}`;
    const existing = this.document.getElementById(id) as HTMLLinkElement | null;
    const link = existing ?? this.document.createElement('link');
    if (!existing) {
      link.id = id;
      link.rel = 'stylesheet';
      link.href = url;
    }
    let loaded = this.stylesheets.get(link);
    if (!loaded) {
      loaded = this.waitForStylesheet(link);
      this.stylesheets.set(link, loaded);
    }
    if (!existing) this.document.head.appendChild(link);
    return loaded;
  }

  private printRoots(bodyClass: string): HTMLElement[] {
    let wrapper = '';
    if (bodyClass === MKTG_FAMILY_PRINT_BODY_CLASS) wrapper = MKTG_FAMILY_PRINT_ONLY_CLASS;
    if (bodyClass === BRAND_KIT_PRINT_BODY_CLASS) wrapper = BRAND_KIT_PRINT_ONLY_CLASS;
    if (bodyClass === FOUNDATION_MESSAGE_PRINT_BODY_CLASS) wrapper = FOUNDATION_MESSAGE_PRINT_ONLY_CLASS;
    return wrapper ? Array.from(this.document.querySelectorAll<HTMLElement>(`.${wrapper}`)) : [];
  }

  /**
   * The page setup this print gets, by the stylesheets' test (only the kit's legacy book is landscape),
   * and the engine's: the portrait pages print with no margin, or on their margins where the
   * documents' per-page room cannot repeat (`pageMargins`: WebKit).
   */
  private pageSetup(bodyClass: string, roots: HTMLElement[], pageMargins: boolean): string {
    // Fixed US Letter frames (the portrait grammar) are the whole sheet in both engines: no margin, whatever the engine
    // repeats, and never the page margins.
    if (this.hasPortraitFrames(roots)) return MKTG_PRINT_PAGE_SETUPS['mktg-portrait'];
    const portrait = roots.some((root) => root.classList.contains(BRAND_KIT_PORTRAIT_PRINT_CLASS) || root.querySelector(`.${BRAND_KIT_PORTRAIT_PRINT_CLASS}`));
    const book = bodyClass === BRAND_KIT_PRINT_BODY_CLASS && !portrait;
    if (book) return MKTG_PRINT_PAGE_SETUPS['brand-kit'];
    return pageMargins ? MKTG_PRINT_PAGE_SETUPS['mktg-framework-page-margins'] : MKTG_PRINT_PAGE_SETUPS['mktg-framework'];
  }

  /** Whether a print root is, or holds, a document of portrait frames (`MKTG_PORTRAIT_PRINT_CLASS`). */
  private hasPortraitFrames(roots: HTMLElement[]): boolean {
    return roots.some((root) => root.classList.contains(MKTG_PORTRAIT_PRINT_CLASS) || root.querySelector(`.${MKTG_PORTRAIT_PRINT_CLASS}`) !== null);
  }

  /** Inline handlers would be the frame's only script; the clone carries none. */
  private stripHandlers(element: Element): void {
    Array.from(element.attributes)
      .filter((attribute) => attribute.name.startsWith('on'))
      .forEach((attribute) => element.removeAttribute(attribute.name));
  }

  private waitForStylesheet(link: HTMLLinkElement): Promise<void> {
    if (link.sheet || link.disabled) return Promise.resolve();
    return new Promise((resolve) => {
      const settled = () => {
        clearTimeout(timer);
        link.removeEventListener('load', settled);
        link.removeEventListener('error', settled);
        resolve();
      };
      const timer = setTimeout(settled, MKTG_PRINT_FONT_WAIT_MS);
      link.addEventListener('load', settled, { once: true });
      link.addEventListener('error', settled, { once: true });
    });
  }

  private async loadFont(doc: Document, family: string | null, weights: readonly number[]): Promise<void> {
    if (!family || !doc.fonts) return;
    await Promise.allSettled(weights.map((weight) => doc.fonts.load(`${weight} 1em "${family}"`)));
  }

  /** One total budget, not one full timeout per resource/phase. */
  private async bounded(work: () => Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, MKTG_PRINT_FONT_WAIT_MS);
    });
    await Promise.race([work().catch((error: unknown) => console.warn('[mktg-print] print preparation failed', error)), timeout]);
    clearTimeout(timer);
  }
}
