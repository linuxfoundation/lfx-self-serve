// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Confirmation, ConfirmationService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGuardedConfirm } from './guarded-confirm.util';

describe('createGuardedConfirm', () => {
  let confirmation: { confirm: ReturnType<typeof vi.fn> };
  let currentKey: ReturnType<typeof signal<string | null>>;
  let fallback: HTMLButtonElement;
  let opener: HTMLButtonElement;

  const lastAccept = (): (() => void) => (confirmation.confirm.mock.calls.at(-1)?.[0] as Confirmation).accept as () => void;

  const build = () =>
    TestBed.runInInjectionContext(() =>
      createGuardedConfirm({
        confirmation: confirmation as unknown as ConfirmationService,
        doc: document,
        currentKey,
        fallbackFocus: () => fallback,
      })
    );

  beforeEach(() => {
    vi.useFakeTimers();
    confirmation = { confirm: vi.fn() };
    currentKey = signal<string | null>('a');
    fallback = document.createElement('button');
    opener = document.createElement('button');
    document.body.append(fallback, opener);
  });

  afterEach(() => {
    vi.useRealTimers();
    fallback.remove();
    opener.remove();
  });

  it('opens the confirmation with the given options and marks itself open', () => {
    const guarded = build();
    guarded.open({ header: 'Close vote' }, 'a', vi.fn());
    expect(confirmation.confirm).toHaveBeenCalledWith(expect.objectContaining({ header: 'Close vote' }));
    expect(guarded.isOpen()).toBe(true);
  });

  it('runs the action with the key on accept while the key is current', () => {
    const action = vi.fn();
    build().open({}, 'a', action);
    lastAccept()();
    expect(action).toHaveBeenCalledWith('a');
  });

  it('ignores an accept once the current key has moved on', () => {
    const action = vi.fn();
    build().open({}, 'a', action);
    currentKey.set('b');
    lastAccept()();
    expect(action).not.toHaveBeenCalled();
  });

  it('stays open until a tick after the dialog hides, so the closing Esc still reads as open', () => {
    const guarded = build();
    guarded.open({}, 'a', vi.fn());
    guarded.onHidden();
    expect(guarded.isOpen()).toBe(true);
    vi.runAllTimers();
    expect(guarded.isOpen()).toBe(false);
  });

  it('returns focus to the opener when it is still usable', () => {
    const guarded = build();
    opener.focus();
    guarded.open({}, 'a', vi.fn());
    fallback.focus();
    guarded.onHidden();
    vi.runAllTimers();
    expect(document.activeElement).toBe(opener);
  });

  it('falls back when the opener is disabled or gone', () => {
    const guarded = build();
    opener.focus();
    guarded.open({}, 'a', vi.fn());
    opener.disabled = true;
    guarded.onHidden();
    vi.runAllTimers();
    expect(document.activeElement).toBe(fallback);

    opener.disabled = false;
    opener.focus();
    guarded.open({}, 'a', vi.fn());
    opener.remove();
    guarded.onHidden();
    vi.runAllTimers();
    expect(document.activeElement).toBe(fallback);
  });

  it('forgets the opener after restoring, so a later hide falls back', () => {
    const guarded = build();
    opener.focus();
    guarded.open({}, 'a', vi.fn());
    guarded.onHidden();
    vi.runAllTimers();
    expect(document.activeElement).toBe(opener);
    fallback.focus();
    guarded.onHidden();
    vi.runAllTimers();
    expect(document.activeElement).toBe(fallback);
  });

  it('clears its pending timer on destroy', () => {
    const guarded = build();
    guarded.open({}, 'a', vi.fn());
    guarded.onHidden();
    TestBed.resetTestingModule();
    vi.runAllTimers();
    expect(guarded.isOpen()).toBe(true);
  });
});
