// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VisibilityPollEvent } from '@lfx-one/shared/interfaces';

import { createVisibilityPoll, pollBackoffDelayMs } from './visibility-poll.util';

describe('createVisibilityPoll', () => {
  const options = { intervalMs: 5000, backoffBaseMs: 5000, backoffMaxMs: 30000 };
  let state: DocumentVisibilityState;
  let doc: Document;
  let events: VisibilityPollEvent<number>[];

  const setVisibility = (next: DocumentVisibilityState): void => {
    state = next;
    doc.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    state = 'visible';
    doc = document.implementation.createHTMLDocument('t');
    Object.defineProperty(doc, 'visibilityState', { get: () => state, configurable: true });
    events = [];
  });

  afterEach(() => vi.useRealTimers());

  it('fetches immediately then every 5 seconds', () => {
    let n = 0;
    const sub = createVisibilityPoll(doc, () => of(++n), options).subscribe((e) => events.push(e));
    expect(events).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(events).toHaveLength(2);
    vi.advanceTimersByTime(10000);
    expect(events).toHaveLength(4);
    sub.unsubscribe();
  });

  it('distinguishes scheduled polling from discovery on open and visible/focus return', () => {
    Object.defineProperty(doc, 'defaultView', { configurable: true, value: window });
    const fetch = vi.fn(() => of(1));
    const sub = createVisibilityPoll(doc, fetch, options).subscribe();
    expect(fetch).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(5000);
    expect(fetch).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new Event('focus'));
    expect(fetch).toHaveBeenLastCalledWith(false);
    setVisibility('hidden');
    vi.advanceTimersByTime(10000);
    expect(fetch).toHaveBeenCalledTimes(3);
    setVisibility('visible');
    expect(fetch).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(5000);
    expect(fetch).toHaveBeenLastCalledWith(true);
    sub.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never overlaps a slow in-flight request', () => {
    const inFlight = new Subject<number>();
    const fetch = vi.fn(() => inFlight);
    const sub = createVisibilityPoll(doc, fetch, options).subscribe();
    vi.advanceTimersByTime(30000);
    expect(fetch).toHaveBeenCalledTimes(1);
    inFlight.next(1);
    sub.unsubscribe();
  });

  it('pauses while hidden and fetches immediately on visible', () => {
    const fetch = vi.fn(() => of(1));
    const sub = createVisibilityPoll(doc, fetch, options).subscribe();
    setVisibility('hidden');
    vi.advanceTimersByTime(60000);
    expect(fetch).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(fetch).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });

  it('rechecks immediately on window focus only while visible', () => {
    Object.defineProperty(doc, 'defaultView', { configurable: true, value: window });
    const fetch = vi.fn(() => of(1));
    const sub = createVisibilityPoll(doc, fetch, options).subscribe();
    window.dispatchEvent(new Event('focus'));
    expect(fetch).toHaveBeenCalledTimes(2);
    setVisibility('hidden');
    window.dispatchEvent(new Event('focus'));
    expect(fetch).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops when shouldContinue is false and restarts on the next visible event', () => {
    const fetch = vi.fn(() => of(1));
    const sub = createVisibilityPoll(doc, fetch, { ...options, shouldContinue: () => false }).subscribe();
    vi.advanceTimersByTime(60000);
    expect(fetch).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    setVisibility('visible');
    expect(fetch).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });

  it('re-reads immediately on window focus, including after a terminal read', () => {
    Object.defineProperty(doc, 'defaultView', { value: window, configurable: true });
    const fetch = vi.fn(() => of(1));
    const sub = createVisibilityPoll(doc, fetch, { ...options, shouldContinue: () => false }).subscribe();
    window.dispatchEvent(new Event('focus'));
    expect(fetch).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
    window.dispatchEvent(new Event('focus'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never fetches on focus while the document is hidden', () => {
    Object.defineProperty(doc, 'defaultView', { value: window, configurable: true });
    const fetch = vi.fn(() => of(1));
    const sub = createVisibilityPoll(doc, fetch, options).subscribe();
    setVisibility('hidden');
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(60000);
    expect(fetch).toHaveBeenCalledTimes(1);
    state = 'visible';
    window.dispatchEvent(new Event('focus'));
    expect(fetch).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });

  it('backs off on errors, recovers without a reload, and resets the failure count', () => {
    const results: ('fail' | 'ok')[] = ['fail', 'fail', 'ok'];
    const fetch = vi.fn(() => (results.shift() === 'ok' ? of(7) : throwError(() => new Error('down'))));
    const sub = createVisibilityPoll(doc, fetch, options).subscribe((e) => events.push(e));
    expect(events.map((e) => e.kind)).toEqual(['error']);
    vi.advanceTimersByTime(5000);
    expect(events.map((e) => (e.kind === 'error' ? e.failures : 0))).toEqual([1, 2]);
    vi.advanceTimersByTime(10000);
    expect(events[2]).toEqual({ kind: 'ok', value: 7 });
    sub.unsubscribe();
  });

  it('cleans up timers on unsubscribe', () => {
    const fetch = vi.fn(() => of(1));
    createVisibilityPoll(doc, fetch, options).subscribe().unsubscribe();
    vi.advanceTimersByTime(60000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('pollBackoffDelayMs', () => {
  it('doubles per failure up to the cap', () => {
    expect([1, 2, 3, 4, 5].map((f) => pollBackoffDelayMs(f, 5000, 30000))).toEqual([5000, 10000, 20000, 30000, 30000]);
  });
});
