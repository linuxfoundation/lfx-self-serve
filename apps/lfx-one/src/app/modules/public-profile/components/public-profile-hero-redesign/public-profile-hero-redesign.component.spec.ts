// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PublicProfileBasic } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { PublicProfileHeroRedesignComponent } from './public-profile-hero-redesign.component';

@Component({
  selector: 'lfx-test-hero-host',
  imports: [PublicProfileHeroRedesignComponent],
  template: '<lfx-public-profile-hero-redesign [basic]="basic()" [about]="about()" />',
})
class HostComponent {
  public readonly basic = signal<PublicProfileBasic | null>(null);
  public readonly about = signal('');
}

const BASIC: PublicProfileBasic = {
  Name: 'Ada Lovelace',
  Title: 'Engineer',
  AccountName: 'Acme Motors',
  AccountLogoURL: 'https://logos.example/acme.png',
  Bio: 'I build compilers.',
  GithubID: 'ada',
  LinkedInID: 'ada-lovelace',
  TwitterID: 'ada_tweets',
};

describe('PublicProfileHeroRedesignComponent', () => {
  async function render(basic: PublicProfileBasic, about = '') {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.basic.set(basic);
    fixture.componentInstance.about.set(about);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, host, query: (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null };
  }

  it('shows the name, "Title at Company" with its logo, and the bio', async () => {
    const { query } = await render(BASIC);

    expect(query('hero-name')?.textContent?.trim()).toBe('Ada Lovelace');
    expect(query('hero-meta')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Engineer at Acme Motors');
    expect(query('hero-company-logo')?.getAttribute('src')).toBe('https://logos.example/acme.png');
    expect(query('hero-bio')?.textContent).toBe('I build compilers.');
  });

  it('links GitHub and LinkedIn by handle, and drops X and Share', async () => {
    const { host, query } = await render(BASIC);
    const github = query('hero-github')?.querySelector('a');
    const linkedIn = query('hero-linkedin')?.querySelector('a');

    expect(github?.getAttribute('href')).toBe('https://github.com/ada');
    expect(github?.getAttribute('aria-label')).toBe('GitHub: ada');
    expect(linkedIn?.getAttribute('href')).toBe('https://www.linkedin.com/in/ada-lovelace');
    expect(linkedIn?.getAttribute('aria-label')).toBe('LinkedIn: ada-lovelace');
    expect(host.querySelector('a[href*="twitter.com"]')).toBeNull();
    expect(host.textContent).not.toContain('Share');
  });

  it('names a LinkedIn profile given as a full URL by its vanity name', async () => {
    const { query } = await render({ ...BASIC, LinkedInID: 'https://www.linkedin.com/in/ada-l/' });

    expect(query('hero-linkedin')?.querySelector('a')?.getAttribute('aria-label')).toBe('LinkedIn: ada-l');
  });

  it('leaves the links out when there are none', async () => {
    const { query } = await render({ Name: 'Ada Lovelace' });

    expect(query('hero-actions')).toBeNull();
    expect(query('hero-meta')).toBeNull();
  });

  it('falls back from the uploaded photo to the logo, then to the person icon', async () => {
    const { fixture, query } = await render({ ...BASIC, avatarUrl: 'https://cdn.example/ada.png', LogoURL: 'https://cdn.example/logo.png' });
    expect(query('hero-avatar-image')?.getAttribute('src')).toBe('https://cdn.example/ada.png');

    query('hero-avatar-image')?.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(query('hero-avatar-image')?.getAttribute('src')).toBe('https://cdn.example/logo.png');

    query('hero-avatar-image')?.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(query('hero-avatar-image')).toBeNull();
    expect(query('hero-avatar-fallback')).not.toBeNull();
  });

  it('shows the person icon when there is no photo', async () => {
    const { query } = await render({ Name: 'Ada Lovelace' });

    expect(query('hero-avatar-fallback')?.getAttribute('aria-label')).toBe('No profile photo');
  });
});
