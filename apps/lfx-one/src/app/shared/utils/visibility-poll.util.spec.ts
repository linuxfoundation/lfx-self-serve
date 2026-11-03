// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY, Subject, of, throwError } from 'rxjs';
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
    // Jitter pinned at the ceiling: the first retry waits 2 × 5 s, the second 4 × 5 s.
    const sub = createVisibilityPoll(doc, fetch, { ...options, random: () => 1 }).subscribe((e) => events.push(e));
    expect(events.map((e) => e.kind)).toEqual(['error']);
    vi.advanceTimersByTime(10000);
    expect(events.map((e) => (e.kind === 'error' ? e.failures : 0))).toEqual([1, 2]);
    vi.advanceTimersByTime(20000);
    expect(events[2]).toEqual({ kind: 'ok', value: 7 });
    sub.unsubscribe();
  });

  it('spreads retries with jitter so many tabs do not hit a recovering server together, never faster than the healthy interval, and never stops', () => {
    const fetch = vi.fn(() => throwError(() => new Error('down')));
    const random = vi.fn(() => 0.5);
    const sub = createVisibilityPoll(doc, fetch, { ...options, random }).subscribe((e) => events.push(e));
    expect(fetch).toHaveBeenCalledTimes(1);
    // First retry: 5 s + half of the 5 s spread ([5 s, 10 s]), never earlier than the healthy step. Second: 5 s + half of 15 s ([5 s, 20 s]).
    vi.advanceTimersByTime(7499);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(12499);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    // Past the cap every wait is drawn from [5 s, 30 s]: 30 minutes of outage still yields a bounded, steady stream of checks.
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(fetch.mock.calls.length).toBeGreaterThan(3 + 60);
    expect(fetch.mock.calls.length).toBeLessThan(3 + 360);
    expect(random).toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('ignores focus and online while the tab is hidden, and reads once on return', () => {
    Object.defineProperty(doc, 'defaultView', { configurable: true, value: window });
    const fetch = vi.fn(() => of(1));
    const sub = createVisibilityPoll(doc, fetch, options).subscribe();
    expect(fetch).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(60000);
    expect(fetch).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(fetch).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });

  it('lets a caller end a denied read for good by returning EMPTY from fetch', () => {
    Object.defineProperty(doc, 'defaultView', { configurable: true, value: window });
    const fetch = vi.fn(() => EMPTY);
    const sub = createVisibilityPoll(doc, fetch, options).subscribe((e) => events.push(e));
    vi.advanceTimersByTime(60000);
    window.dispatchEvent(new Event('focus'));
    expect(events).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });

  it('checks at once when the browser comes back online', () => {
    Object.defineProperty(doc, 'defaultView', { configurable: true, value: window });
    const fetch = vi.fn(() => of(1));
    const sub = createVisibilityPoll(doc, fetch, options).subscribe();
    expect(fetch).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(false);
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
  it('jitters every retry: the ceiling doubles from twice the healthy interval up to the cap', () => {
    expect([1, 2, 3, 4, 5].map((f) => pollBackoffDelayMs(f, 5000, 30000, () => 1))).toEqual([10000, 20000, 30000, 30000, 30000]);
  });

  it('draws the wait uniformly between the healthy interval and that ceiling, never below it', () => {
    expect(pollBackoffDelayMs(1, 5000, 30000, () => 0.5)).toBe(7500);
    expect(pollBackoffDelayMs(2, 5000, 30000, () => 0.5)).toBe(12500);
    expect(pollBackoffDelayMs(9, 5000, 30000, () => 0.1)).toBe(7500);
    expect(pollBackoffDelayMs(1, 5000, 30000, () => 0)).toBe(5000);
    expect(pollBackoffDelayMs(9, 5000, 30000, () => 0)).toBe(5000);
  });

  it('is a constant interval, no spread, for a caller whose cap equals its interval', () => {
    expect([1, 2, 3].map((f) => pollBackoffDelayMs(f, 5000, 5000, () => 0.7))).toEqual([5000, 5000, 5000]);
  });

  it('keeps the un-randomised doubling (base, 2·base, 4·base … capped) with jitter off', () => {
    const random = vi.fn(() => 0.5);
    expect([1, 2, 3, 4, 5].map((f) => pollBackoffDelayMs(f, 5000, 30000, random, false))).toEqual([5000, 10000, 20000, 30000, 30000]);
    expect(random).not.toHaveBeenCalled();
  });
});
