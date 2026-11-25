// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FocusMonitor } from '@angular/cdk/a11y';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { PROFILE_RECOGNITIONS_COPY, PROFILE_TRAINING_PATH } from '@lfx-one/shared/constants';
import { Badge } from '@lfx-one/shared/interfaces';
import { BadgesService } from '@services/badges.service';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileRecognitionsComponent } from './profile-recognitions.component';

const badge = (n: number, extra: Partial<Badge> = {}): Badge =>
  ({
    id: `b${n}`,
    title: `Badge ${n}`,
    description: `What badge ${n} is for.`,
    category: 'certifications',
    issuedDate: `2024-${String((n % 12) + 1).padStart(2, '0')}-10T00:00:00Z`,
    issuer: 'The Linux Foundation',
    isPending: false,
    imageUrl: `https://images.example/b${n}.png`,
    credlyUrl: `https://www.credly.example/badges/b${n}`,
    ...extra,
  }) as Badge;

describe('ProfileRecognitionsComponent', () => {
  async function render(getBadges: () => Observable<Badge[]>) {
    const read = vi.fn(getBadges);
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: BadgesService, useValue: { getBadges: read } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileRecognitionsComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      read,
      host,
      query: (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null,
      pills: () => Array.from(host.querySelectorAll('[data-testid^="profile-recognitions-badge-"]:not([data-testid$="-name"])')) as HTMLElement[],
    };
  }

  it('heads the section with the hint and a way to earn badges', async () => {
    const { query } = await render(() => of([]));

    expect(query('profile-recognitions-title')?.textContent?.trim()).toBe(PROFILE_RECOGNITIONS_COPY.heading);
    expect(query('profile-section-hint')?.textContent).toContain(PROFILE_RECOGNITIONS_COPY.missingLabel);
    expect(query('profile-recognitions-earn')?.querySelector('a')?.getAttribute('href')).toBe(PROFILE_TRAINING_PATH);
  });

  it('says there are no badges yet when none are earned', async () => {
    const { host, pills } = await render(() => of([badge(1, { isPending: true })]));

    expect(pills()).toHaveLength(0);
    expect(host.textContent).toContain(PROFILE_RECOGNITIONS_COPY.emptyTitle);
  });

  it('shows five badges newest first, each linking to Credly, with Speaking marked', async () => {
    const badges = [badge(1), badge(4, { category: 'speaking' }), badge(2), badge(5), badge(3)];
    const { pills, query } = await render(() => of(badges));

    expect(pills().map((pill) => pill.getAttribute('data-testid'))).toEqual([
      'profile-recognitions-badge-b5',
      'profile-recognitions-badge-b4',
      'profile-recognitions-badge-b3',
      'profile-recognitions-badge-b2',
      'profile-recognitions-badge-b1',
    ]);
    expect(pills()[0].getAttribute('href')).toBe('https://www.credly.example/badges/b5');
    expect(pills()[1].textContent).toContain(PROFILE_RECOGNITIONS_COPY.speaking);
    expect(pills()[0].textContent).not.toContain(PROFILE_RECOGNITIONS_COPY.speaking);
    expect(query('profile-recognitions-grid-toggle')).toBeNull();
  });

  it('shows nine of twelve badges, then all of them', async () => {
    const { fixture, pills, query } = await render(() => of(Array.from({ length: 12 }, (_, index) => badge(index + 1))));
    expect(pills()).toHaveLength(9);

    const toggle = query('profile-recognitions-grid-toggle')?.querySelector('button');
    expect(toggle?.textContent?.trim()).toBe('View all (12)');
    toggle?.click();
    await fixture.whenStable();
    expect(pills()).toHaveLength(12);
  });

  it('opens a card with the description and issue date on keyboard focus', async () => {
    const { pills } = await render(() => of([badge(3)]));

    TestBed.inject(FocusMonitor).focusVia(pills()[0], 'keyboard');
    await new Promise((resolve) => setTimeout(resolve));
    const card = document.querySelector('[data-testid="profile-recognitions-card-b3"]');

    expect(card?.textContent).toContain('What badge 3 is for.');
    expect(card?.textContent?.replace(/\s+/g, ' ')).toContain('Issued Apr 2024 · The Linux Foundation');
  });

  it('says the badges could not load, and tries again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fixture, read, query, pills } = await render(() => throwError(() => new Error('boom')));
    expect(query('profile-recognitions-error')?.textContent).toContain(PROFILE_RECOGNITIONS_COPY.loadFailed);

    read.mockImplementation(() => of([badge(1)]));
    query('profile-recognitions-retry')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(pills()).toHaveLength(1);
    warn.mockRestore();
  });
});
