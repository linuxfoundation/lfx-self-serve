// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BRAND_KIT_PORTRAIT_PRINT_CLASS,
  BRAND_KIT_PRINT_BODY_CLASS,
  BRAND_KIT_PRINT_ONLY_CLASS,
  FOUNDATION_MESSAGE_PRINT_BODY_CLASS,
  FOUNDATION_MESSAGE_PRINT_ONLY_CLASS,
  MKTG_FAMILY_PRINT_BODY_CLASS,
  MKTG_FAMILY_PRINT_ONLY_CLASS,
  MKTG_PORTRAIT_PAGE_NAME,
  MKTG_PORTRAIT_PRINT_CLASS,
  MKTG_PRINT_FONT_LINK_ID_PREFIX,
  MKTG_PRINT_FONT_WAIT_MS,
  MKTG_PRINT_FRAME_LINGER_MS,
  MKTG_PRINT_FRAME_PAPER_IN,
  MKTG_PRINT_PAGE_MARGINS_CLASS,
  MKTG_PRINT_PAGE_SETUPS,
} from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
import { MktgPrintService } from './mktg-print.service';

describe('MktgPrintService isolated frame', () => {
  let service: MktgPrintService;
  let root: HTMLDivElement;
  let parentPrint: ReturnType<typeof vi.spyOn>;
  const framePrint = vi.fn();
  const frameFocus = vi.fn();
  const frameStop = vi.fn();
  const frameFont = vi.fn(() => Promise.resolve([]));
  const parentFont = vi.fn(() => Promise.resolve([]));
  const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');

  function configure(platformId: 'browser' | 'server' = 'browser') {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platformId }] });
    service = TestBed.inject(MktgPrintService);
    return service;
  }
  function currentFrame(): HTMLIFrameElement {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="lfx-print-frame"]');
    if (!frame?.contentDocument || !frame.contentWindow) throw new Error('Missing synthetic print frame');
    return frame;
  }
  /** The frame's own unnamed @page rule: the last style in its head, after the cloned sheets. */
  function framePageRule(): string | null {
    const styles = currentFrame().contentDocument?.head.querySelectorAll('style') ?? [];
    return styles[styles.length - 1]?.textContent ?? null;
  }
  async function releaseFrame() {
    currentFrame()
      .contentDocument?.querySelectorAll('link[rel="stylesheet"]')
      .forEach((link) => link.dispatchEvent(new Event('load')));
    await vi.advanceTimersByTimeAsync(0);
  }

  /** The frame reads the engine from its own window's user agent, once, at print time. */
  function printAs(userAgent: string) {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    printAs(CHROME_UA);
    parentPrint = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    Object.defineProperty(document, 'fonts', { value: { load: parentFont }, configurable: true });
    root = document.createElement('div');
    root.className = FOUNDATION_MESSAGE_PRINT_ONLY_CLASS;
    root.innerHTML = '<section class="lfx-framework-print" data-testid="synthetic-print"><h1>Synthetic print</h1></section>';
    document.body.appendChild(root);
    const append = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      const result = append(node);
      if (node instanceof HTMLIFrameElement && node.contentWindow && node.contentDocument) {
        node.contentWindow.print = framePrint;
        // As in a browser, focusing the frame window makes the frame element the page's active element.
        node.contentWindow.focus = (...args: []) => {
          frameFocus(...args);
          node.focus();
        };
        node.contentWindow.stop = frameStop;
        Object.defineProperty(node.contentDocument, 'fonts', { value: { load: frameFont }, configurable: true });
      }
      return result;
    });
  });

  afterEach(() => {
    service?.clear();
    document.head.querySelectorAll('[data-print-fixture], link[id^="brand-kit-font-"]').forEach((node) => node.remove());
    root.remove();
    delete (document as unknown as Record<string, unknown>)['fonts'];
    vi.restoreAllMocks();
    if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
    else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)['decode'];
    vi.useRealTimers();
  });

  it.each([
    [FOUNDATION_MESSAGE_PRINT_BODY_CLASS, FOUNDATION_MESSAGE_PRINT_ONLY_CLASS, MKTG_PRINT_PAGE_SETUPS['mktg-framework']],
    [BRAND_KIT_PRINT_BODY_CLASS, BRAND_KIT_PRINT_ONLY_CLASS, MKTG_PRINT_PAGE_SETUPS['brand-kit']],
    [MKTG_FAMILY_PRINT_BODY_CLASS, MKTG_FAMILY_PRINT_ONLY_CLASS, MKTG_PRINT_PAGE_SETUPS['mktg-framework']],
  ])('creates only the %s print root immediately, then prints the idle frame, never the app window', async (bodyClass, wrapper, pageSetup) => {
    root.className = wrapper;
    root.innerHTML += '<script type="text/plain">not copied</script><img onerror="window.synthetic = true">';
    configure().printNow(bodyClass);
    const frame = currentFrame();
    expect(frame.style.display).not.toBe('none');
    expect(frame.style.position).toBe('fixed');
    // Paper-sized, not 1px: WebKit resolves the print document's vh against the frame's own viewport.
    expect(frame.style.width).toBe(`${MKTG_PRINT_FRAME_PAPER_IN.width}in`);
    expect(frame.style.height).toBe(`${MKTG_PRINT_FRAME_PAPER_IN.height}in`);
    expect(frame.style.opacity).toBe('0');
    expect(frame.style.pointerEvents).toBe('none');
    // The surface's page setup, written unnamed so WebKit applies it whether or not it honours named pages.
    expect(framePageRule()).toBe(`@page { ${pageSetup} }`);
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.contentDocument?.body.classList.contains(bodyClass)).toBe(true);
    expect(frame.contentDocument?.querySelector('[data-testid="synthetic-print"]')?.textContent).toBe('Synthetic print');
    expect(frame.contentDocument?.querySelector('script, [onerror]')).toBeNull();
    expect(frame.contentDocument?.querySelector('lfx-root')).toBeNull();
    expect(framePrint).not.toHaveBeenCalled();
    await releaseFrame();
    expect(frameStop).toHaveBeenCalledOnce();
    expect(frameFocus).toHaveBeenCalledOnce();
    expect(framePrint).toHaveBeenCalledOnce();
    expect(parentPrint).not.toHaveBeenCalled();
  });

  it('gives the brand kit portrait print the framework page setup, as the stylesheets do, not the landscape book', () => {
    root.className = BRAND_KIT_PRINT_ONLY_CLASS;
    root.innerHTML = `<section class="${BRAND_KIT_PORTRAIT_PRINT_CLASS}" data-testid="synthetic-print">Synthetic print</section>`;
    configure().printNow(BRAND_KIT_PRINT_BODY_CLASS);
    expect(framePageRule()).toBe(`@page { ${MKTG_PRINT_PAGE_SETUPS['mktg-framework']} }`);
  });

  it.each([
    ['Chromium', CHROME_UA],
    ['WebKit', SAFARI_UA],
  ])("in %s gives a document of portrait frames US Letter with no margin, unnamed and as the frames' own named page", (_engine, userAgent) => {
    printAs(userAgent);
    root.className = BRAND_KIT_PRINT_ONLY_CLASS;
    root.innerHTML = `<div class="${BRAND_KIT_PORTRAIT_PRINT_CLASS} ${MKTG_PORTRAIT_PRINT_CLASS}"><section class="pp-page" data-page="1">Synthetic frame</section></div>`;
    configure().printNow(BRAND_KIT_PRINT_BODY_CLASS);
    const setup = MKTG_PRINT_PAGE_SETUPS['mktg-portrait'];
    expect(setup).toBe('size: auto; margin: 0;');
    expect(framePageRule()).toBe(`@page { ${setup} }\n@page ${MKTG_PORTRAIT_PAGE_NAME} { ${setup} }`);
    expect(framePageRule()).not.toContain('@page mktg-framework');
    // No page margins in either engine: the flowing parts beside the frames keep their own room.
    expect(currentFrame().contentDocument?.body.classList.contains(MKTG_PRINT_PAGE_MARGINS_CLASS)).toBe(false);
  });

  it('in the family print, the portrait frames set the page too', () => {
    printAs(SAFARI_UA);
    root.className = MKTG_FAMILY_PRINT_ONLY_CLASS;
    root.innerHTML = `<section class="${MKTG_PORTRAIT_PRINT_CLASS}"><section class="pp-page" data-page="1">Synthetic frame</section></section>`;
    configure().printNow(MKTG_FAMILY_PRINT_BODY_CLASS);
    expect(framePageRule()).toContain(`@page ${MKTG_PORTRAIT_PAGE_NAME} { ${MKTG_PRINT_PAGE_SETUPS['mktg-portrait']} }`);
    expect(framePageRule()).not.toContain('0.55in');
  });

  it('prints every page with no margin, where the browser would draw its header and footer', () => {
    root.className = FOUNDATION_MESSAGE_PRINT_ONLY_CLASS;
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    const rule = framePageRule();
    expect(rule).toContain('margin: 0;');
    expect(rule).toContain('size: portrait;');
    expect(rule).not.toMatch(/margin: [0-9.]+(in|cm|mm|pt|px)/);
    expect(currentFrame().contentDocument?.body.classList.contains(MKTG_PRINT_PAGE_MARGINS_CLASS)).toBe(false);
  });

  it.each([
    [FOUNDATION_MESSAGE_PRINT_BODY_CLASS, FOUNDATION_MESSAGE_PRINT_ONLY_CLASS],
    [MKTG_FAMILY_PRINT_BODY_CLASS, MKTG_FAMILY_PRINT_ONLY_CLASS],
  ])('in WebKit, which prints a table head and foot once, gives the %s print its page margins and collapses the room', (bodyClass, wrapper) => {
    printAs(SAFARI_UA);
    root.className = wrapper;
    configure().printNow(bodyClass);
    const setup = MKTG_PRINT_PAGE_SETUPS['mktg-framework-page-margins'];
    expect(setup).toBe('size: portrait; margin: 0.55in 0.6in;');
    // The unnamed rule, and the named one restated after the cloned sheets: no engine prints the margin-less setup.
    expect(framePageRule()).toBe(`@page { ${setup} }\n@page mktg-framework { ${setup} }`);
    expect(currentFrame().contentDocument?.body.classList.contains(MKTG_PRINT_PAGE_MARGINS_CLASS)).toBe(true);
    expect(document.body.classList.contains(MKTG_PRINT_PAGE_MARGINS_CLASS)).toBe(false);
  });

  it("in WebKit keeps the kit's legacy book on its own landscape setup, never restated into the framework's page", () => {
    printAs(SAFARI_UA);
    root.className = BRAND_KIT_PRINT_ONLY_CLASS;
    configure().printNow(BRAND_KIT_PRINT_BODY_CLASS);
    expect(framePageRule()).toBe(`@page { ${MKTG_PRINT_PAGE_SETUPS['brand-kit']} }`);
    expect(framePageRule()).not.toContain('@page mktg-framework');
    expect(currentFrame().contentDocument?.body.classList.contains(MKTG_PRINT_PAGE_MARGINS_CLASS)).toBe(true);
  });

  it('copies head CSS, base and page classes, but never scripts or interactive shell content', async () => {
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = '/synthetic-print.css';
    sheet.setAttribute('data-print-fixture', 'sheet');
    sheet.setAttribute('onload', 'window.synthetic = true');
    const style = document.createElement('style');
    style.setAttribute('data-print-fixture', 'style');
    style.setAttribute('onerror', 'window.synthetic = true');
    style.textContent = '@page synthetic { margin: 1cm; }';
    const script = document.createElement('script');
    script.type = 'text/plain';
    script.setAttribute('data-print-fixture', 'script');
    document.head.append(sheet, style, script);
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    const doc = currentFrame().contentDocument;
    expect(doc?.documentElement.className).toBe(document.documentElement.className);
    for (const name of Array.from(document.body.classList)) expect(doc?.body.classList.contains(name)).toBe(true);
    expect(doc?.body.classList.contains(FOUNDATION_MESSAGE_PRINT_BODY_CLASS)).toBe(true);
    expect(document.body.classList.contains(FOUNDATION_MESSAGE_PRINT_BODY_CLASS)).toBe(false);
    expect(doc?.querySelector('base')?.href).toBe(document.baseURI);
    expect(doc?.head.querySelector('[data-print-fixture="sheet"]')?.getAttribute('href')).toBe('/synthetic-print.css');
    expect(doc?.head.querySelector('[data-print-fixture="style"]')?.textContent).toContain('@page synthetic');
    expect(doc?.head.querySelector('[onload], [onerror]')).toBeNull();
    expect(doc?.querySelector('script')).toBeNull();
    // The frame's own @page rule follows every cloned sheet.
    expect(doc?.head.lastElementChild?.textContent).toBe(`@page { ${MKTG_PRINT_PAGE_SETUPS['mktg-framework']} }`);
    await releaseFrame();
    expect(framePrint).toHaveBeenCalledOnce();
  });

  it('titles the frame as the caller names the PDF, and after the page when the caller names nothing', () => {
    document.title = 'Document · LFX';
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'Synthetic Foundation · Messaging framework · v2 · 2026-11-05');
    expect(currentFrame().contentDocument?.title).toBe('Synthetic Foundation · Messaging framework · v2 · 2026-11-05');
    // The tab keeps its own title until the dialog opens: the frame is still loading here.
    expect(document.title).toBe('Document · LFX');
    service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    expect(currentFrame().contentDocument?.title).toBe('Document · LFX');
  });

  it('names the tab as the PDF while the dialog is open, for Chromium, and gives its title back on afterprint', async () => {
    document.title = 'Document · LFX';
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'Synthetic Foundation · Brand kit · v1 · 2026-11-05');
    await releaseFrame();
    expect(framePrint).toHaveBeenCalledOnce();
    expect(document.title).toBe('Synthetic Foundation · Brand kit · v1 · 2026-11-05');
    currentFrame().contentWindow?.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe('Document · LFX');
    // Restored once: a later cleanup path (the linger timer is cleared; clear() finds no frame) leaves it.
    service.clear();
    vi.advanceTimersByTime(MKTG_PRINT_FRAME_LINGER_MS);
    expect(document.title).toBe('Document · LFX');
  });

  it.each([
    ['the linger fallback', () => vi.advanceTimersByTime(MKTG_PRINT_FRAME_LINGER_MS)],
    ['a superseding print', () => service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS)],
    ['clear()', () => service.clear()],
  ])('gives the tab its title back on %s too, when afterprint never comes', async (_path, teardown) => {
    document.title = 'Document · LFX';
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'Synthetic Foundation · Brand kit · v1 · 2026-11-05');
    await releaseFrame();
    expect(document.title).toBe('Synthetic Foundation · Brand kit · v1 · 2026-11-05');
    teardown();
    expect(document.title).toBe('Document · LFX');
  });

  it('leaves a title the app changed while the dialog was open, and never touches the tab when the caller names nothing', async () => {
    document.title = 'Document · LFX';
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'Synthetic Foundation · Brand kit · v1 · 2026-11-05');
    await releaseFrame();
    document.title = 'Positioning & brand · LFX';
    currentFrame().contentWindow?.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe('Positioning & brand · LFX');
    service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await releaseFrame();
    expect(framePrint).toHaveBeenCalledTimes(2);
    expect(document.title).toBe('Positioning & brand · LFX');
    currentFrame().contentWindow?.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe('Positioning & brand · LFX');
  });

  it('waits for the cloned sheet before frame fonts and image decode, within one total cap', async () => {
    configure();
    const loaded = service.ensureFontStylesheet('https://fonts.example/print.css');
    document.head.querySelector('link[id^="brand-kit-font-"]')?.dispatchEvent(new Event('load'));
    await loaded;
    await service.prepare('Synthetic Font', [700]);
    let decode: () => void = () => undefined;
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      value: vi.fn(() => new Promise<void>((resolve) => (decode = resolve))),
      configurable: true,
    });
    root.innerHTML += '<img src="/images/synthetic.svg">';
    service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await vi.advanceTimersByTimeAsync(0);
    expect(frameFont).not.toHaveBeenCalled();
    await releaseFrame();
    expect(frameFont).toHaveBeenCalledWith('700 1em "Synthetic Font"');
    expect(framePrint).not.toHaveBeenCalled();
    decode();
    await vi.advanceTimersByTimeAsync(0);
    expect(framePrint).toHaveBeenCalledOnce();
  });

  it('stops stalled frame loaders and prints at the cap, then removes the frame if iOS omits afterprint', async () => {
    configure().ensureFontStylesheet('https://fonts.example/blocked.css');
    service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await vi.advanceTimersByTimeAsync(MKTG_PRINT_FONT_WAIT_MS - 1);
    expect(framePrint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(frameStop).toHaveBeenCalledOnce();
    expect(framePrint).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(MKTG_PRINT_FRAME_LINGER_MS - 1);
    expect(document.querySelector('[data-testid="lfx-print-frame"]')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(document.querySelector('[data-testid="lfx-print-frame"]')).toBeNull();
  });

  it('removes the frame on afterprint, never marks the app body for print, and returns focus to the opening control', async () => {
    const button = document.createElement('button');
    button.textContent = 'Download PDF';
    document.body.appendChild(button);
    button.focus();
    const refocus = vi.spyOn(button, 'focus');
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await releaseFrame();
    expect(frameFocus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(currentFrame());
    expect(refocus).not.toHaveBeenCalled();
    currentFrame().contentWindow?.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('[data-testid="lfx-print-frame"]')).toBeNull();
    expect(document.body.classList.contains(FOUNDATION_MESSAGE_PRINT_BODY_CLASS)).toBe(false);
    expect(refocus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it.each([
    ['afterprint', (frame: HTMLIFrameElement) => frame.contentWindow?.dispatchEvent(new Event('afterprint'))],
    ['the linger fallback', () => vi.advanceTimersByTime(MKTG_PRINT_FRAME_LINGER_MS)],
    ['a superseding print', () => service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS)],
    ['clear()', () => service.clear()],
  ])('does not steal focus on %s from a field the user moved to', async (_path, teardown) => {
    const button = document.createElement('button');
    const field = document.createElement('input');
    document.body.append(button, field);
    button.focus();
    const refocus = vi.spyOn(button, 'focus');
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await releaseFrame();
    const frame = currentFrame();
    field.focus();
    teardown(frame);
    expect(frame.isConnected).toBe(false);
    expect(refocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
    button.remove();
    field.remove();
  });

  it('does not refocus a control that left the page while the dialog was open', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    const refocus = vi.spyOn(button, 'focus');
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await releaseFrame();
    button.remove();
    currentFrame().contentWindow?.dispatchEvent(new Event('afterprint'));
    expect(refocus).not.toHaveBeenCalled();
  });

  it('warns, rather than swallowing, when a resource wait throws, and still resolves and prints', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    configure();
    parentFont.mockImplementationOnce(() => {
      throw new Error('Synthetic face failure');
    });
    await service.prepare('Synthetic Font', [400]);
    expect(warn).toHaveBeenCalledWith('[mktg-print] print preparation failed', expect.any(Error));
    service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await releaseFrame();
    expect(framePrint).toHaveBeenCalledOnce();
  });

  it('replaces an older frame and clear cancels a frame still waiting for resources', async () => {
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    const old = currentFrame();
    service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    expect(old.isConnected).toBe(false);
    expect(currentFrame()).not.toBe(old);
    service.clear();
    await vi.advanceTimersByTimeAsync(MKTG_PRINT_FONT_WAIT_MS);
    expect(framePrint).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="lfx-print-frame"]')).toBeNull();
  });

  it('prints at the frame cap even if a requested face never arrives', async () => {
    configure();
    await service.prepare('Synthetic Font', [400]);
    frameFont.mockReturnValueOnce(new Promise(() => undefined));
    service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await releaseFrame();
    expect(framePrint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MKTG_PRINT_FONT_WAIT_MS);
    expect(frameStop).toHaveBeenCalledOnce();
    expect(framePrint).toHaveBeenCalledOnce();
  });

  it('deduplicates font preparation and awaits the font sheet before requesting any face', async () => {
    configure();
    const url = 'https://fonts.example/synthetic.css';
    const sheet = service.ensureFontStylesheet(url);
    expect(service.ensureFontStylesheet(url)).toBe(sheet);
    const prepared = service.prepare('Synthetic Font', [600, 400]);
    expect(service.prepare('Synthetic Font', [400, 600, 600])).toBe(prepared);
    await vi.advanceTimersByTimeAsync(0);
    expect(parentFont).not.toHaveBeenCalled();
    document.head.querySelector(`link[id="${MKTG_PRINT_FONT_LINK_ID_PREFIX}${encodeURIComponent(url)}"]`)?.dispatchEvent(new Event('load'));
    await prepared;
    expect(parentFont.mock.calls).toEqual([['400 1em "Synthetic Font"'], ['600 1em "Synthetic Font"']]);
    expect(framePrint).not.toHaveBeenCalled();
  });

  it.each(['load', 'error'])('settles an existing font sheet on %s and accepts an already loaded sheet immediately', async (event) => {
    configure();
    const url = 'https://fonts.example/existing.css';
    const link = document.createElement('link');
    link.id = `${MKTG_PRINT_FONT_LINK_ID_PREFIX}${encodeURIComponent(url)}`;
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
    const pending = service.ensureFontStylesheet(url);
    link.dispatchEvent(new Event(event));
    await pending;
    Object.defineProperty(link, 'sheet', { value: {}, configurable: true });
    TestBed.resetTestingModule();
    await configure().ensureFontStylesheet(url);
    expect(document.head.querySelectorAll(`[id="${link.id}"]`)).toHaveLength(1);
  });

  it('caps page font preparation at the wait budget', async () => {
    configure();
    parentFont.mockReturnValueOnce(new Promise(() => undefined));
    let settled = false;
    const prepared = service.prepare('Synthetic Font', [400]).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(MKTG_PRINT_FONT_WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await prepared;
    expect(settled).toBe(true);
    expect(framePrint).not.toHaveBeenCalled();
  });

  it('does nothing on the server', async () => {
    configure('server');
    await service.ensureFontStylesheet('https://fonts.example/server.css');
    await service.prepare('Synthetic Font');
    service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    service.clear();
    expect(parentPrint).not.toHaveBeenCalled();
    expect(framePrint).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="lfx-print-frame"]')).toBeNull();
    expect(document.head.querySelector('link[id^="brand-kit-font-"]')).toBeNull();
  });
});
