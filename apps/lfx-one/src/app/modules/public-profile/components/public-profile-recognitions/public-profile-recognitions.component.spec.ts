// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PUBLIC_PROFILE_BADGE_LABEL } from '@lfx-one/shared/constants';
import { PublicProfileBadge } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { PublicProfileRecognitionsComponent } from './public-profile-recognitions.component';

@Component({
  selector: 'lfx-test-recognitions-host',
  imports: [PublicProfileRecognitionsComponent],
  template: '<lfx-public-profile-recognitions [badges]="badges()" />',
})
class HostComponent {
  public readonly badges = signal<PublicProfileBadge[]>([]);
}

const badge = (n: number): PublicProfileBadge => ({ Image: `https://images.example/b${n}.png`, Url: `https://www.credly.example/badges/b${n}` });

describe('PublicProfileRecognitionsComponent', () => {
  async function render(badges: PublicProfileBadge[]) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.badges.set(badges);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      host,
      pills: () => Array.from(host.querySelectorAll('[data-testid^="public-profile-badge-"]:not([data-testid$="-name"])')) as HTMLElement[],
      toggle: () => host.querySelector('[data-testid="public-profile-recognitions-grid-toggle"] button') as HTMLButtonElement | null,
    };
  }

  it('shows nothing for no badges', async () => {
    const { pills } = await render([]);

    expect(pills()).toHaveLength(0);
  });

  it('shows four badges as image pills that open Credly in a new tab', async () => {
    const { pills, toggle } = await render([badge(1), badge(2), badge(3), badge(4)]);

    expect(pills()).toHaveLength(4);
    expect(pills()[0].getAttribute('href')).toBe('https://www.credly.example/badges/b1');
    expect(pills()[0].getAttribute('target')).toBe('_blank');
    expect(pills()[0].getAttribute('aria-label')).toBe(PUBLIC_PROFILE_BADGE_LABEL);
    expect(pills()[0].querySelector('img')?.getAttribute('src')).toBe('https://images.example/b1.png');
    expect(toggle()).toBeNull();
  });

  it('shows nine of twelve badges, then all of them, then nine again', async () => {
    const { fixture, pills, toggle } = await render(Array.from({ length: 12 }, (_, index) => badge(index + 1)));
    expect(pills()).toHaveLength(9);

    toggle()?.click();
    await fixture.whenStable();
    expect(pills()).toHaveLength(12);
    expect(toggle()?.textContent?.trim()).toBe('Show less');

    toggle()?.click();
    await fixture.whenStable();
    expect(pills()).toHaveLength(9);
  });

  it('leaves out a badge with no image, and links only to http(s) addresses', async () => {
    const { pills } = await render([{ Url: 'https://www.credly.example/badges/x' }, { Image: 'https://images.example/y.png', Url: 'javascript:alert(1)' }]);

    expect(pills()).toHaveLength(1);
    expect(pills()[0].tagName).toBe('DIV');
    expect(pills()[0].getAttribute('role')).toBe('img');
  });
});
