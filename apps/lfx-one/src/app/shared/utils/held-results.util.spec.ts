// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHeldResults } from './held-results.util';

interface Res {
  held: boolean;
  n: number;
}

describe('createHeldResults', () => {
  const flush = (): void => TestBed.inject(ApplicationRef).tick();
  const base = { isHeld: (r: Res) => r.held, retryMs: 1000, maxAttempts: 3, errorMessage: 'load failed' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never loads while the key is null', () => {
    const load = vi.fn(() => of<Res>({ held: false, n: 1 }));
    const h = TestBed.runInInjectionContext(() => createHeldResults({ ...base, key: signal<string | null>(null), load }));
    flush();
    expect(load).not.toHaveBeenCalled();
    expect(h.results()).toBeNull();
    expect(h.loading()).toBe(false);
  });

  it('loads once per period: not again on later ticks, again after the key returns', () => {
    const key = signal<string | null>(null);
    let n = 0;
    const load = vi.fn(() => of<Res>({ held: false, n: ++n }));
    const h = TestBed.runInInjectionContext(() => createHeldResults({ ...base, key, load }));
    key.set('a');
    flush();
    vi.advanceTimersByTime(10000);
    flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(h.results()?.n).toBe(1);
    expect(h.loading()).toBe(false);
    key.set(null);
    flush();
    expect(h.results()).toBeNull();
    key.set('a');
    flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('re-requests a held payload until released, within the attempt cap', () => {
    const key = signal<string | null>('a');
    let n = 0;
    const load = vi.fn(() => of<Res>({ held: ++n < 3, n }));
    const h = TestBed.runInInjectionContext(() => createHeldResults({ ...base, key, load }));
    flush();
    expect(h.results()?.held).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(load).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(h.results()).toEqual({ held: false, n: 3 });
    vi.advanceTimersByTime(5000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('stops retrying a held payload at maxAttempts', () => {
    const load = vi.fn(() => of<Res>({ held: true, n: 1 }));
    TestBed.runInInjectionContext(() => createHeldResults({ ...base, key: signal<string | null>('a'), load }));
    flush();
    vi.advanceTimersByTime(60000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('sets error on a failed first load and keeps the held payload on a failed retry', () => {
    const failing = TestBed.runInInjectionContext(() =>
      createHeldResults({ ...base, key: signal<string | null>('a'), load: () => throwError(() => new Error('x')) })
    );
    flush();
    expect(failing.error()).toBe(true);
    expect(failing.results()).toBeNull();
    expect(failing.loading()).toBe(false);

    let calls = 0;
    const held = TestBed.runInInjectionContext(() =>
      createHeldResults({
        ...base,
        key: signal<string | null>('b'),
        load: () => (++calls === 1 ? of<Res>({ held: true, n: 1 }) : throwError(() => new Error('x'))),
      })
    );
    flush();
    vi.advanceTimersByTime(1000);
    expect(held.results()).toEqual({ held: true, n: 1 });
    expect(held.error()).toBe(false);
  });
});
