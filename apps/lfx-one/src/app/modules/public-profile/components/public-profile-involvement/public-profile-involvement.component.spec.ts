// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FocusMonitor } from '@angular/cdk/a11y';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PUBLIC_PROFILE_INVOLVEMENT_COPY, PUBLIC_PROFILE_THEME_STORAGE_KEY } from '@lfx-one/shared/constants';
import { PublicProfileProject, PublicProfileYearContribution } from '@lfx-one/shared/interfaces';
import { afterEach, describe, expect, it } from 'vitest';

import { PublicProfileThemeService } from '../../services/public-profile-theme.service';
import { PublicProfileInvolvementComponent } from './public-profile-involvement.component';

@Component({
  selector: 'lfx-test-involvement-host',
  imports: [PublicProfileInvolvementComponent],
  providers: [PublicProfileThemeService],
  template: '<lfx-public-profile-involvement [projects]="projects()" />',
})
class HostComponent {
  public readonly projects = signal<PublicProfileProject[]>([]);
}

const thisYear = new Date().getUTCFullYear();
const year = (n: number): PublicProfileYearContribution => ({ year: n, commits: 1, deleted: 0, added: 0, prs: 0, issues: 0 });
const project = (name: string, years: number[]): PublicProfileProject => ({
  Name: name,
  LogoURL: `https://logos.example/${name}.png`,
  commits: 1234,
  deleted: 0,
  added: 0,
  prs: 56,
  issues: 7,
  years: years.map(year),
});

describe('PublicProfileInvolvementComponent', () => {
  afterEach(() => localStorage.removeItem(PUBLIC_PROFILE_THEME_STORAGE_KEY));

  async function render(projects: PublicProfileProject[]) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.projects.set(projects);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      host,
      pills: () => Array.from(host.querySelectorAll('[data-testid^="public-profile-project-"]:not([data-testid$="-name"])')) as HTMLElement[],
      toggle: () => host.querySelector('[data-testid="public-profile-involvement-grid-toggle"] button') as HTMLButtonElement | null,
    };
  }

  it('shows current projects first, each with a Contributor badge and its years', async () => {
    const { pills } = await render([project('past', [thisYear - 3, thisYear - 5]), project('now', [thisYear, thisYear - 2])]);

    const parts = (pill: HTMLElement) => [
      pill.querySelector('[data-testid$="-name"]')?.textContent?.trim(),
      pill.querySelector('lfx-ui-badge')?.textContent?.trim(),
      pill.querySelector('[data-testid="public-profile-involvement-years"]')?.textContent?.trim(),
    ];

    expect(pills().map(parts)).toEqual([
      ['now', PUBLIC_PROFILE_INVOLVEMENT_COPY.contributor, `Since ${thisYear - 2}`],
      ['past', PUBLIC_PROFILE_INVOLVEMENT_COPY.contributor, `${thisYear - 5} – ${thisYear - 3}`],
    ]);
  });

  it('shows nine projects, then all of them with View all', async () => {
    const { fixture, pills, toggle } = await render(Array.from({ length: 12 }, (_, index) => project(`p${index}`, [thisYear])));
    expect(pills()).toHaveLength(9);

    toggle()?.click();
    await fixture.whenStable();

    expect(pills()).toHaveLength(12);
  });

  it('opens a card with the totals and the years on keyboard focus, in the page theme', async () => {
    const { fixture, pills } = await render([project('kube', [thisYear, thisYear - 1])]);
    fixture.debugElement.injector.get(PublicProfileThemeService).setTheme('dark');

    TestBed.inject(FocusMonitor).focusVia(pills()[0], 'keyboard');
    await new Promise((resolve) => setTimeout(resolve));
    const card = document.querySelector('[data-testid="public-profile-project-card-0"]');
    const stat = (key: string) => {
      const row = card?.querySelector(`[data-testid="public-profile-project-stat-${key}"]`);
      return `${row?.querySelector('dt')?.textContent?.trim()} ${row?.querySelector('dd')?.textContent?.trim()}`;
    };

    expect(card?.getAttribute('data-theme')).toBe('dark');
    expect(card?.textContent).toContain('kube');
    expect(card?.textContent).toContain(PUBLIC_PROFILE_INVOLVEMENT_COPY.contributor);
    expect(card?.textContent).toContain(`Since ${thisYear - 1}`);
    expect(stat('commits')).toBe(`${PUBLIC_PROFILE_INVOLVEMENT_COPY.commits} 1,234`);
    expect(stat('prs')).toBe(`${PUBLIC_PROFILE_INVOLVEMENT_COPY.prs} 56`);
    expect(stat('issues')).toBe(`${PUBLIC_PROFILE_INVOLVEMENT_COPY.issues} 7`);
  });
});
