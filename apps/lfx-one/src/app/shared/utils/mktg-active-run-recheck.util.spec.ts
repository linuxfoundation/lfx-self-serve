// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY, of, Subject, throwError } from 'rxjs';
import type { MktgActiveRunConflict, MktgActiveRunGuardOptions, MktgActiveRunRecheckEvent } from '@lfx-one/shared/interfaces';
import { MKTG_RUN_POLL } from '@lfx-one/shared/constants/mktg-run.constants';
import { watchMktgActiveRun } from './mktg-active-run-recheck.util';

const conflict: MktgActiveRunConflict = {
  code: 'MKTG_RUN_ACTIVE',
  message: 'A run is in progress.',
  activeRunId: 'b'.repeat(64),
  state: 'writing',
  agentKey: 'faq',
  documentId: 'living',
  startedBy: 'Synthetic writer',
  startedByViewer: false,
  startedAt: '2026-10-19T12:00:00Z',
};

describe('active-run recheck ownership', () => {
  let doc: Document;
  let view: EventTarget;
  let visible: boolean;
  let options: MktgActiveRunGuardOptions<string>;
  let events: MktgActiveRunRecheckEvent<string>[];
  beforeEach(() => {
    vi.useFakeTimers();
    visible = true;
    view = new EventTarget();
    doc = Object.assign(new EventTarget(), { defaultView: view }) as unknown as Document;
    Object.defineProperty(doc, 'visibilityState', { get: () => (visible ? 'visible' : 'hidden') });
    options = {
      conflict,
      current: () => true,
      recheck: vi.fn(() => throwError(() => conflict)),
      classify: (error) => (error === conflict ? conflict : null),
      onValue: vi.fn(),
      onOpen: vi.fn(),
      onDiscard: vi.fn(),
      onError: vi.fn(),
    };
    events = [];
  });
  afterEach(() => vi.useRealTimers());

  it('rechecks on open, focus and visible timer ticks with fresh conflict facts', () => {
    const fresh = { ...conflict, activeRunId: 'c'.repeat(64), startedAt: '2026-10-19T13:00:00Z' };
    options.classify = () => fresh;
    const sub = watchMktgActiveRun(doc, options).subscribe((event) => events.push(event));
    expect(options.recheck).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({ type: 'conflict', conflict: fresh });
    view.dispatchEvent(new Event('focus'));
    expect(options.recheck).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    expect(options.recheck).toHaveBeenCalledTimes(3);
    sub.unsubscribe();
  });

  it('keeps one POST in flight across focus/hide/show, accepts once and forwards its normal result stream', () => {
    const response = new Subject<string>();
    options.recheck = vi.fn(() => response);
    const sub = watchMktgActiveRun(doc, options).subscribe((event) => events.push(event));
    view.dispatchEvent(new Event('focus'));
    visible = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    visible = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(options.recheck).toHaveBeenCalledOnce();
    response.next('submitted');
    view.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(3 * MKTG_RUN_POLL.intervalMs);
    response.next('document');
    expect(options.recheck).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.type === 'accepted')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'value')).toEqual([
      { type: 'value', value: 'submitted' },
      { type: 'value', value: 'document' },
    ]);
    response.complete();
    expect(sub.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never retries an uncertain non-409 start, even on focus', () => {
    options.recheck = vi.fn(() => throwError(() => new Error('Synthetic transport outage')));
    const sub = watchMktgActiveRun(doc, options).subscribe((event) => events.push(event));
    view.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(10 * MKTG_RUN_POLL.intervalMs);
    expect(options.recheck).toHaveBeenCalledOnce();
    expect(events.at(-1)?.type).toBe('error');
    expect(sub.closed).toBe(true);
  });

  it('treats a completed stream without an ACK as uncertain, never another automatic start', () => {
    options.recheck = vi.fn(() => EMPTY);
    const sub = watchMktgActiveRun(doc, options).subscribe((event) => events.push(event));
    view.dispatchEvent(new Event('focus'));
    expect(options.recheck).toHaveBeenCalledOnce();
    expect(events.at(-1)?.type).toBe('error');
    expect(sub.closed).toBe(true);
  });

  it('does not send a start while hidden, and cleans up on dismissal', () => {
    visible = false;
    const sub = watchMktgActiveRun(doc, options).subscribe();
    expect(options.recheck).not.toHaveBeenCalled();
    view.dispatchEvent(new Event('focus'));
    expect(options.recheck).not.toHaveBeenCalled();
    visible = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(options.recheck).toHaveBeenCalledOnce();
    sub.unsubscribe();
    view.dispatchEvent(new Event('focus'));
    expect(options.recheck).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('suppresses late values after context changes and never restarts a stale dialog', () => {
    const response = new Subject<string>();
    options.recheck = vi.fn(() => response);
    const sub = watchMktgActiveRun(doc, options).subscribe((event) => events.push(event));
    options.current = () => false;
    response.next('stale');
    view.dispatchEvent(new Event('focus'));
    expect(events.some((event) => event.type === 'value')).toBe(false);
    expect(options.recheck).toHaveBeenCalledOnce();
    expect(sub.closed).toBe(true);
  });

  it('stops after a one-shot successful start instead of polling a second start', () => {
    options.recheck = vi.fn(() => of('session'));
    const sub = watchMktgActiveRun(doc, options).subscribe((event) => events.push(event));
    view.dispatchEvent(new Event('focus'));
    expect(options.recheck).toHaveBeenCalledOnce();
    expect(events.map((event) => event.type)).toEqual(['checking', 'accepted', 'value']);
    expect(sub.closed).toBe(true);
  });
});
