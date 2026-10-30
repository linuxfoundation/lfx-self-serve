// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BRAND_KIT_PRINT_BODY_CLASS,
  BRAND_KIT_PRINT_ONLY_CLASS,
  FOUNDATION_MESSAGE_PRINT_BODY_CLASS,
  FOUNDATION_MESSAGE_PRINT_ONLY_CLASS,
  MKTG_FAMILY_PRINT_BODY_CLASS,
  MKTG_FAMILY_PRINT_ONLY_CLASS,
  MKTG_PRINT_FONT_LINK_ID_PREFIX,
  MKTG_PRINT_FONT_WAIT_MS,
  MKTG_PRINT_FRAME_LINGER_MS,
} from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  async function releaseFrame() {
    currentFrame()
      .contentDocument?.querySelectorAll('link[rel="stylesheet"]')
      .forEach((link) => link.dispatchEvent(new Event('load')));
    await vi.advanceTimersByTimeAsync(0);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
        node.contentWindow.focus = frameFocus;
        node.contentWindow.stop = frameStop;
        Object.defineProperty(node.contentDocument, 'fonts', { value: { load: frameFont }, configurable: true });
      }
      return result;
    });
  });

  afterEach(() => {
    service?.clear(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    document.body.classList.remove(BRAND_KIT_PRINT_BODY_CLASS, MKTG_FAMILY_PRINT_BODY_CLASS);
    document.head.querySelectorAll('[data-print-fixture], link[id^="brand-kit-font-"]').forEach((node) => node.remove());
    root.remove();
    delete (document as unknown as Record<string, unknown>)['fonts'];
    vi.restoreAllMocks();
    if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
    else delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)['decode'];
    vi.useRealTimers();
  });

  it.each([
    [FOUNDATION_MESSAGE_PRINT_BODY_CLASS, FOUNDATION_MESSAGE_PRINT_ONLY_CLASS],
    [BRAND_KIT_PRINT_BODY_CLASS, BRAND_KIT_PRINT_ONLY_CLASS],
    [MKTG_FAMILY_PRINT_BODY_CLASS, MKTG_FAMILY_PRINT_ONLY_CLASS],
  ])('creates only the %s print root immediately, then prints the idle frame, never the app window', async (bodyClass, wrapper) => {
    root.className = wrapper;
    root.innerHTML += '<script type="text/plain">not copied</script><img onerror="window.synthetic = true">';
    configure().printNow(bodyClass);
    const frame = currentFrame();
    expect(frame.style.display).not.toBe('none');
    expect(frame.style.position).toBe('fixed');
    expect(frame.style.width).toBe('1px');
    expect(frame.style.opacity).toBe('0');
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

  it('copies head CSS, base and page classes, but never scripts or interactive shell content', async () => {
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = '/synthetic-print.css';
    sheet.setAttribute('data-print-fixture', 'sheet');
    const style = document.createElement('style');
    style.setAttribute('data-print-fixture', 'style');
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
    expect(doc?.querySelector('script')).toBeNull();
    await releaseFrame();
    expect(framePrint).toHaveBeenCalledOnce();
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

  it('removes the frame on afterprint without ever marking the app body for print', async () => {
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await releaseFrame();
    currentFrame().contentWindow?.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('[data-testid="lfx-print-frame"]')).toBeNull();
    expect(document.body.classList.contains(FOUNDATION_MESSAGE_PRINT_BODY_CLASS)).toBe(false);
  });

  it('replaces an older frame and clear cancels a frame still waiting for resources', async () => {
    configure().printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    const old = currentFrame();
    service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    expect(old.isConnected).toBe(false);
    expect(currentFrame()).not.toBe(old);
    service.clear(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await vi.advanceTimersByTimeAsync(MKTG_PRINT_FONT_WAIT_MS);
    expect(framePrint).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="lfx-print-frame"]')).toBeNull();
  });

  it('printNow supersedes a compatibility print still awaiting preparation', async () => {
    configure();
    const old = service.print(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    const frame = currentFrame();
    await old;
    await releaseFrame();
    expect(currentFrame()).toBe(frame);
    expect(framePrint).toHaveBeenCalledOnce();
    expect(parentPrint).not.toHaveBeenCalled();
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

  it('caps parent font preparation and clear cancels its compatibility print', async () => {
    configure();
    parentFont.mockReturnValueOnce(new Promise(() => undefined));
    const printed = service.print(FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'Synthetic Font', [400]);
    await vi.advanceTimersByTimeAsync(0);
    service.clear(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await vi.advanceTimersByTimeAsync(MKTG_PRINT_FONT_WAIT_MS);
    await printed;
    expect(framePrint).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="lfx-print-frame"]')).toBeNull();
  });

  it('does nothing on the server', async () => {
    configure('server');
    await service.ensureFontStylesheet('https://fonts.example/server.css');
    await service.prepare('Synthetic Font');
    service.printNow(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await service.print(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    service.clear(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    expect(parentPrint).not.toHaveBeenCalled();
    expect(framePrint).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="lfx-print-frame"]')).toBeNull();
    expect(document.head.querySelector('link[id^="brand-kit-font-"]')).toBeNull();
  });
});
