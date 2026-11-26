// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PUBLIC_PROFILE_THEME_STORAGE_KEY } from '@lfx-one/shared/constants';
import { afterEach, describe, expect, it } from 'vitest';

import { PublicProfileThemeService } from './public-profile-theme.service';

@Component({ selector: 'lfx-test-theme-host', template: '', providers: [PublicProfileThemeService] })
class HostComponent {
  public readonly theme = inject(PublicProfileThemeService);
}

describe('PublicProfileThemeService', () => {
  afterEach(() => localStorage.removeItem(PUBLIC_PROFILE_THEME_STORAGE_KEY));

  async function render(platform: 'browser' | 'server' = 'browser') {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
    const fixture = TestBed.createComponent(HostComponent);
    const service = fixture.componentInstance.theme;
    const lightAtFirst = service.theme();
    await fixture.whenStable();
    return { service, lightAtFirst };
  }

  it('starts light, as the server renders, then takes the stored choice', async () => {
    localStorage.setItem(PUBLIC_PROFILE_THEME_STORAGE_KEY, 'dark');
    const { service, lightAtFirst } = await render();

    expect(lightAtFirst).toBe('light');
    expect(service.theme()).toBe('dark');
  });

  it('remembers a switch for the next visit', async () => {
    const { service } = await render();

    service.toggle();

    expect(service.dark()).toBe(true);
    expect(localStorage.getItem(PUBLIC_PROFILE_THEME_STORAGE_KEY)).toBe('dark');
  });

  it('stays light on the server', async () => {
    localStorage.setItem(PUBLIC_PROFILE_THEME_STORAGE_KEY, 'dark');
    const { service } = await render('server');

    expect(service.theme()).toBe('light');
  });
});
