// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MKTG_PRINT_FONT_LINK_ID_PREFIX, MKTG_PRINT_FONT_WAIT_MS } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgPrintService } from './mktg-print.service';

/**
 * Download PDF is the browser's print with one document alone on paper: the
 * body carries the asset's print class for as long as the dialog is up, the
 * brand's typeface is loaded first (capped), and nothing happens on the
 * server.
 */
describe('MktgPrintService', () => {
  const CLASS = 'lfx-print-test';
  let print: ReturnType<typeof vi.spyOn>;

  function configure(platformId: 'browser' | 'server' = 'browser'): MktgPrintService {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platformId }] });
    return TestBed.inject(MktgPrintService);
  }

  beforeEach(() => {
    print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
  });

  afterEach(() => {
    print.mockRestore();
    document.body.classList.remove(CLASS);
    vi.useRealTimers();
  });

  it('marks the body for the print, opens the dialog, and unmarks it when the print ends', async () => {
    await configure().print(CLASS);

    expect(print).toHaveBeenCalledOnce();
    expect(document.body.classList.contains(CLASS)).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains(CLASS)).toBe(false);
  });

  it('printNow opens the dialog synchronously and cancels an older asynchronous print', async () => {
    const service = configure();
    const pending = service.print('old-print');
    service.printNow(CLASS);
    expect(print).toHaveBeenCalledOnce();
    expect(document.body.classList.contains(CLASS)).toBe(true);
    await pending;
    expect(print).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('old-print')).toBe(false);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains(CLASS)).toBe(false);
  });

  it('deduplicates font preparation by family and weight set without printing', async () => {
    const service = configure();
    const doc = TestBed.inject(DOCUMENT);
    const load = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(doc, 'fonts', { value: { load }, configurable: true });
    try {
      const first = service.prepare('Synthetic Font', [600, 400]);
      expect(service.prepare('Synthetic Font', [400, 600, 600])).toBe(first);
      await first;
      expect(service.prepare('Synthetic Font', [400, 600])).toBe(first);
      expect(load).toHaveBeenCalledTimes(2);
      expect(print).not.toHaveBeenCalled();
      await service.prepare('Synthetic Font', [700]);
      expect(load).toHaveBeenCalledTimes(3);
    } finally {
      delete (doc as unknown as Record<string, unknown>)['fonts'];
    }
  });

  it('loads the brand’s typeface before the dialog opens', async () => {
    const service = configure();
    const doc = TestBed.inject(DOCUMENT);
    const load = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(doc, 'fonts', { value: { load }, configurable: true });
    try {
      await service.print(CLASS, "'Space Grotesk'");

      expect(load.mock.calls).toEqual([['400 1em "Space Grotesk"'], ['500 1em "Space Grotesk"'], ['600 1em "Space Grotesk"']]);
      expect(print).toHaveBeenCalledOnce();
    } finally {
      delete (doc as unknown as Record<string, unknown>)['fonts'];
    }
  });

  it('waits for the weights a print names, when it names them', async () => {
    const service = configure();
    const doc = TestBed.inject(DOCUMENT);
    const load = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(doc, 'fonts', { value: { load }, configurable: true });
    try {
      await service.print(CLASS, 'Montserrat', [300, 700]);

      expect(load.mock.calls).toEqual([['300 1em "Montserrat"'], ['700 1em "Montserrat"']]);
    } finally {
      delete (doc as unknown as Record<string, unknown>)['fonts'];
    }
  });

  it('opens the dialog anyway when the typeface never arrives', async () => {
    vi.useFakeTimers();
    const service = configure();
    const doc = TestBed.inject(DOCUMENT);
    Object.defineProperty(doc, 'fonts', { value: { load: vi.fn(() => new Promise(() => undefined)) }, configurable: true });
    try {
      const printed = service.print(CLASS, 'Space Grotesk');
      expect(print).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(MKTG_PRINT_FONT_WAIT_MS);
      await printed;

      expect(print).toHaveBeenCalledOnce();
    } finally {
      delete (doc as unknown as Record<string, unknown>)['fonts'];
    }
  });

  it('never prints for a view that went while the typeface was loading', async () => {
    const service = configure();
    const doc = TestBed.inject(DOCUMENT);
    let arrive: () => void = () => undefined;
    const face = new Promise<FontFace[]>((resolve) => {
      arrive = () => resolve([]);
    });
    Object.defineProperty(doc, 'fonts', { value: { load: vi.fn(() => face) }, configurable: true });
    try {
      const printed = service.print(CLASS, 'Space Grotesk');
      service.clear(CLASS);
      arrive();
      await printed;

      expect(print).not.toHaveBeenCalled();
      expect(document.body.classList.contains(CLASS)).toBe(false);
    } finally {
      delete (doc as unknown as Record<string, unknown>)['fonts'];
    }
  });

  it('does nothing on the server', async () => {
    const service = configure('server');
    await service.prepare('Synthetic Font');
    service.printNow(CLASS);
    await service.print(CLASS);

    expect(print).not.toHaveBeenCalled();
    expect(document.body.classList.contains(CLASS)).toBe(false);
  });

  it('adds a typeface’s stylesheet to the head once, whichever print asks first, and never on the server', () => {
    const url = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600&display=swap';
    const links = (): HTMLLinkElement[] => Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[id^="${MKTG_PRINT_FONT_LINK_ID_PREFIX}"]`));
    try {
      const service = configure();
      service.ensureFontStylesheet(url);
      service.ensureFontStylesheet(url);

      expect(links()).toHaveLength(1);
      expect(links()[0]).toMatchObject({ id: `${MKTG_PRINT_FONT_LINK_ID_PREFIX}${encodeURIComponent(url)}`, rel: 'stylesheet', href: url });

      TestBed.resetTestingModule();
      configure('server').ensureFontStylesheet(`${url}&server`);
      expect(links()).toHaveLength(1);
    } finally {
      links().forEach((link) => link.remove());
    }
  });

  it('takes the class off the body for a view that goes while the dialog is up', () => {
    document.body.classList.add(CLASS);
    configure().clear(CLASS);

    expect(document.body.classList.contains(CLASS)).toBe(false);
  });
});
