// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NAVBAR_THEME_STORAGE_KEY } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavbarThemeService } from './navbar-theme.service';

describe('NavbarThemeService', () => {
  const setup = (platform: 'browser' | 'server' = 'browser'): NavbarThemeService => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
    return TestBed.inject(NavbarThemeService);
  };

  beforeEach(() => localStorage.clear());

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('starts dark until init, so SSR and the first client render agree', () => {
    localStorage.setItem(NAVBAR_THEME_STORAGE_KEY, 'light');
    const service = setup();

    expect(service.theme()).toBe('dark');
    service.init();
    expect(service.theme()).toBe('light');
    expect(service.light()).toBe(true);
  });

  it('defaults to dark when nothing, or an unknown value, is stored', () => {
    localStorage.setItem(NAVBAR_THEME_STORAGE_KEY, 'sepia');
    const service = setup();
    service.init();

    expect(service.theme()).toBe('dark');
  });

  it('remembers the chosen theme', () => {
    const service = setup();
    service.init();

    service.setTheme('light');
    expect(service.light()).toBe(true);
    expect(localStorage.getItem(NAVBAR_THEME_STORAGE_KEY)).toBe('light');

    service.setTheme('dark');
    expect(service.light()).toBe(false);
    expect(localStorage.getItem(NAVBAR_THEME_STORAGE_KEY)).toBe('dark');
  });

  it('follows a change made in another tab', () => {
    const service = setup();
    service.init();

    localStorage.setItem(NAVBAR_THEME_STORAGE_KEY, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: NAVBAR_THEME_STORAGE_KEY, newValue: 'light' }));
    expect(service.theme()).toBe('light');
  });

  it('keeps the choice for the session when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const service = setup();
    service.init();

    service.setTheme('light');
    expect(service.theme()).toBe('light');
  });

  it('does nothing on the server', () => {
    localStorage.setItem(NAVBAR_THEME_STORAGE_KEY, 'light');
    const service = setup('server');
    service.init();

    expect(service.theme()).toBe('dark');
  });
});
