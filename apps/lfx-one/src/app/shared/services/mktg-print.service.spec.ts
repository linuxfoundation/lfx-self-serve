// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MKTG_PRINT_FONT_WAIT_MS } from '@lfx-one/shared/constants';
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

  it('loads the brand’s typeface before the dialog opens', async () => {
    const service = configure();
    const doc = TestBed.inject(DOCUMENT);
    const load = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(doc, 'fonts', { value: { load }, configurable: true });
    try {
      await service.print(CLASS, "'Space Grotesk'");

      expect(load).toHaveBeenCalledWith('400 1em "Space Grotesk"');
      expect(load).toHaveBeenCalledWith('600 1em "Space Grotesk"');
      expect(print).toHaveBeenCalledOnce();
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
    await configure('server').print(CLASS);

    expect(print).not.toHaveBeenCalled();
    expect(document.body.classList.contains(CLASS)).toBe(false);
  });

  it('takes the class off the body for a view that goes while the dialog is up', () => {
    document.body.classList.add(CLASS);
    configure().clear(CLASS);

    expect(document.body.classList.contains(CLASS)).toBe(false);
  });
});
