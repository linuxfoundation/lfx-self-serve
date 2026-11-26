// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { PUBLIC_PROFILE_SECTION_COPY, PUBLIC_PROFILE_THEME_STORAGE_KEY } from '@lfx-one/shared/constants';
import { PublicProfile } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { TranscendService } from '@services/transcend.service';
import { PROFILE_REDESIGN_KEY } from '@shared/utils/profile-redesign.util';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { PublicProfileService } from '../services/public-profile.service';
import { PublicProfilePageComponent } from './public-profile-page.component';

const PROFILE: PublicProfile = {
  isPublic: true,
  basic: { Name: 'Ada Lovelace', Title: 'Engineer' },
  badges: [{ Image: 'https://images.example/badge.png', Url: 'https://www.credly.example/badges/b1' }],
  technical_contribution: { projects: [] },
  certification_activities: [],
  training_activities: [],
} as PublicProfile;

describe('PublicProfilePageComponent', () => {
  async function render(redesign: boolean, profile: PublicProfile = PROFILE) {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ username: 'ada' })) } },
        { provide: PublicProfileService, useValue: { getPublicProfile: () => of(profile) } },
        { provide: TranscendService, useValue: { preferencesAvailable: false, showPreferences: () => undefined } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
      ],
    });
    // As the route guard leaves it after the server answered for this render.
    TestBed.inject(TransferState).set(PROFILE_REDESIGN_KEY, redesign);
    const fixture = TestBed.createComponent(PublicProfilePageComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return { host, query: (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null };
  }

  it('keeps today’s two-column page without the redesign', async () => {
    const { query } = await render(false);

    expect(query('public-profile-redesign')).toBeNull();
    expect(query('public-profile-badges')?.textContent).toContain('Badges');
    expect(query('public-profile-recognitions')).toBeNull();
  });

  it('stacks the blocks in one column under visitor-worded section headers with the redesign', async () => {
    const { query } = await render(true);

    expect(query('public-profile-redesign')).not.toBeNull();
    expect(query('public-profile-recognitions-title')?.textContent?.trim()).toBe(PUBLIC_PROFILE_SECTION_COPY.recognitions);
    expect(query('public-profile-recognitions-description')?.textContent).toContain('this person');
    // The block's own heading gives way to the section header.
    expect(query('public-profile-badges')?.querySelector('h2')).toBeNull();
    expect(query('public-profile-footer')?.className).toContain('mt-[64px]');
  });

  it('leaves out a block with no data, with no gap where it would be', async () => {
    const { query } = await render(true);

    expect(query('public-profile-involvement')).toBeNull();
    expect(query('public-profile-blocks')?.children).toHaveLength(1);
  });

  it('keeps the involvement block’s year select on the right once its heading gives way to the section header', async () => {
    const year = (n: number) => ({ year: n, commits: 1, deleted: 0, added: 1, prs: 0, issues: 0 });
    const project = { Name: 'Kube', commits: 2, deleted: 0, added: 2, prs: 0, issues: 0, years: [year(2024), year(2025)] };
    const { query } = await render(true, { ...PROFILE, technical_contribution: { projects: [project] } } as PublicProfile);
    const row = query('contributions-year-select')?.parentElement;

    expect(query('public-profile-involvement-title')?.textContent?.trim()).toBe(PUBLIC_PROFILE_SECTION_COPY.involvement);
    expect(row?.classList).toContain('justify-end');
    expect(row?.classList).not.toContain('justify-between');
  });

  it('renders the redesign light, then in the dark theme a visitor chose before', async () => {
    let { query } = await render(true);
    expect(query('public-profile-redesign')?.getAttribute('data-theme')).toBe('light');

    TestBed.resetTestingModule();
    localStorage.setItem(PUBLIC_PROFILE_THEME_STORAGE_KEY, 'dark');
    try {
      ({ query } = await render(true));
      expect(query('public-profile-redesign')?.getAttribute('data-theme')).toBe('dark');
    } finally {
      localStorage.removeItem(PUBLIC_PROFILE_THEME_STORAGE_KEY);
    }
  });
});
