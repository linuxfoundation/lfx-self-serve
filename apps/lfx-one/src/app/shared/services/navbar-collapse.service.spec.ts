// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NAVBAR_COLLAPSED_STORAGE_KEY, NAVBAR_PEEK_OUT_MS } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavbarCollapseService } from './navbar-collapse.service';

describe('NavbarCollapseService', () => {
  let queries: Record<string, { matches: boolean; listeners: (() => void)[] }>;

  const setup = (platform: 'browser' | 'server' = 'browser'): NavbarCollapseService => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
    return TestBed.inject(NavbarCollapseService);
  };

  const query = (key: 'narrow' | 'touch') => queries[key];

  const emit = (key: 'narrow' | 'touch', matches: boolean): void => {
    query(key).matches = matches;
    query(key).listeners.forEach((listener) => listener());
  };

  beforeEach(() => {
    localStorage.clear();
    queries = { narrow: { matches: false, listeners: [] }, touch: { matches: false, listeners: [] } };
    vi.spyOn(window, 'matchMedia').mockImplementation((media: string) => {
      const entry = media.includes('pointer: coarse') ? queries['touch'] : queries['narrow'];
      return {
        get matches() {
          return entry.matches;
        },
        media,
        addEventListener: (_type: string, listener: () => void) => entry.listeners.push(listener),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts docked open until init, so SSR and the first client render agree', () => {
    localStorage.setItem(NAVBAR_COLLAPSED_STORAGE_KEY, 'true');
    const service = setup();

    expect(service.collapsed()).toBe(false);
    service.init();
    expect(service.collapsed()).toBe(true);
    expect(service.visualCollapsed()).toBe(true);
  });

  it('never reads storage on the server', () => {
    localStorage.setItem(NAVBAR_COLLAPSED_STORAGE_KEY, 'true');
    const service = setup('server');

    service.init();
    expect(service.collapsed()).toBe(false);
  });

  it('remembers the docked preference', () => {
    const service = setup();
    service.init();

    service.setCollapsed(true);
    expect(localStorage.getItem(NAVBAR_COLLAPSED_STORAGE_KEY)).toBe('true');
    service.setCollapsed(false);
    expect(localStorage.getItem(NAVBAR_COLLAPSED_STORAGE_KEY)).toBe('false');
  });

  it('forces the rail on narrow non-touch viewports and restores the preference when they widen', () => {
    const service = setup();
    service.init();

    emit('narrow', true);
    expect(service.narrow()).toBe(true);
    expect(service.effectiveCollapsed()).toBe(true);
    expect(service.collapsed()).toBe(false);

    emit('narrow', false);
    expect(service.effectiveCollapsed()).toBe(false);
  });

  it('leaves touch devices docked open at any width', () => {
    query('touch').matches = true;
    query('narrow').matches = true;
    const service = setup();
    service.init();

    expect(service.touch()).toBe(true);
    expect(service.narrow()).toBe(false);
    expect(service.effectiveCollapsed()).toBe(false);
  });

  it('peeks only from the rail, floating over the page without changing the docked state', () => {
    const service = setup();
    service.init();

    service.openPeek();
    expect(service.peek()).toBe(false);

    service.setCollapsed(true);
    service.openPeek();
    expect(service.peek()).toBe(true);
    expect(service.visualCollapsed()).toBe(false);
    expect(service.overlay()).toBe(true);
    expect(service.effectiveCollapsed()).toBe(true);
  });

  it('keeps the overlay while a closing peek shrinks back to the rail', () => {
    vi.useFakeTimers();
    const service = setup();
    service.init();
    service.setCollapsed(true);
    service.openPeek(true);
    expect(service.peekPinned()).toBe(true);

    service.closePeek();
    expect(service.peek()).toBe(false);
    expect(service.peekPinned()).toBe(false);
    expect(service.visualCollapsed()).toBe(true);
    expect(service.overlay()).toBe(true);

    vi.advanceTimersByTime(NAVBAR_PEEK_OUT_MS);
    expect(service.overlay()).toBe(false);
  });

  it('drops a peek when the viewport crosses the narrow breakpoint', () => {
    const service = setup();
    service.init();
    emit('narrow', true);
    service.openPeek(true);

    emit('narrow', false);
    expect(service.peek()).toBe(false);
    expect(service.peekPinned()).toBe(false);
    expect(service.overlay()).toBe(false);
  });

  it('keeps the navbar at every width on a non-touch device once known in the browser', () => {
    const service = setup();
    expect(service.railAtAnyWidth()).toBe(false);
    expect(service.gutterClass()).toBe('lg:ml-[288px]');

    service.init();
    expect(service.railAtAnyWidth()).toBe(true);
    emit('narrow', true);
    expect(service.gutterClass()).toBe('ml-[56px]');
  });

  it('leaves touch devices on the hamburger and drawer below lg', () => {
    query('touch').matches = true;
    const service = setup();
    service.init();

    expect(service.railAtAnyWidth()).toBe(false);
    service.setCollapsed(true);
    expect(service.gutterClass()).toBe('lg:ml-[56px]');
  });

  it('docks open from a peek without a closing phase', () => {
    const service = setup();
    service.init();
    service.setCollapsed(true);
    service.openPeek();

    service.setCollapsed(false);
    expect(service.peek()).toBe(false);
    expect(service.peekOut()).toBe(false);
    expect(service.visualCollapsed()).toBe(false);
  });
});
