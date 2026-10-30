// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import {
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
} from '@lfx-one/shared/constants';

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

  /** Called in the click task; creates the frame immediately, then prints once its own loader is idle. */
  public printNow(bodyClass: string): void {
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
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:0;top:0;opacity:0;pointer-events:none;border:0';
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
    const cleanup = () => {
      clearTimeout(fallback);
      view.removeEventListener('afterprint', cleanup);
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
    doc.body.style.cssText = this.document.body.style.cssText;
    doc.title = this.document.title;
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
