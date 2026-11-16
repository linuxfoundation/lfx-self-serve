// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLiveSnapshot } from './live-snapshot.util';

describe('createLiveSnapshot', () => {
  const timing = { intervalMs: 5000, backoffBaseMs: 5000, backoffMaxMs: 30000 };
  let doc: Document;

  const flush = (): void => TestBed.inject(ApplicationRef).tick();

  beforeEach(() => {
    vi.useFakeTimers();
    doc = document.implementation.createHTMLDocument('t');
    Object.defineProperty(doc, 'visibilityState', { get: () => 'visible', configurable: true });
  });

  afterEach(() => vi.useRealTimers());

  it('stamps each value with the landing time and resets failures on success', () => {
    const key = signal<string | null>('a');
    const live = TestBed.runInInjectionContext(() => createLiveSnapshot({ key, fetch: (k) => of(`v-${k}`), doc, ...timing }));
    flush();
    expect(live.snapshot()?.value).toBe('v-a');
    expect(live.snapshot()?.receivedAtMs).toBe(Date.now());
    expect(live.failures()).toBe(0);
  });

  it('does not fetch while the key is null', () => {
    const fetch = vi.fn(() => of(1));
    TestBed.runInInjectionContext(() => createLiveSnapshot({ key: signal<string | null>(null), fetch, doc, ...timing }));
    flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('drops the previous snapshot when the key changes', () => {
    const key = signal<string | null>('a');
    const pending = new Subject<string>();
    const live = TestBed.runInInjectionContext(() =>
      createLiveSnapshot({ key, fetch: (k): Observable<string> => (k === 'a' ? of('A') : pending), doc, ...timing })
    );
    flush();
    expect(live.snapshot()?.value).toBe('A');
    key.set('b');
    flush();
    expect(live.snapshot()).toBeNull();
  });

  it('cancels the previous fetch and resets the snapshot when the key goes non-null to null', () => {
    const key = signal<string | null>('a');
    let unsubscribed = false;
    const live = TestBed.runInInjectionContext(() =>
      createLiveSnapshot({
        key,
        fetch: (k) =>
          new Observable<string>((sub) => {
            sub.next(`v-${k}`);
            return () => (unsubscribed = true);
          }),
        doc,
        ...timing,
      })
    );
    flush();
    expect(live.snapshot()?.value).toBe('v-a');
    key.set(null);
    flush();
    expect(unsubscribed).toBe(true);
    expect(live.snapshot()).toBeNull();
    expect(live.failures()).toBe(0);
    vi.advanceTimersByTime(20000);
    expect(live.snapshot()).toBeNull();
  });

  it('starts polling again when the key goes null to non-null, keeping generation semantics', () => {
    const key = signal<string | null>(null);
    const fetch = vi.fn((k: string) => of(`v-${k}`));
    const live = TestBed.runInInjectionContext(() => createLiveSnapshot({ key, fetch, doc, ...timing }));
    flush();
    expect(fetch).not.toHaveBeenCalled();
    key.set('b');
    flush();
    expect(live.snapshot()?.value).toBe('v-b');
    const awaiting = live.restart();
    flush();
    expect(live.landedGeneration()).toBeGreaterThanOrEqual(awaiting);
  });

  it('counts consecutive failures and keeps polling', () => {
    let calls = 0;
    const live = TestBed.runInInjectionContext(() =>
      createLiveSnapshot({
        key: signal<string | null>('a'),
        fetch: () =>
          new Observable<number>((sub) => {
            if (++calls < 3) sub.error(new Error('down'));
            else sub.next(calls);
          }),
        doc,
        ...timing,
      })
    );
    flush();
    expect(live.failures()).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(live.failures()).toBe(2);
    vi.advanceTimersByTime(10000);
    expect(live.failures()).toBe(0);
    expect(live.snapshot()?.value).toBe(3);
  });

  it('restart bumps the generation before restarting and a stale in-flight result does not settle it', () => {
    const inflight: Subject<string>[] = [];
    const live = TestBed.runInInjectionContext(() =>
      createLiveSnapshot({
        key: signal<string | null>('a'),
        fetch: () => {
          const s = new Subject<string>();
          inflight.push(s);
          return s;
        },
        doc,
        ...timing,
      })
    );
    flush();
    expect(inflight).toHaveLength(1);
    const awaiting = live.restart();
    expect(awaiting).toBe(1);
    // The pre-restart request resolves after restart() but before the loop switched: it still lands, tagged with the old generation.
    inflight[0].next('stale');
    expect(live.snapshot()?.value).toBe('stale');
    expect(live.landedGeneration()).toBeLessThan(awaiting);
    flush();
    expect(inflight).toHaveLength(2);
    inflight[1].next('fresh');
    expect(live.landedGeneration()).toBeGreaterThanOrEqual(awaiting);
    expect(live.snapshot()?.value).toBe('fresh');
  });

  it('restart only clears failures when asked', () => {
    const live = TestBed.runInInjectionContext(() =>
      createLiveSnapshot({
        key: signal<string | null>('a'),
        fetch: () => new Observable<number>((sub) => sub.error(new Error('down'))),
        doc,
        ...timing,
      })
    );
    flush();
    expect(live.failures()).toBe(1);
    live.restart();
    expect(live.failures()).toBe(1);
    live.restart(true);
    expect(live.failures()).toBe(0);
  });

  it('never subscribes or touches the document when disabled', () => {
    const fetch = vi.fn(() => of(1));
    const live = TestBed.runInInjectionContext(() =>
      createLiveSnapshot({ key: signal<string | null>('a'), fetch, doc: undefined as unknown as Document, enabled: false, ...timing })
    );
    flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(live.snapshot()).toBeNull();
  });
});
