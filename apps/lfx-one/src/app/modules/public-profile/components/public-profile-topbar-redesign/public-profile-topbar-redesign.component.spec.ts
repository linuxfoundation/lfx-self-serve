// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PUBLIC_PROFILE_TOPBAR_COPY, PUBLIC_PROFILE_TOPBAR_REVEAL_OFFSET } from '@lfx-one/shared/constants';
import { PublicProfileBasic } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

import { PublicProfileThemeService } from '../../services/public-profile-theme.service';
import { PublicProfileTopbarRedesignComponent } from './public-profile-topbar-redesign.component';

@Component({
  selector: 'lfx-test-topbar-host',
  imports: [PublicProfileTopbarRedesignComponent],
  providers: [PublicProfileThemeService],
  template: '<lfx-public-profile-topbar-redesign [basic]="basic" />',
})
class HostComponent {
  public readonly basic: PublicProfileBasic = { Name: 'Ada Lovelace', Title: 'Engineer', AccountName: 'Acme Motors' };
}

describe('PublicProfileTopbarRedesignComponent', () => {
  async function render() {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, host, query: (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null };
  }

  it('shows Powered by at rest, and the person only past 240px of scroll', async () => {
    const { fixture, query } = await render();
    expect(query('topbar-powered-by')?.getAttribute('aria-hidden')).toBe('false');
    expect(query('topbar-identity')?.getAttribute('aria-hidden')).toBe('true');

    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    Object.defineProperty(window, 'scrollY', { value: PUBLIC_PROFILE_TOPBAR_REVEAL_OFFSET + 1, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    await fixture.whenStable();

    expect(query('topbar-identity')?.getAttribute('aria-hidden')).toBe('false');
    expect(query('topbar-name')?.textContent?.trim()).toBe('Ada Lovelace');
    expect(query('topbar-headline')?.textContent?.trim()).toBe('Engineer at Acme Motors');
    frame.mockRestore();
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('switches the theme, naming the one it switches to', async () => {
    const { fixture, query } = await render();
    const toggle = query('topbar-theme')?.querySelector('button');
    expect(toggle?.getAttribute('aria-label')).toBe(PUBLIC_PROFILE_TOPBAR_COPY.darkTheme);

    toggle?.click();
    await fixture.whenStable();
    expect(query('topbar-theme')?.querySelector('button')?.getAttribute('aria-label')).toBe(PUBLIC_PROFILE_TOPBAR_COPY.lightTheme);
    localStorage.removeItem('lfx-public-profile-theme');
  });
});
