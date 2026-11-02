// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CHUNK_LOAD_RELOAD_STORAGE_KEY, CHUNK_LOAD_RELOAD_WATCHDOG_MS, CHUNK_LOAD_RELOAD_WINDOW_MS } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChunkLoadRecoveryService } from './chunk-load-recovery.service';

describe('ChunkLoadRecoveryService', () => {
  const stored = new Map<string, string>();
  const reload = vi.fn();
  const read = vi.fn((key: string) => stored.get(key) ?? null);
  const write = vi.fn((key: string, value: string) => {
    stored.set(key, value);
  });
  let doc: Document;
  let service: ChunkLoadRecoveryService;

  const failure = () => new Error('Failed to fetch dynamically imported module');

  beforeEach(() => {
    stored.clear();
    reload.mockReset();
    read.mockClear();
    write.mockClear();
    doc = { defaultView: { sessionStorage: { getItem: read, setItem: write }, location: { reload } } } as unknown as Document;
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    TestBed.configureTestingModule({
      providers: [
        { provide: DOCUMENT, useValue: doc },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    service = TestBed.inject(ChunkLoadRecoveryService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes a persistent loop guard before the first automatic reload', () => {
    reload.mockImplementation(() => {
      expect(stored.has(CHUNK_LOAD_RELOAD_STORAGE_KEY)).toBe(true);
    });
    expect(service.handleError(failure())).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(stored.get(CHUNK_LOAD_RELOAD_STORAGE_KEY)).toBe('1000000');
    expect(service.reloading()).toBe(true);
    expect(service.needsReload()).toBe(false);
  });

  it('deduplicates router/global reports during an initiated reload', () => {
    service.handleError(failure());
    service.handleError(failure());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(service.needsReload()).toBe(false);
  });

  it('shows persistent recovery instead of reloading again in a fresh app instance', () => {
    service.handleError(failure());
    const nextInstance = TestBed.runInInjectionContext(() => new ChunkLoadRecoveryService());
    expect(nextInstance.handleError(failure())).toBe(true);
    expect(nextInstance.needsReload()).toBe(true);
    expect(nextInstance.reloading()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('permits a new automatic attempt after the window expires', () => {
    stored.set(CHUNK_LOAD_RELOAD_STORAGE_KEY, String(1_000_000 - CHUNK_LOAD_RELOAD_WINDOW_MS));
    service.handleError(failure());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each(['invalid', '0', '-1', 'Infinity', '1000001'])('requires manual recovery for invalid/future guard %s', (value) => {
    stored.set(CHUNK_LOAD_RELOAD_STORAGE_KEY, value);
    service.handleError(failure());
    expect(reload).not.toHaveBeenCalled();
    expect(service.needsReload()).toBe(true);
    service.reload();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(stored.get(CHUNK_LOAD_RELOAD_STORAGE_KEY)).toBe('1000000');
  });

  it.each(['read', 'write', 'storage'])('does not auto-reload when guard %s access fails', (part) => {
    if (part === 'read')
      read.mockImplementationOnce(() => {
        throw new Error('blocked');
      });
    if (part === 'write')
      write.mockImplementationOnce(() => {
        throw new Error('blocked');
      });
    if (part === 'storage')
      Object.defineProperty(doc.defaultView, 'sessionStorage', {
        get: () => {
          throw new Error('blocked');
        },
      });
    expect(() => service.handleError(failure())).not.toThrow();
    expect(service.needsReload()).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    service.reload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('prompts for bare NG0750 without assuming its cause is a missing download', () => {
    service.handleError(Object.assign(new Error('NG0750'), { code: -750 }));
    expect(service.needsReload()).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    service.handleError(failure());
    expect(reload).not.toHaveBeenCalled();
  });

  it('leaves ordinary errors to the existing reporting path', () => {
    expect(service.handleError(new Error('ordinary exception'))).toBe(false);
    expect(service.needsReload()).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('shows recovery if a reload itself throws', () => {
    reload.mockImplementationOnce(() => {
      throw new Error('navigation blocked');
    });
    expect(() => service.handleError(failure())).not.toThrow();
    expect(service.needsReload()).toBe(true);
    expect(service.reloading()).toBe(false);
  });

  it('restores manual recovery when an automatic reload returns without leaving the page', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    service.handleError(failure());
    expect(service.reloading()).toBe(true);
    vi.advanceTimersByTime(CHUNK_LOAD_RELOAD_WATCHDOG_MS - 1);
    expect(service.needsReload()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(service.reloading()).toBe(false);
    expect(service.needsReload()).toBe(true);
    service.handleError(failure());
    expect(reload).toHaveBeenCalledTimes(1);
    service.reload();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('unlocks a cancelled manual retry without clearing the persistent loop guard', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    service.handleError(Object.assign(new Error('NG0750'), { code: -750 }));
    service.reload();
    expect(service.reloading()).toBe(true);
    vi.advanceTimersByTime(CHUNK_LOAD_RELOAD_WATCHDOG_MS);
    expect(service.reloading()).toBe(false);
    expect(service.needsReload()).toBe(true);
    expect(stored.get(CHUNK_LOAD_RELOAD_STORAGE_KEY)).toBe('1000000');
    service.reload();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('clears the watchdog when the recovery service is destroyed', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    service.handleError(failure());
    expect(vi.getTimerCount()).toBe(1);
    TestBed.resetTestingModule();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not access browser state on the server', () => {
    TestBed.resetTestingModule();
    const access = vi.fn(() => {
      throw new Error('browser access during SSR');
    });
    const serverDocument = Object.defineProperty({}, 'defaultView', { get: access });
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: DOCUMENT, useValue: serverDocument },
      ],
    });
    const serverService = TestBed.inject(ChunkLoadRecoveryService);
    expect(serverService.handleError(failure())).toBe(false);
    serverService.reload();
    expect(access).not.toHaveBeenCalled();
    expect(serverService.needsReload()).toBe(false);
  });
});
